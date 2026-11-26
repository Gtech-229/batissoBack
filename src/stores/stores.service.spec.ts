import type { PrismaService } from '../prisma/prisma.service.js';
import { invalidStatusTransition, storeNotFound } from './stores.errors.js';
import { StoresService } from './stores.service.js';

describe('StoresService.changeStatusMany', () => {
  function serviceWith(changeStatus: StoresService['changeStatus']) {
    const service = new StoresService({} as PrismaService);
    const spy = vi
      .spyOn(service, 'changeStatus')
      .mockImplementation(changeStatus);
    return { service, spy };
  }

  it('runs each store in order, once, a refusal leaving the others', async () => {
    const { service, spy } = serviceWith(async (id) => {
      if (id === 'b') throw invalidStatusTransition('vérifier', 'vérifiée');
      if (id === 'c') throw storeNotFound();
      return {} as never;
    });

    const result = await service.changeStatusMany(
      ['a', 'b', 'a', 'c', 'd'],
      'verify',
      'admin-1',
    );

    expect(spy.mock.calls).toEqual([
      ['a', 'verify', 'admin-1', undefined],
      ['b', 'verify', 'admin-1', undefined],
      ['c', 'verify', 'admin-1', undefined],
      ['d', 'verify', 'admin-1', undefined],
    ]);
    expect(result).toEqual({
      results: [
        { id: 'a', ok: true },
        {
          id: 'b',
          ok: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: 'Impossible de vérifier une quincaillerie vérifiée',
          },
        },
        {
          id: 'c',
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Quincaillerie introuvable' },
        },
        { id: 'd', ok: true },
      ],
    });
  });

  it('passes the reason to every store', async () => {
    const { service, spy } = serviceWith(async () => ({}) as never);

    await service.changeStatusMany(['a', 'b'], 'suspend', 'admin-1', 'Motif');

    expect(spy.mock.calls.map((call) => call[3])).toEqual(['Motif', 'Motif']);
  });

  it('treats one UUID in any case as one store, reporting the first spelling (F-103)', async () => {
    const { service, spy } = serviceWith(async () => ({}) as never);
    const id = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

    const result = await service.changeStatusMany(
      [id.toUpperCase(), id, id.toUpperCase()],
      'verify',
      'admin-1',
    );

    expect(spy.mock.calls.map((call) => call[0])).toEqual([id.toUpperCase()]);
    expect(result).toEqual({ results: [{ id: id.toUpperCase(), ok: true }] });
  });

  it('lets an unexpected error fail the request', async () => {
    const { service } = serviceWith(async () => {
      throw new Error('connection lost');
    });

    await expect(
      service.changeStatusMany(['a'], 'close', 'admin-1', 'Motif'),
    ).rejects.toThrow('connection lost');
  });
});
