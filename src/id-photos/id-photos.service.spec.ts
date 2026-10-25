import { Logger, NotFoundException } from '@nestjs/common';
import type { AccountsService } from '../accounts/accounts.service.js';
import { accountNotFound } from '../accounts/accounts.errors.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { IdPhotoStorage } from './id-photo-storage.js';
import { IdPhotosService } from './id-photos.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const NEW_NAME = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d.jpg';
const OLD_NAME = '0192f0a4-0000-7c3e-9d2a-5e6f7a8b9c0d.jpg';
const store = {
  storeId: 's1',
  role: 'SELLER',
  storeStatus: 'VERIFIED',
} as const;
const actor = { userId: 'u1', sessionId: 'x1', deviceId: 'd1' };

/** What Node's fs throws: the message holds the full path, the code does not. */
const fsError = (name: string) =>
  Object.assign(
    new Error(`EPERM: operation not permitted, unlink 'C:\\photos\\${name}'`),
    { code: 'EPERM' },
  );

describe('IdPhotosService.upload, when a file cannot be removed', () => {
  let transaction: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let service: IdPhotosService;

  beforeEach(() => {
    transaction = vi.fn();
    remove = vi.fn((name: string) => Promise.reject(fsError(name)));
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new IdPhotosService(
      { $transaction: transaction } as unknown as PrismaService,
      {
        save: vi.fn().mockResolvedValue(NEW_NAME),
        remove,
      } as unknown as IdPhotoStorage,
      {
        detail: vi.fn().mockResolvedValue({ id: 'a1', hasIdPhoto: true }),
      } as unknown as AccountsService,
    );
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const upload = () =>
    service.upload(store, actor, 'a1', { buffer: JPEG } as Express.Multer.File);
  const warnings = () =>
    warn.mock.calls.map((call: unknown[]) => String(call[0]));

  it('still answers with the detail when the old file stays (F-01)', async () => {
    transaction.mockResolvedValue(OLD_NAME);

    await expect(upload()).resolves.toEqual({ id: 'a1', hasIdPhoto: true });

    expect(remove).toHaveBeenCalledWith(OLD_NAME);
    expect(warnings()).toEqual([
      'A replaced identity photo could not be removed from disk (EPERM)',
    ]);
  });

  it('keeps the original 404 when the cleanup of the new file fails (F-02)', async () => {
    transaction.mockRejectedValue(accountNotFound());

    const failure = upload();

    await expect(failure).rejects.toBeInstanceOf(NotFoundException);
    await expect(failure).rejects.toThrow('Compte introuvable');
    expect(remove).toHaveBeenCalledWith(NEW_NAME);
    expect(warnings()).toEqual([
      'A refused identity photo upload could not be removed from disk (EPERM)',
    ]);
  });

  it('never logs a path or a file name', async () => {
    transaction.mockResolvedValue(OLD_NAME);
    await upload();
    transaction.mockRejectedValue(accountNotFound());
    await upload().catch(() => undefined);

    for (const message of warnings()) {
      expect(message).not.toMatch(/photos|\.jpg|\\|\//);
    }
  });
});
