# Cinebridge — Atividade IV

Implementação da atividade IV sobre o projeto fornecido das atividades anteriores. Quatro serviços Node.js/TypeScript, quatro bancos PostgreSQL independentes e RabbitMQ. A lógica de recomendação, fábricas, protótipos, estratégias, observers, visitors, adapters, composite e decorators anteriores foi preservada.

## 1. Preparar o ambiente

**Windows 10 ou superior:** instalar uma versão compatível do Docker Desktop, habilitar virtualização e WSL2, usar containers Linux e iniciar o Docker Desktop. **Ubuntu 24.04.3 ou superior e derivados:** instalar Docker Engine e o plugin Docker Compose. No Linux, o usuário precisa ter acesso ao daemon Docker.

Referências oficiais: [Windows](https://docs.docker.com/desktop/setup/install/windows-install/), [Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Compose](https://docs.docker.com/compose/install/). Não é necessário instalar Node.js, PostgreSQL ou RabbitMQ no computador para executar os containers.

Abra o terminal dentro da pasta que contém `docker-compose.yml` e verifique:

```sh
docker --version
docker compose version
```

Os exemplos usam Compose v2 (`docker compose`). O comando equivalente no Compose legado é `docker-compose`; recomenda-se v2 para este projeto.

## 2. Configurar e iniciar

A configuração padrão já permite executar o exercício sem editar arquivos. Para personalizar credenciais, copie `.env.example` para `.env` na raiz:

PowerShell:

```powershell
Copy-Item .env.example .env
```

Ubuntu:

```sh
cp .env.example .env
```

Cada serviço também tem `services/<dominio>/.env.example`, lido pelo Compose como configuração base. Os valores em `environment` no Compose prevalecem, usando as credenciais do `.env` raiz. Os arquivos `.env` com credenciais locais não devem ser commitados. Se utilizar caracteres reservados em credenciais, codifique-os nas URLs de conexão ou ajuste `DATABASE_URL`/`RABBITMQ_URL` diretamente.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs -f
```

A primeira execução baixa imagens, instala dependências e compila TypeScript. Aguarde os nove containers iniciarem e ficarem saudáveis. `Ctrl+C` interrompe apenas o acompanhamento dos logs.

## 3. Testar o fluxo completo

Execute, no mesmo terminal:

```sh
docker compose exec -e SMOKE_IN_DOCKER=1 cinebridge-api node scripts/smoke-atv4.js
```

Esse comando usa o Node.js do container, funciona no PowerShell e no Ubuntu e verifica:

1. `/health` dos quatro serviços, incluindo banco e RabbitMQ.
2. Cadastro de diretor e editor no banco de profissionais.
3. Requisição de recomendação; candidatos consultados por `consulta-profissionais`.
4. Projeto registrado por `consulta-projetos`; recomendação persistida em banco próprio.
5. Atualização e finalização do projeto, com métricas e resultado.
6. Criação e aceitação de convite, inclusive repetição idempotente.
7. Recebimento dos eventos e persistência das notificações no serviço dedicado.

Saída esperada: `ATVIV OK` e os IDs gerados. A execução cadastra/atualiza dois profissionais de exemplo e cria projetos e recomendações reais; pode ser repetida. Para executar pelo Node.js local (18+), com os containers iniciados, use `npm run test:e2e`.

### Teste manual

No Windows, use `curl.exe` nos comandos abaixo. No Ubuntu, use `curl`.

```sh
curl -H "Content-Type: application/json" --data-binary @examples/profissional-diretor.json http://localhost:3001/profissionais
curl -H "Content-Type: application/json" --data-binary @examples/profissional-editor.json http://localhost:3001/profissionais
curl -H "Content-Type: application/json" --data-binary @examples/recomendacao.json http://localhost:3000/recomendacoes
curl http://localhost:3002/projetos
curl http://localhost:3003/notificacoes
```

Para recomendar sobre projeto já cadastrado, envie `{"projetoId":"ID_RETORNADO","estrategia":"FILTRAGEM_COLABORATIVA"}` para `POST /recomendacoes`. O array `profissionaisDisponiveis` deve ser omitido ou vazio na versão distribuída: o cadastro do serviço de profissionais é a fonte de verdade. Os dados completos de competências, avaliações, histórico e disponibilidade são retornados pelo RPC, sem perda na conversão para o domínio existente.

## 4. Portas e isolamento

| Container | Porta no computador | Conexão interna | Responsabilidade |
| --- | --- | --- | --- |
| cinebridge-api | 3000 | 3000 | Recomendação e orquestração |
| cinebridge-profissionais | 3001 | 3001 | Cadastro, competências, avaliações, disponibilidade |
| cinebridge-projetos | 3002 | 3002 | Projetos, métricas, resultados e convites |
| cinebridge-notificacoes | 3003 | 3003 | Mensagens internas e e-mails configuráveis |
| profissionais-db | 5432 | 5432 | Dados de profissionais |
| projetos-db | 5433 | 5432 | Dados de projetos |
| recomendacoes-db | 5434 | 5432 | Resultados das recomendações |
| notificacoes-db | 5435 | 5432 | Notificações e deduplicação |
| cinebridge-mq | 5672 e 15672 | 5672 e 15672 | RabbitMQ e painel |

Os containers usam os nomes dos serviços como DNS; `localhost` dentro de um container refere-se ao próprio container. Cada serviço usa apenas seu banco. As quatro bases usam tabelas próprias `documentos` (JSONB), `outbox` e `inbox`, criadas de forma idempotente na inicialização. As entidades do domínio continuam sendo usadas para executar a recomendação; a persistência distribuída utiliza `pg` e não precisa sincronizar entidades de outros domínios.

A rede `cinebridge-net` é `bridge` com `internal: true`. As portas publicadas estão vinculadas a `127.0.0.1`, para acesso apenas pela máquina local. Cinco volumes nomeados preservam bancos e mensagens após recriar containers.

## 5. Endpoints

| Serviço | Método e rota | Uso |
| --- | --- | --- |
| Todos | GET /health | 200 com DB e MQ operacionais; 503 se alguma dependência falhar |
| API | POST /recomendacoes | Projeto completo ou `projetoId`, estratégia, orquestrador e decorators opcionais |
| API | GET /recomendacoes | Resultados persistidos |
| API | GET /recomendacoes/:id | Recuperar resultado |
| Profissionais | POST /profissionais | Cadastrar/atualizar um profissional completo |
| Profissionais | PUT /profissionais/:id | Atualizar cadastro e competências |
| Profissionais | GET /profissionais | Listar cadastros |
| Profissionais | GET /profissionais/:id | Consultar cadastro |
| Profissionais | POST /profissionais/:id/avaliacoes | Adicionar `{"nota":5}` |
| Profissionais | PUT /profissionais/:id/disponibilidades | Substituir lista de períodos `[{"inicio":"2026-01-01","fim":"2099-12-31"}]` |
| Projetos | POST /projetos | Cadastrar usando objeto `projeto` dos exemplos, sem o envelope |
| Projetos | GET /projetos | Listar projetos |
| Projetos | GET /projetos/:id | Consultar projeto e estado |
| Projetos | PUT /projetos/:id | Atualizar projeto; emite PROJETO_ATUALIZADO |
| Projetos | POST /projetos/:id/finalizar | Corpo `{"metricas":{},"resultado":{}}`; emite PROJETO_FINALIZADO |
| Projetos | POST /projetos/:id/convites | Corpo `{"profissionalId":"prof-ana"}` |
| Projetos | POST /projetos/:id/convites/:conviteId/aceitar | Aceitar convite existente; emite CONVITE_ACEITO |
| Notificações | GET /notificacoes | Consultar mensagens internas persistidas |

Projetos finalizados não podem ser alterados ou receber novos convites. Repetir finalização/aceitação não duplica os respectivos eventos. O exercício não inclui autenticação nem uma interface web de cadastro; os testes são feitos pelos endpoints REST.

## 6. Mensageria e resiliência

| Fila | Produtor | Consumidor | Finalidade |
| --- | --- | --- | --- |
| consulta-profissionais | API e projetos | Profissionais | Listar candidatos ou obter perfil |
| consulta-projetos | API | Projetos | Criar/obter projeto |
| respostas-UUID | Profissionais/projetos | Solicitante original | Resposta RPC correlacionada por `correlationId` e `replyTo` |
| eventos-projetos | Projetos | Notificações | Criação, atualização e finalização |
| eventos-recomendacoes | API | Notificações | Recomendação gerada |
| eventos-convites | Projetos | Notificações | Convite aceito |
| *.dlq | Broker | Inspeção manual | Mensagens que excederam tentativas |

As filas são duráveis; mensagens são persistentes; publicações usam `ConfirmChannel` e consumidores dão ACK manual após concluir o processamento. Há `prefetch`, prazo RPC, limpeza de pendências, até três republicações e DLQs. As filas de resposta são duráveis e exclusivas por instância lógica (nome UUID, sem flag AMQP `exclusive`), expiram após inatividade e são removidas no encerramento normal; respostas atrasadas não ficam acumuladas indefinidamente.

Mudanças de projeto/recomendação e eventos são salvos na mesma transação PostgreSQL. Um publicador de **outbox** tenta enviar pendências a cada segundo e só marca sucesso após confirmação do broker. Se ele cair entre envio e commit, pode repetir o evento; a **inbox** das notificações deduplica pelo ID. A entrega é **ao menos uma vez**. No SMTP pode haver duplicação se o envio concluir e a transação falhar; `Message-ID` é estável, mas não se promete entrega exatamente uma vez de e-mail.

Após desconexão AMQP o processo encerra e `restart: unless-stopped` refaz conexão, filas e consumidores. Se o PostgreSQL cair, health retorna 503, consultas usam timeout e a outbox continua tentando. Mensagens de consumidores que excederem as tentativas permanecem na DLQ para investigação e republicação manual após corrigir o problema.

Painel: [http://localhost:15672](http://localhost:15672), `guest` / `guest` na configuração padrão. Em **Queues and Streams**, acompanhe consumers, Ready, Unacked e taxas. Em **Connections**, veja os quatro serviços conectados. As filas podem ficar vazias após processamento normal. A configuração `loopback_users.guest = false` permite a credencial didática entre containers; credenciais podem ser alteradas pelo `.env`.

Referências: [confirmações e ACK](https://www.rabbitmq.com/docs/confirms), [confiabilidade](https://www.rabbitmq.com/docs/reliability), [inicialização com health checks](https://docs.docker.com/compose/how-tos/startup-order/).

## 7. Notificações e SMTP

Por padrão, cada evento gera mensagem interna persistida e alerta no log. Não é necessário contratar um serviço de e-mail para testar a atividade. Para envio real, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` e `NOTIFICATION_EMAIL` no `.env` raiz. O destinatário configurado recebe os alertas de demonstração.

Para SMTP externo, use a rede adicional de saída, mantendo os bancos e demais serviços internos:

```sh
docker compose -f docker-compose.yml -f docker-compose.smtp.yml up -d --build
```

O padrão Observer é implementado em `src/distributed/notifications.ts`. O registro fica `ENVIADA` somente após executar os observadores configurados. Falhas SMTP são tratadas pelo mesmo mecanismo de tentativas/DLQ. Sem configuração SMTP, nenhum envio externo é realizado.

## 8. Persistência, manutenção e testes de falhas

```sh
docker compose logs -f cinebridge-api cinebridge-profissionais cinebridge-projetos cinebridge-notificacoes
docker compose exec profissionais-db psql -U cinebridge -d profissionais -c "SELECT id FROM documentos;"
docker compose exec projetos-db psql -U cinebridge -d projetos -c "SELECT id, enviado FROM outbox;"
docker compose restart
docker compose down
```

`docker compose down` preserva os volumes. Iniciar novamente deve manter os cadastros e resultados existentes. **`docker compose down -v` apaga os dados** e só deve ser usado para zerar o ambiente.

Para conferir a recuperação, pare `cinebridge-mq`, tente acessar um `/health` (503 ou indisponível durante reinício), inicie `cinebridge-mq`, aguarde os serviços reconectarem e execute o teste completo novamente. Para observar a outbox, pare notificações, crie um projeto, veja `eventos-projetos` acumular e reinicie notificações; os alertas devem aparecer sem repetir IDs.

## 9. Desenvolvimento e validação

Com Node.js 18+:

```sh
npm ci
npm run build
npm test -- --runInBand
npm run lint
```

`npm start` executa a versão distribuída e precisa de `SERVICE_NAME`, `PORT`, `DATABASE_URL` e `RABBITMQ_URL` no ambiente. O Compose fornece esses valores automaticamente. Os serviços usam `node:18-alpine`, PostgreSQL `postgres:15-alpine` e RabbitMQ `rabbitmq:3-management-alpine`, conforme solicitado no enunciado.

A aplicação anterior pode ser executada isoladamente com `npm run start:legacy` após compilar, para comparação e testes antigos. Nesse modo o endpoint recebe profissionais no corpo e não usa os quatro serviços. O Compose e `npm start` usam a nova implementação.

O relatório de validação e o mapeamento de requisitos estão em [docs/ATV4.md](docs/ATV4.md). O enunciado e o diagrama fornecidos estão em `docs/`. As instruções anteriores foram preservadas em `docs/README-atviii-original.md`.
