import { EventEmitter } from 'events';
import amqp, { ConsumeMessage } from 'amqplib';
import { Bus } from '../../../src/distributed/bus';

jest.mock('amqplib', () => ({ __esModule: true, default: { connect: jest.fn() } }));
function fixture() {
  const callbacks = new Map<string, (msg: ConsumeMessage | null) => void>();
  const channel = Object.assign(new EventEmitter(), {
    prefetch: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue({}),
    consume: jest.fn(async (queue: string, fn: (msg: ConsumeMessage | null) => void) => { callbacks.set(queue, fn); }),
    sendToQueue: jest.fn((_q, _b, _o, cb) => cb(null)),
    ack: jest.fn(), nack: jest.fn(), checkQueue: jest.fn().mockResolvedValue({}), deleteQueue: jest.fn().mockResolvedValue({})
  });
  const connection = Object.assign(new EventEmitter(), { createConfirmChannel: jest.fn().mockResolvedValue(channel), close: jest.fn().mockResolvedValue(undefined) });
  (amqp.connect as jest.Mock).mockResolvedValue(connection);
  return { channel, callbacks, bus: new Bus() };
}
function message(data: unknown, properties: unknown = {}): ConsumeMessage {
  return { content: Buffer.from(JSON.stringify(data)), properties, fields: {} } as ConsumeMessage;
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

describe('Transporte RabbitMQ ATVIV', () => {
  it('declara filas duráveis, correlaciona resposta e confirma publicações persistentes', async () => {
    const { bus, channel, callbacks } = fixture(); await bus.init();
    try {
      expect(channel.assertQueue).toHaveBeenCalledWith('consulta-profissionais', expect.objectContaining({ durable: true }));
      const pending = bus.rpc('consulta-profissionais', { operacao: 'listar' });
      const options = channel.sendToQueue.mock.calls[0][2];
      expect(options.persistent).toBe(true); expect(options.correlationId).toBeTruthy();
      callbacks.get(options.replyTo)?.(message({ dados: [{ id: 'p1' }] }, { correlationId: options.correlationId }));
      await expect(pending).resolves.toEqual([{ id: 'p1' }]);
      expect(channel.ack).toHaveBeenCalled();
    } finally { await bus.close(); }
  });
  it('só confirma consumo após publicar a resposta RPC', async () => {
    const { bus, channel, callbacks } = fixture(); await bus.init();
    try {
      await bus.consume('consulta-profissionais', async () => ['Ana'], true);
      callbacks.get('consulta-profissionais')?.(message({ operacao: 'listar' }, { replyTo: 'retorno', correlationId: 'c1' }));
      await settle();
      expect(channel.sendToQueue.mock.calls[0][0]).toBe('retorno');
      expect(channel.sendToQueue.mock.invocationCallOrder[0]).toBeLessThan(channel.ack.mock.invocationCallOrder[0]);
    } finally { await bus.close(); }
  });
  it('republica falha transitória e envia mensagens esgotadas para a DLQ via nack', async () => {
    const { bus, channel, callbacks } = fixture(); await bus.init();
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await bus.consume('eventos-projetos', async () => { throw new Error('DB offline'); });
      callbacks.get('eventos-projetos')?.(message({ id: 'e1' }, { headers: { tentativa: 0 } }));
      await settle();
      expect(channel.sendToQueue.mock.calls[0][2].headers.tentativa).toBe(1);
      expect(channel.ack).toHaveBeenCalledTimes(1);
      const esgotada = message({ id: 'e1' }, { headers: { tentativa: 3 } });
      callbacks.get('eventos-projetos')?.(esgotada); await settle();
      expect(channel.nack).toHaveBeenCalledWith(esgotada, false, false);
    } finally { log.mockRestore(); await bus.close(); }
  });
  it('rejeita consulta por timeout e descarta resposta tardia com ACK', async () => {
    const { bus, channel, callbacks } = fixture(); await bus.init(); process.env.RPC_TIMEOUT_MS = '10';
    try {
      await expect(bus.rpc('consulta-profissionais', {})).rejects.toThrow('Timeout');
      const options = channel.sendToQueue.mock.calls[0][2];
      callbacks.get(options.replyTo)?.(message({ dados: [] }, { correlationId: options.correlationId }));
      expect(channel.ack).toHaveBeenCalledTimes(1);
    } finally { delete process.env.RPC_TIMEOUT_MS; await bus.close(); }
  });
});
