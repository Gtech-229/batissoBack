import { mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/** The test photo directory, from `ID_PHOTO_DIR` in .env.test. */
export const PHOTO_DIR = resolve(process.env.ID_PHOTO_DIR!);

/**
 * Small files that only need the right first bytes: the API checks the type from
 * the content and never decodes the image.
 */
export const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('jpeg body', 'utf8'),
]);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png body', 'utf8'),
]);
export const GIF = Buffer.from('GIF89a gif body', 'ascii');

/** The names of the files in the test photo directory, sorted. */
export async function storedPhotos(): Promise<string[]> {
  return (await readdir(PHOTO_DIR)).sort();
}

/** Empties the test photo directory (it stays in place for the API). */
export async function clearPhotos(): Promise<void> {
  await rm(PHOTO_DIR, { recursive: true, force: true });
  await mkdir(PHOTO_DIR, { recursive: true });
}
