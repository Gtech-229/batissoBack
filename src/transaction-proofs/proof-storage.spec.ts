import { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProofStorage } from './proof-storage.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('ProofStorage', () => {
  let directory: string;
  let storage: ProofStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'proofs-'));
    storage = new ProofStorage({
      get: () => directory,
    } as unknown as ConfigService<never, true>);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('saves, reads, and removes a file under a generated name', async () => {
    const name = await storage.save(JPEG, 'jpeg');

    expect(name).toMatch(/\.jpg$/);
    expect(await readdir(directory)).toEqual([name]);
    expect(await storage.read(name)).toEqual(JPEG);

    await storage.remove(name);

    expect(await storage.read(name)).toBeNull();
  });

  it('refuses a name it did not generate, before building a path', async () => {
    await expect(storage.read('../secret.jpg')).rejects.toThrow(
      'Invalid proof photo name',
    );
  });

  it('names no path in a failure', async () => {
    await rm(directory, { recursive: true, force: true });

    const failure = storage.save(JPEG, 'jpeg');

    await expect(failure).rejects.toThrow('Proof photo write failed (ENOENT)');
  });
});
