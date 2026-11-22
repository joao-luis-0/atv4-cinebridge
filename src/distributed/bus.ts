import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import { randomUUID } from 'crypto';

export const FILAS = ['consulta-profissionais', 'consulta-projetos', 'eventos-projetos', 'eventos-recomendacoes', 'eventos-convites'];
export class RpcError extends Error {}
export class Bus {
  private connection!: ChannelModel;
  private channel!: ConfirmChannel;
  private replyQueue = '';
  private closing = false;
  ready = false;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  async init(): Promise<void> {
    this.connection = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://guest:guest@cinebridge-mq:5672?heartbeat=10');
    this.connection.on('error', e => console.error('RabbitMQ:', e.message));
    this.connection.on('close', () => {
      this.ready = false;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('RabbitMQ desconectado')); }
      this.pending.clear();
      // O supervisor reinicia e restabelece canais, filas e consumidores.
      if (!this.closing) process.exit(1);
    });
    this.channel = await this.connection.createConfirmChannel();
    this.channel.on('error', e => console.error('Canal AMQP:', e.message));
    this.channel.on('close', () => { this.ready = false; if (!this.closing) process.exit(1); });
    await this.channel.prefetch(10);
    for (const fila of FILAS) {
      await this.channel.assertQueue(`${fila}.dlq`, { durable: true });
      await this.channel.assertQueue(fila, { durable: true, arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': `${fila}.dlq` } });
    }
    this.replyQueue = `respostas-${randomUUID()}`;
    await this.channel.assertQueue(this.replyQueue, { durable: true, arguments: { 'x-expires': 300000, 'x-message-ttl': 60000 } });
    await this.channel.consume(this.replyQueue, msg => {
      if (!msg) return;
      const p = this.pending.get(msg.properties.correlationId ?? '');
      if (p) {
        clearTimeout(p.timer); this.pending.delete(msg.properties.correlationId);
        try {
          const result = JSON.parse(msg.content.toString());
          if (result.erro) p.reject(new RpcError(result.erro)); else p.resolve(result.dados);
        } catch (e) { p.reject(e instanceof Error ? e : new Error(String(e))); }
      }
      this.channel.ack(msg);
    });
    this.ready = true;
  }
  publish(fila: string, dados: unknown, options: Options.Publish = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.channel.sendToQueue(fila, Buffer.from(JSON.stringify(dados)), {
          persistent: true, contentType: 'application/json', messageId: randomUUID(), ...options
        }, (error: unknown) => error ? reject(error) : resolve());
      } catch (e) { reject(e); }
    });
  }
  async rpc<T>(fila: string, dados: unknown): Promise<T> {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout ao consultar ${fila}`)); }, Number(process.env.RPC_TIMEOUT_MS ?? 15000));
      this.pending.set(id, { resolve: v => resolve(v as T), reject, timer });
      this.publish(fila, dados, { correlationId: id, replyTo: this.replyQueue, expiration: '60000' }).catch(e => {
        clearTimeout(timer); this.pending.delete(id); reject(e);
      });
    });
  }
  async consume(fila: string, handler: (dados: unknown, message: ConsumeMessage) => Promise<unknown>, rpc = false): Promise<void> {
    await this.channel.consume(fila, msg => {
      if (!msg) { this.ready = false; if (!this.closing) process.exit(1); return; }
      void (async () => {
        try {
          const result = await handler(JSON.parse(msg.content.toString()), msg);
          if (rpc && msg.properties.replyTo) await this.publish(msg.properties.replyTo, { dados: result }, { correlationId: msg.properties.correlationId });
          this.channel.ack(msg);
        } catch (e) {
          console.error(`Falha em ${fila}`, e);
          try {
            if (rpc && e instanceof RpcError && msg.properties.replyTo) {
              await this.publish(msg.properties.replyTo, { erro: e.message }, { correlationId: msg.properties.correlationId });
              this.channel.ack(msg); return;
            }
            const attempt = Number(msg.properties.headers?.tentativa ?? 0);
            if (attempt < 3) {
              // A cópia é confirmada antes de remover a entrega original.
              await this.publish(fila, JSON.parse(msg.content.toString()), { ...msg.properties, headers: { ...msg.properties.headers, tentativa: attempt + 1 } });
              this.channel.ack(msg);
            } else this.channel.nack(msg, false, false);
          } catch { this.channel.nack(msg, false, true); }
        }
      })();
    });
  }
  async health(): Promise<void> {
    if (!this.ready) throw new Error('RabbitMQ indisponível');
    await this.channel.checkQueue('consulta-profissionais');
  }
  async close(): Promise<void> {
    this.closing = true; this.ready = false;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Serviço encerrando')); }
    this.pending.clear();
    await this.channel.deleteQueue(this.replyQueue);
    await this.connection.close();
  }
}
