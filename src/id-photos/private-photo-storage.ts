import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The image formats accepted for a private photo. */
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

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * A Node fs error message holds the file's absolute path. What leaves this
 * service only names the action and the code (`ENOSPC`, `EACCES`...), so the
 * 500 log never shows the directory or a file name (F-04).
 */
function storageFailure(label: string, action: string, error: unknown): Error {
  const code = errorCode(error) ?? 'unknown';
  // The code stays readable for callers (a code is never a path).
  return Object.assign(new Error(`${label} ${action} failed (${code})`), {
    code,
  });
}

/** `image/jpeg` or `image/png`, from a stored photo name. */
export function contentTypeOf(name: string): string {
  return CONTENT_TYPES[name.slice(name.lastIndexOf('.') + 1)];
}

/**
 * A private directory of photos: identity photos, and proofs of transactions.
 * Every filesystem call on them goes through here. Files are never overwritten:
 * each upload gets a new name, and the caller removes the old file once the
 * database has moved on.
 */
export class PrivatePhotoStorage {
  constructor(
    private readonly directory: string,
    private readonly label: string,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  /** Writes a new file and returns its generated name. */
  async save(content: Buffer, type: ImageType): Promise<string> {
    const name = `${randomUUID()}.${EXTENSIONS[type]}`;
    const path = this.pathOf(name);
    try {
      // `wx`: fails instead of overwriting, should a name ever repeat.
      await writeFile(path, content, { flag: 'wx' });
    } catch (error) {
      throw storageFailure(this.label, 'write', error);
    }
    return name;
  }

  /**
   * The file's bytes, or null when it is not on disk. Read whole (at most 5 MB):
   * no file stays open while the answer is sent, and no read error can happen
   * once it has started (F-05, F-04).
   */
  async read(name: string): Promise<Buffer | null> {
    const path = this.pathOf(name);
    try {
      return await readFile(path);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return null;
      }
      throw storageFailure(this.label, 'read', error);
    }
  }

  /** Deletes the file; a file already gone is not an error. */
  async remove(name: string): Promise<void> {
    const path = this.pathOf(name);
    try {
      await unlink(path);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        throw storageFailure(this.label, 'removal', error);
      }
    }
  }

  private pathOf(name: string): string {
    if (!isPhotoName(name)) {
      throw new Error(`Invalid ${this.label.toLowerCase()} name`);
    }
    return join(this.directory, name);
  }
}
