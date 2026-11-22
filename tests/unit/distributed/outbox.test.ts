import { Outbox } from '../../../src/distributed/outbox';
import { Store } from '../../../src/distributed/store';
import { Bus } from '../../../src/distributed/bus';

describe('Outbox transacional ATVIV', () => {
  const evento = { id: 'evt-1', tipo: 'PROJETO_CRIADO' };
  function setup(fail: boolean) {
    const query = jest.fn().mockResolvedValue({ rows: [{ id: 'evt-1', fila: 'eventos-projetos', evento }] });
    const tx = jest.fn(async action => action({ query }));
    const publish = fail ? jest.fn().mockRejectedValue(new Error('MQ indisponível')) : jest.fn().mockResolvedValue(undefined);
    const outbox = new Outbox({ tx } as unknown as Store, { publish } as unknown as Bus);
    return { query, publish, outbox };
  }
  it('publica mensagem persistente confirmada antes de marcar o evento como enviado', async () => {
    const { query, publish, outbox } = setup(false);
    await outbox.flush();
    expect(publish).toHaveBeenCalledWith('eventos-projetos', evento, { messageId: 'evt-1' });
    expect(query).toHaveBeenLastCalledWith('UPDATE outbox SET enviado=true WHERE id=$1', ['evt-1']);
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[1]);
  });
  it('mantém evento pendente se o broker falhar, permitindo tentativa futura', async () => {
    const { query, outbox } = setup(true);
    await expect(outbox.flush()).rejects.toThrow('MQ indisponível');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
