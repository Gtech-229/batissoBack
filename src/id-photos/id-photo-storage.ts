import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EnvironmentVariables } from '../config/env.validation.js';

/** The image formats accepted for an identity photo. */
export type ImageType = 'jpeg' | 'png';

const EXTENSIONS: Record<ImageType, string> = { jpeg: 'jpg', png: 'png' };
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
};

// Only names this service generates: a uuid and a known extension. Checked before
// any path is built, so a stored value can never point outside the directory.
const PHOTO_NAME = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png)$/;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * The image type from the file's first bytes (its "magic number"). The client's
 * file name and Content-Type are never trusted: anyone can call a text file
 * `photo.jpg` and send it as `image/jpeg`.
 */
export function detectImageType(content: Buffer): ImageType | null {
  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  return null;
}

export function isPhotoName(name: string): boolean {
  return PHOTO_NAME.test(name);
}

/** `image/jpeg` or `image/png`, from a stored photo name. */
export function contentTypeOf(name: string): string {
  return CONTENT_TYPES[name.slice(name.lastIndexOf('.') + 1)];
}

/**
 * The private directory of the identity photos (`ID_PHOTO_DIR`). Every
 * filesystem call on photos goes through here. Files are never overwritten: each
 * upload gets a new name, and the caller removes the old file once the database
 * points to the new one.
 */
@Injectable()
export class IdPhotoStorage implements OnModuleInit {
  private readonly directory: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.directory = resolve(config.get('ID_PHOTO_DIR', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  /** Writes a new file and returns its generated name. */
  async save(content: Buffer, type: ImageType): Promise<string> {
    const name = `${randomUUID()}.${EXTENSIONS[type]}`;
    // `wx`: fails instead of overwriting, should a name ever repeat.
    await writeFile(this.pathOf(name), content, { flag: 'wx' });
    return name;
  }

  /** A read stream of the file, or null when it is not on disk. */
  async open(name: string): Promise<ReadStream | null> {
    try {
      const handle = await open(this.pathOf(name), 'r');
      return handle.createReadStream();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /** Deletes the file; a file already gone is not an error. */
  async remove(name: string): Promise<void> {
    try {
      await unlink(this.pathOf(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private pathOf(name: string): string {
    if (!isPhotoName(name)) {
      throw new Error('Invalid identity photo name');
    }
    return join(this.directory, name);
  }
}
