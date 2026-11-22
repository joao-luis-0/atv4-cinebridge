import 'reflect-metadata';
import Fastify from 'fastify';
import { Store } from './store';
import { Bus, RpcError } from './bus';
import { Outbox } from './outbox';
import { api, profissionais, projetos } from './services';
import { registrarHealth } from './health';
import { notificacoes } from './notifications';

export async function start(): Promise<void> {
  const role = process.env.SERVICE_NAME ?? 'cinebridge-api';
  const store = new Store();
  store.pool.on('error', e => console.error('PostgreSQL:', e.message));
  const bus = new Bus();
  const outbox = new Outbox(store, bus);
  const app = Fastify({ logger: true });
  app.setErrorHandler((error, _req, reply) => {
    app.log.error(error);
    const status = error.validation ? 400 : error instanceof RpcError ? 422 : 503;
    void reply.code(status).send({ erro: error.message });
  });
  await store.init(); await bus.init();
  registrarHealth(app, store, bus, role);
  const registradores: Record<string, typeof api> = { 'cinebridge-api': api, 'cinebridge-profissionais': profissionais, 'cinebridge-projetos': projetos, 'cinebridge-notificacoes': notificacoes };
  if (!registradores[role]) throw new Error(`Serviço inválido: ${role}`);
  await registradores[role](app, store, bus);
  outbox.start();
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
  let encerrando = false;
  const fechar = async () => {
    if (encerrando) return; encerrando = true;
    await app.close(); await outbox.stop(); await bus.close(); await store.pool.end();
  };
  process.on('SIGTERM', () => { void fechar().catch(console.error); });
  process.on('SIGINT', () => { void fechar().catch(console.error); });
}
if (require.main === module) void start().catch(e => { console.error(e); process.exit(1); });
