import Fastify from 'fastify';
import { api, projetos } from '../../../src/distributed/services';
import { Store } from '../../../src/distributed/store';
import { Bus } from '../../../src/distributed/bus';
import { PapelTecnico, TipoCaptacao } from '../../../src/domain/entities/enums';

const projeto = {
  nome: 'ATVIV', genero: 'Drama', duracaoEstimadaMinutos: 30, orcamentoTotal: 20000,
  dataEntrega: '2099-12-01', tipoCaptacao: TipoCaptacao.FICCAO,
  localizacaoFilmagem: { cidade: 'São Paulo', uf: 'SP', pais: 'Brasil' },
  papeisObrigatorios: [{ papel: PapelTecnico.DIRETOR, peso: 1 }]
};
const profissional = {
  id: 'prof-1', nome: 'Ana', especialidades: [PapelTecnico.DIRETOR], valorMinimo: 1000, valorMaximo: 2000,
  localizacao: projeto.localizacaoFilmagem, avaliacoes: [{ nota: 5 }]
};
function setup() {
  const put = jest.fn().mockResolvedValue(undefined);
  const event = jest.fn().mockResolvedValue(undefined);
  const rpc = jest.fn(async (fila: string, cmd: { id: string; operacao: string }) => fila === 'consulta-profissionais' ? [profissional] : { id: cmd.id, projeto, status: 'CRIADO' });
  const tx = jest.fn(async action => action({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
  return { put, event, rpc, store: { put, event, tx } as unknown as Store, bus: { rpc } as unknown as Bus };
}
describe('Rotas distribuídas ATVIV', () => {
  it('consulta profissionais e registra projeto exclusivamente por RPC, persistindo resultado e evento juntos', async () => {
    const ctx = setup(); const app = Fastify(); await api(app, ctx.store, ctx.bus);
    try {
      const r = await app.inject({ method: 'POST', url: '/recomendacoes', payload: { projeto } });
      expect(r.statusCode).toBe(201);
      expect(ctx.rpc.mock.calls.map(c => c[0])).toEqual(['consulta-profissionais', 'consulta-projetos']);
      expect(r.json().alocacoes[0].profissionalId).toBe('prof-1');
      expect(ctx.put).toHaveBeenCalled();
      expect(ctx.event).toHaveBeenCalledWith(expect.anything(), 'eventos-recomendacoes', 'RECOMENDACAO_GERADA', r.json().projetoId, expect.anything());
    } finally { await app.close(); }
  });
  it('obtém projeto existente por MQ quando recebe projetoId', async () => {
    const ctx = setup(); const app = Fastify(); await api(app, ctx.store, ctx.bus);
    try {
      const r = await app.inject({ method: 'POST', url: '/recomendacoes', payload: { projetoId: 'projeto-1' } });
      expect(r.statusCode).toBe(201);
      expect(ctx.rpc).toHaveBeenCalledWith('consulta-projetos', { operacao: 'obter', id: 'projeto-1' });
    } finally { await app.close(); }
  });
  it('rejeita solicitação sem projeto e sem projetoId', async () => {
    const ctx = setup(); const app = Fastify(); await api(app, ctx.store, ctx.bus);
    try {
      const r = await app.inject({ method: 'POST', url: '/recomendacoes', payload: {} });
      expect(r.statusCode).toBe(400); expect(ctx.rpc).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('não grava sucesso nem evento se a consulta ao broker falhar', async () => {
    const ctx = setup(); ctx.rpc.mockRejectedValueOnce(new Error('Timeout MQ') as never);
    const app = Fastify(); await api(app, ctx.store, ctx.bus);
    try {
      const r = await app.inject({ method: 'POST', url: '/recomendacoes', payload: { projeto } });
      expect(r.statusCode).toBe(500); expect(ctx.put).not.toHaveBeenCalled(); expect(ctx.event).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('valida dados do projeto que chegam por AMQP', async () => {
    const ctx = setup(); const consume = jest.fn(); const app = Fastify();
    await projetos(app, ctx.store, { ...ctx.bus, consume } as unknown as Bus);
    try {
      const handler = consume.mock.calls[0][1];
      await expect(handler({ operacao: 'criar', id: 'p-1', dados: { projeto: { nome: 'Inválido' } } })).rejects.toThrow('Dados de projeto inválidos');
      expect(ctx.put).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
