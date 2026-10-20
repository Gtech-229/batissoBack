import { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contentTypeOf,
  detectImageType,
  IdPhotoStorage,
  isPhotoName,
} from './id-photo-storage.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const NAME = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d.jpg';

async function readAll(stream: ReadStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

describe('detectImageType', () => {
  it('recognizes JPEG and PNG from their first bytes', () => {
    expect(detectImageType(JPEG)).toBe('jpeg');
    expect(detectImageType(PNG)).toBe('png');
  });

  it.each([
    ['a GIF', Buffer.from('GIF89a', 'ascii')],
    ['a text file named .jpg', Buffer.from('not an image', 'utf8')],
    ['an empty file', Buffer.alloc(0)],
    ['a truncated PNG signature', PNG.subarray(0, 4)],
  ])('refuses %s', (_, content) => {
    expect(detectImageType(content)).toBeNull();
  });
});

describe('isPhotoName', () => {
  it('accepts a generated name', () => {
    expect(isPhotoName(NAME)).toBe(true);
    expect(isPhotoName(NAME.replace('.jpg', '.png'))).toBe(true);
  });

  it.each([
    '../x.jpg',
    'a/b.jpg',
    'a\\b.jpg',
    NAME.replace('.jpg', '.gif'),
    '',
  ])('refuses %j', (name) => {
    expect(isPhotoName(name)).toBe(false);
  });
});

describe('contentTypeOf', () => {
  it('gives the served type from the stored extension', () => {
    expect(contentTypeOf(NAME)).toBe('image/jpeg');
    expect(contentTypeOf(NAME.replace('.jpg', '.png'))).toBe('image/png');
  });
});

describe('IdPhotoStorage', () => {
  let directory: string;
  let storage: IdPhotoStorage;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'id-photos-'));
    // A directory that does not exist yet: the module creates it at startup.
    directory = join(root, 'nested', 'photos');
    storage = new IdPhotoStorage(
      new ConfigService({ ID_PHOTO_DIR: directory }),
    );
    await storage.onModuleInit();
  });

  afterEach(async () => {
    await rm(join(directory, '..', '..'), { recursive: true, force: true });
  });

  it('saves under a generated name, reads it back, then removes it', async () => {
    const name = await storage.save(JPEG, 'jpeg');

    expect(isPhotoName(name)).toBe(true);
    expect(name.endsWith('.jpg')).toBe(true);
    const stream = await storage.open(name);
    expect(stream).not.toBeNull();
    expect(await readAll(stream!)).toEqual(JPEG);

    await storage.remove(name);
    expect(await readdir(directory)).toEqual([]);
  });

  it('gives each upload its own file', async () => {
    const first = await storage.save(PNG, 'png');
    const second = await storage.save(PNG, 'png');

    expect(first).not.toBe(second);
    expect((await readdir(directory)).sort()).toEqual([first, second].sort());
  });

  it('answers null for a missing file and ignores removing one', async () => {
    expect(await storage.open(NAME)).toBeNull();
    await expect(storage.remove(NAME)).resolves.toBeUndefined();
  });

  it('refuses a name it did not generate before touching the disk', async () => {
    await expect(storage.open('../secret.jpg')).rejects.toThrow(
      'Invalid identity photo name',
    );
    await expect(storage.remove('a/b.jpg')).rejects.toThrow(
      'Invalid identity photo name',
    );
  });
});
