import { FastifyInstance } from 'fastify';
import { Store } from './store';
import { Bus } from './bus';

export function registrarHealth(app: FastifyInstance, store: Store, bus: Bus, service: string): void {
  app.get('/health', async (_req, reply) => {
    try {
      await Promise.all([store.pool.query('SELECT 1'), bus.health()]);
      return { status: 'ok', service, postgres: 'ok', rabbitmq: 'ok' };
    } catch { return reply.code(503).send({ status: 'unavailable', service }); }
  });
}
