import { Store } from './store';
import { Bus } from './bus';

/** Publicação ao menos uma vez: alterações e eventos são gravados na mesma transação. */
export class Outbox {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  constructor(private readonly store: Store, private readonly bus: Bus) {}
  start(): void {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.flush().catch(e => console.error('Outbox: nova tentativa no próximo ciclo', e)).finally(() => { this.running = undefined; });
    }, 1000);
  }
  async flush(): Promise<void> {
    await this.store.tx(async c => {
      const rows = await c.query('SELECT id,fila,evento FROM outbox WHERE NOT enviado ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED');
      for (const r of rows.rows) {
        await this.bus.publish(r.fila, r.evento, { messageId: r.id });
        await c.query('UPDATE outbox SET enviado=true WHERE id=$1', [r.id]);
      }
    });
  }
  async stop(): Promise<void> { clearInterval(this.timer); await this.running; }
}
