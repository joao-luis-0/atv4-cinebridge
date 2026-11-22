import { FastifyInstance } from 'fastify';
import nodemailer from 'nodemailer';
import { Bus } from './bus';
import { Evento, Store } from './store';

interface Observador { notificar(evento: Evento): Promise<void> }
class ObservadorLog implements Observador {
  async notificar(evento: Evento): Promise<void> { console.info(JSON.stringify({ canal: 'alerta', evento: evento.tipo, id: evento.id, agregadoId: evento.agregadoId })); }
}
class ObservadorEmail implements Observador {
  private readonly transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 5000, socketTimeout: 10000
  });
  async notificar(evento: Evento): Promise<void> {
    await this.transport.sendMail({ from: process.env.SMTP_FROM, to: process.env.NOTIFICATION_EMAIL,
      messageId: `<${evento.id}@cinebridge.local>`, subject: `Cinebridge: ${evento.tipo}`, text: JSON.stringify(evento, null, 2) });
  }
}
export async function notificacoes(app: FastifyInstance, store: Store, bus: Bus): Promise<void> {
  const observadores: Observador[] = [new ObservadorLog()];
  if (process.env.SMTP_HOST && process.env.NOTIFICATION_EMAIL) observadores.push(new ObservadorEmail());
  app.get('/notificacoes', async () => store.list());
  for (const fila of ['eventos-projetos', 'eventos-recomendacoes', 'eventos-convites']) {
    await bus.consume(fila, async dados => {
      const evento = dados as Evento;
      if (!evento.id || !evento.tipo) throw new Error('Evento inválido');
      await store.tx(async c => {
        const inserted = await c.query('INSERT INTO inbox(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [evento.id]);
        if (!inserted.rowCount) return;
        for (const observer of observadores) await observer.notificar(evento);
        await store.put(evento.id, { id: evento.id, tipo: evento.tipo, agregadoId: evento.agregadoId, mensagem: `Alerta: ${evento.tipo}`, evento,
          canais: process.env.SMTP_HOST && process.env.NOTIFICATION_EMAIL ? ['INTERNA', 'EMAIL'] : ['INTERNA', 'LOG'], status: 'ENVIADA', criadoEm: new Date().toISOString() }, c);
      });
    });
  }
}
