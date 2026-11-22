# Cinebridge — Atividade IV

Plataforma de recomendação de equipes desenvolvida em Node.js e TypeScript, com quatro microsserviços, quatro bancos PostgreSQL independentes e comunicação por RabbitMQ.

O projeto utiliza os padrões de projeto implementados nas atividades anteriores, incluindo fábricas, protótipos, estratégias, Observer, Visitor, Adapter, Composite e Decorator.

## 1. Preparar o ambiente

- **Windows:** instalar uma versão compatível do Docker Desktop, habilitar virtualização e WSL2, usar containers Linux e iniciar o Docker Desktop.
- **Ubuntu 24.04.3 ou superior e derivados:** instalar Docker Engine e o plugin Docker Compose. O usuário precisa ter acesso ao daemon Docker.

Documentação oficial:

- [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
- [Docker Engine para Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Compose](https://docs.docker.com/compose/install/)

O Docker executa Node.js, PostgreSQL e RabbitMQ nos containers.

Abra o terminal na pasta que contém `docker-compose.yml` e confira a instalação:

```sh
docker --version
docker compose version
```

Os comandos deste projeto utilizam Docker Compose v2.

## 2. Configurar e iniciar

O projeto inclui valores padrão para execução local. Para personalizar as configurações, copie `.env.example` para `.env` na raiz.

No PowerShell:

```powershell
Copy-Item .env.example .env
```

No Ubuntu:

```sh
cp .env.example .env
```

Cada serviço possui um arquivo `services/<dominio>/.env.example`, utilizado pelo Compose como configuração base. Os valores definidos em `environment` no `docker-compose.yml` prevalecem sobre essa configuração.

Arquivos `.env` com credenciais locais devem permanecer fora do Git. Caso utilize caracteres reservados nas credenciais, codifique esses caracteres nas URLs de conexão.

Execute um comando por vez:

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

A primeira execução baixa as imagens, instala as dependências e compila o TypeScript. O comando com `--wait` aguarda os serviços iniciarem e passarem pelos health checks.

O projeto possui nove containers:

- `cinebridge-api`
- `cinebridge-profissionais`
- `cinebridge-projetos`
- `cinebridge-notificacoes`
- `profissionais-db`
- `projetos-db`
- `recomendacoes-db`
- `notificacoes-db`
- `cinebridge-mq`

Para acompanhar os logs:

```sh
docker compose logs -f
```

Pressione `Ctrl+C` para encerrar o acompanhamento dos logs. Os containers continuam em execução.

## 3. Testar o fluxo completo

Com os containers em execução, rode:

```sh
docker compose exec -e SMOKE_IN_DOCKER=1 cinebridge-api node scripts/smoke-atv4.js
```

O comando utiliza o Node.js do container e funciona no PowerShell e no Ubuntu.

O teste verifica:

1. Health checks dos quatro microsserviços, incluindo PostgreSQL e RabbitMQ.
2. Cadastro de profissionais.
3. Consulta de candidatos pela fila `consulta-profissionais`.
4. Registro e consulta de projetos pela fila `consulta-projetos`.
5. Geração e persistência de recomendações.
6. Atualização e finalização de projetos, com métricas e resultados.
7. Criação e aceitação de convites, incluindo repetição idempotente.
8. Recebimento dos eventos e persistência das notificações.

Ao concluir com sucesso, o terminal exibe `ATVIV OK`, seguido dos identificadores do projeto e da recomendação.

O teste pode ser repetido. Cada execução cadastra ou atualiza os profissionais de exemplo e cria novos projetos e recomendações.

Para conferir o acesso à API pelo computador, abra:

http://127.0.0.1:3000/health

O retorno esperado contém `"status":"ok"`. Para esse acesso, a API deve estar conectada à rede `cinebridge-local`, declarada no Docker Compose, além da rede interna `cinebridge-net`.

## 4. Desenvolvimento e validação

Para compilar e executar os testes diretamente no computador, instale Node.js 18 ou superior e execute:

```sh
npm ci
npm run build
npm test -- --runInBand
npm run lint
```

Esses comandos instalam as dependências, compilam o TypeScript, executam os testes automatizados e verificam o código com ESLint.

`npm start` executa a versão distribuída. Para execução fora do Docker, configure as variáveis `SERVICE_NAME`, `PORT`, `DATABASE_URL` e `RABBITMQ_URL` com endereços acessíveis pelo computador. Na execução pelo Compose, essas configurações são fornecidas automaticamente.

As imagens utilizadas são:

- `node:18-alpine`
- `postgres:15-alpine`
- `rabbitmq:3-management-alpine`

A aplicação das atividades anteriores pode ser executada após a compilação:

```sh
npm run start:legacy
```

Nesse modo, o endpoint de recomendação recebe a lista de profissionais no corpo da requisição.

## 5. Parar e iniciar novamente

Para parar e remover os containers:

```sh
docker compose down
```

Os dados permanecem nos volumes do Docker. O uso de `docker compose down -v` também remove esses volumes e apaga os dados armazenados.

Para iniciar novamente:

```sh
docker compose up -d --wait
```
