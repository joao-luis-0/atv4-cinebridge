import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';

export interface Evento { id: string; tipo: string; agregadoId: string; dados: unknown; criadoEm: string }
export class Store {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS documentos (id TEXT PRIMARY KEY, dados JSONB NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT now());
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, fila TEXT NOT NULL, evento JSONB NOT NULL, enviado BOOLEAN NOT NULL DEFAULT false);
      CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, recebido_em TIMESTAMPTZ DEFAULT now());
    `);
  }
  async tx<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const result = await action(c); await c.query('COMMIT'); return result; }
    catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
  async get<T>(id: string): Promise<T | undefined> {
    return (await this.pool.query('SELECT dados FROM documentos WHERE id=$1', [id])).rows[0]?.dados;
  }
  async list<T>(): Promise<T[]> {
    return (await this.pool.query('SELECT dados FROM documentos ORDER BY id')).rows.map(r => r.dados);
  }
  async put(id: string, dados: unknown, client: PoolClient | Pool = this.pool): Promise<void> {
    await client.query(`INSERT INTO documentos(id,dados) VALUES($1,$2::jsonb)
      ON CONFLICT(id) DO UPDATE SET dados=EXCLUDED.dados, atualizado_em=now()`, [id, JSON.stringify(dados)]);
  }
  async event(client: PoolClient, fila: string, tipo: string, agregadoId: string, dados: unknown): Promise<void> {
    const evento: Evento = { id: randomUUID(), tipo, agregadoId, dados, criadoEm: new Date().toISOString() };
    await client.query('INSERT INTO outbox(id,fila,evento) VALUES($1,$2,$3::jsonb)', [evento.id, fila, JSON.stringify(evento)]);
  }
}
