import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { Store } from './store';
import { Bus, RpcError } from './bus';
import { ComporEquipeRequestDTO, ProfissionalInputDTO, ProjetoInputDTO } from '../application/dto/compor-equipe.dto';
import { comporEquipeBodySchema, profissionalSchema, projetoSchema } from '../interfaces/http/schemas/compor-equipe.schema';
import { ComporEquipeService } from '../application/compor-equipe.service';
import { mapearRespostaRecomendacao } from '../application/mappers/resposta-recomendacao.mapper';

type RegistroProjeto = { id: string; projeto: ProjetoInputDTO; tipoProjeto?: ComporEquipeRequestDTO['tipoProjeto']; status: 'CRIADO' | 'EM_ANDAMENTO' | 'FINALIZADO'; metricas?: unknown; resultado?: unknown; convites?: Array<{ id: string; profissionalId: string; status: 'PENDENTE' | 'ACEITO' }> };
type Comando = { operacao: string; id?: string; filtro?: string; dados?: unknown };
const objetoSchema = { type: 'object', additionalProperties: true };
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } };
function requerido<T>(valor: T | undefined): T { if (!valor) throw new RpcError('Registro não encontrado'); return valor; }

export async function profissionais(app: FastifyInstance, store: Store, bus: Bus): Promise<void> {
  app.addSchema({ ...profissionalSchema, $id: 'profissional' });
  app.get('/profissionais', async () => store.list<ProfissionalInputDTO>());
  app.get<{ Params: { id: string } }>('/profissionais/:id', { schema: { params: idParams } }, async (req, reply) => {
    const p = await store.get(req.params.id); return p ?? reply.code(404).send({ erro: 'Profissional não encontrado' });
  });
  app.post<{ Body: ProfissionalInputDTO }>('/profissionais', { schema: { body: profissionalSchema } }, async (req, reply) => {
    await store.put(req.body.id, req.body); return reply.code(201).send(req.body);
  });
  app.put<{ Params: { id: string }; Body: ProfissionalInputDTO }>('/profissionais/:id', { schema: { body: profissionalSchema, params: idParams } }, async (req, reply) => {
    if (req.params.id !== req.body.id) return reply.code(400).send({ erro: 'IDs diferentes' });
    await store.put(req.params.id, req.body); return req.body;
  });
  app.post<{ Params: { id: string }; Body: { nota: number } }>('/profissionais/:id/avaliacoes', { schema: { params: idParams, body: { type: 'object', required: ['nota'], properties: { nota: { type: 'number', minimum: 0, maximum: 5 } } } } }, async req => {
    return store.tx(async c => {
      const row = (await c.query('SELECT dados FROM documentos WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      const p = requerido<ProfissionalInputDTO>(row?.dados);
      p.avaliacoes = [...(p.avaliacoes ?? []), req.body]; await store.put(p.id, p, c); return p;
    });
  });
  app.put<{ Params: { id: string }; Body: NonNullable<ProfissionalInputDTO['disponibilidades']> }>('/profissionais/:id/disponibilidades', { schema: { params: idParams, body: profissionalSchema.properties.disponibilidades } }, async req => {
    return store.tx(async c => {
      const row = (await c.query('SELECT dados FROM documentos WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      const p = requerido<ProfissionalInputDTO>(row?.dados);
      p.disponibilidades = req.body; await store.put(p.id, p, c); return p;
    });
  });
  await bus.consume('consulta-profissionais', async dados => {
    const cmd = dados as Comando;
    if (cmd.operacao === 'listar') {
      const filtro = (cmd.filtro ?? '').toLocaleLowerCase();
      return (await store.list<ProfissionalInputDTO>()).filter(p => !filtro || `${p.nome} ${p.especialidades.join(' ')} ${(p.competencias ?? []).map(c => c.nome).join(' ')}`.toLocaleLowerCase().includes(filtro));
    }
    if (cmd.operacao === 'obter') return requerido(await store.get(cmd.id ?? ''));
    // Cadastros são feitos no endpoint público deste domínio; a API apenas consulta.
    throw new RpcError('Operação de profissionais inválida');
  }, true);
}

export async function projetos(app: FastifyInstance, store: Store, bus: Bus): Promise<void> {
  const bodyProjeto = { ...projetoSchema, $defs: comporEquipeBodySchema.$defs };
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validarProjeto = ajv.compile(bodyProjeto);
  async function criar(id: string, projeto: ProjetoInputDTO, tipoProjeto?: RegistroProjeto['tipoProjeto']): Promise<RegistroProjeto> {
    if (!validarProjeto(projeto)) throw new RpcError('Dados de projeto inválidos');
    // ID fornecido pelo chamador torna segura a repetição da criação após perda de resposta.
    return store.tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      const existente = (await c.query('SELECT dados FROM documentos WHERE id=$1', [id])).rows[0]?.dados;
      if (existente) return existente;
      const registro: RegistroProjeto = { id, projeto, tipoProjeto, status: 'CRIADO' };
      await store.put(id, registro, c); await store.event(c, 'eventos-projetos', 'PROJETO_CRIADO', id, registro); return registro;
    });
  }
  app.get('/projetos', async () => store.list<RegistroProjeto>());
  app.get<{ Params: { id: string } }>('/projetos/:id', { schema: { params: idParams } }, async (req, reply) => {
    return await store.get(req.params.id) ?? reply.code(404).send({ erro: 'Projeto não encontrado' });
  });
  app.post<{ Body: ProjetoInputDTO }>('/projetos', { schema: { body: bodyProjeto } }, async (req, reply) => reply.code(201).send(await criar(randomUUID(), req.body)));
  app.put<{ Params: { id: string }; Body: ProjetoInputDTO }>('/projetos/:id', { schema: { params: idParams, body: bodyProjeto } }, async req => store.tx(async c => {
    const row = (await c.query('SELECT dados FROM documentos WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    const p = requerido<RegistroProjeto>(row?.dados);
    if (p.status === 'FINALIZADO') throw new RpcError('Projeto já finalizado');
    p.projeto = req.body; p.status = 'EM_ANDAMENTO'; await store.put(p.id, p, c);
    await store.event(c, 'eventos-projetos', 'PROJETO_ATUALIZADO', p.id, p); return p;
  }));
  app.post<{ Params: { id: string }; Body: { metricas?: unknown; resultado?: unknown } }>('/projetos/:id/finalizar', { schema: { params: idParams, body: objetoSchema } }, async req => store.tx(async c => {
    const row = (await c.query('SELECT dados FROM documentos WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    const p = requerido<RegistroProjeto>(row?.dados);
    if (p.status === 'FINALIZADO') return p;
    p.status = 'FINALIZADO'; p.metricas = req.body.metricas; p.resultado = req.body.resultado;
    await store.put(p.id, p, c); await store.event(c, 'eventos-projetos', 'PROJETO_FINALIZADO', p.id, p); return p;
  }));
  app.post<{ Params: { id: string }; Body: { profissionalId: string } }>('/projetos/:id/convites', {
    schema: { params: idParams, body: { type: 'object', required: ['profissionalId'], properties: { profissionalId: { type: 'string', minLength: 1 } } } }
  }, async (req, reply) => {
    await bus.rpc('consulta-profissionais', { operacao: 'obter', id: req.body.profissionalId });
    const convite = await store.tx(async c => {
      const row = (await c.query('SELECT dados FROM documentos WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      const p = requerido<RegistroProjeto>(row?.dados);
      if (p.status === 'FINALIZADO') throw new RpcError('Projeto já finalizado');
      const novo = { id: randomUUID(), profissionalId: req.body.profissionalId, status: 'PENDENTE' as const };
      p.convites = [...(p.convites ?? []), novo]; await store.put(p.id, p, c); return novo;
    });
    return reply.code(201).send(convite);
  });
  app.post<{ Params: { id: string; conviteId: string } }>('/projetos/:id/convites/:conviteId/aceitar', async req => store.tx(async c => {
    const row = (await c.query('SELECT dados FROM documentos WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    const p = requerido<RegistroProjeto>(row?.dados);
    if (p.status === 'FINALIZADO') throw new RpcError('Projeto já finalizado');
    const convite = requerido(p.convites?.find(v => v.id === req.params.conviteId));
    if (convite.status === 'ACEITO') return convite;
    convite.status = 'ACEITO'; await store.put(p.id, p, c);
    await store.event(c, 'eventos-convites', 'CONVITE_ACEITO', p.id, convite); return convite;
  }));
  await bus.consume('consulta-projetos', async dados => {
    const cmd = dados as Comando;
    if (cmd.operacao === 'obter') return requerido(await store.get(cmd.id ?? ''));
    if (cmd.operacao === 'criar') {
      const d = cmd.dados as { projeto: ProjetoInputDTO; tipoProjeto?: RegistroProjeto['tipoProjeto'] };
      if (!cmd.id || !d?.projeto?.nome) throw new RpcError('Projeto inválido');
      return criar(cmd.id, d.projeto, d.tipoProjeto);
    }
    throw new RpcError('Operação de projetos inválida');
  }, true);
}

export async function api(app: FastifyInstance, store: Store, bus: Bus): Promise<void> {
  // Lógica de domínio e todos os padrões das atividades anteriores são reutilizados.
  const service = new ComporEquipeService();
  const schema = {
    ...comporEquipeBodySchema, required: [],
    anyOf: [{ required: ['projeto'] }, { required: ['projetoId'] }],
    properties: { ...comporEquipeBodySchema.properties, projetoId: { type: 'string', minLength: 1 } }
  };
  app.get('/recomendacoes', async () => store.list());
  app.get<{ Params: { id: string } }>('/recomendacoes/:id', async (req, reply) => await store.get(req.params.id) ?? reply.code(404).send({ erro: 'Recomendação não encontrada' }));
  app.post<{ Body: ComporEquipeRequestDTO & { projetoId?: string } }>('/recomendacoes', { schema: { body: schema } }, async (req, reply) => {
    if (req.body.profissionaisDisponiveis?.length) return reply.code(400).send({ erro: 'Na ATVIV, cadastre profissionais na porta 3001; omita profissionaisDisponiveis ou envie [].' });
    const id = randomUUID();
    const profissionais = await bus.rpc<ProfissionalInputDTO[]>('consulta-profissionais', { operacao: 'listar', filtro: req.body.filtroProfissionais });
    // O cadastro remoto é a fonte de verdade; o array legado continua aceito pelo schema.
    if (!profissionais.length) return reply.code(422).send({ erro: 'Cadastre profissionais no serviço da porta 3001 antes de recomendar.' });
    const registro = req.body.projetoId
      ? await bus.rpc<RegistroProjeto>('consulta-projetos', { operacao: 'obter', id: req.body.projetoId })
      : await bus.rpc<RegistroProjeto>('consulta-projetos', { operacao: 'criar', id, dados: { projeto: req.body.projeto, tipoProjeto: req.body.tipoProjeto } });
    const resultado = await service.executar({ ...req.body, projeto: registro.projeto, tipoProjeto: req.body.tipoProjeto ?? registro.tipoProjeto, profissionaisDisponiveis: profissionais, consultarProfissionaisExternos: false });
    const resposta = { ...mapearRespostaRecomendacao(resultado), id, projetoId: registro.id };
    await store.tx(async c => {
      await store.put(id, resposta, c);
      await store.event(c, 'eventos-recomendacoes', 'RECOMENDACAO_GERADA', registro.id, resposta);
    });
    if ((req.body.decoradores ?? []).includes('compressao') && /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))) {
      const { gzipSync } = await import('zlib');
      return reply.code(201).header('Content-Encoding', 'gzip').header('Vary', 'Accept-Encoding').type('application/json').send(gzipSync(Buffer.from(JSON.stringify(resposta))));
    }
    return reply.code(201).send(resposta);
  });
}
