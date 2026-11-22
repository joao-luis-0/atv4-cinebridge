import Fastify from 'fastify';
import { registrarHealth } from '../../../src/distributed/health';
import { Store } from '../../../src/distributed/store';
import { Bus } from '../../../src/distributed/bus';

it.each(['ok', 'postgres-offline', 'rabbitmq-offline'])('health verifica as dependências reais: %s', async estado => {
  const query = estado === 'postgres-offline' ? jest.fn().mockRejectedValue(new Error('offline')) : jest.fn().mockResolvedValue({ rows: [] });
  const health = estado === 'rabbitmq-offline' ? jest.fn().mockRejectedValue(new Error('offline')) : jest.fn().mockResolvedValue(undefined);
  const app = Fastify();
  registrarHealth(app, { pool: { query } } as unknown as Store, { health } as unknown as Bus, 'cinebridge-api');
  try {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(estado === 'ok' ? 200 : 503);
    expect(query).toHaveBeenCalledWith('SELECT 1'); expect(health).toHaveBeenCalled();
  } finally { await app.close(); }
});
