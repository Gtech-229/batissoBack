import { Injectable, Logger } from '@nestjs/common';
import type { StoreStatus } from '../generated/prisma/client.js';
import {
  contentTypeOf,
  detectImageType,
} from '../id-photos/private-photo-storage.js';
import { invalidPhoto, PHOTO_TYPE } from '../id-photos/id-photos.errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  toStoreDocuments,
  type StoreDocuments,
} from '../stores/dto/store-documents.js';
import { storeNotFound } from '../stores/stores.errors.js';
import { StoreDocumentStorage } from './store-document-storage.js';
import {
  DOCUMENT_REQUIRED,
  noStoreDocument,
  storeNotPending,
  type StoreDocumentKind,
} from './store-documents.errors.js';

/** The column that holds each document's file name. */
const COLUMNS = {
  identity: 'managerIdPhotoPath',
  'trade-register': 'tradeRegisterPhotoPath',
} as const satisfies Record<StoreDocumentKind, string>;

interface StoreDocumentRow {
  status: StoreStatus;
  managerIdPhotoPath: string | null;
  tradeRegisterPhotoPath: string | null;
}

/**
 * The registration documents of a store (21b): the manager's identity photo
 * and the trade register. The store is always the guard's one.
 */
@Injectable()
export class StoreDocumentsService {
  private readonly logger = new Logger(StoreDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StoreDocumentStorage,
  ) {}

  /**
   * Uploads or replaces one document while the store is PENDING. As for
   * identity photos: the file is written first, then the store points to it,
   * and the old file is removed only after that commit.
   */
  async upload(
    storeId: string,
    kind: StoreDocumentKind,
    file: Express.Multer.File | undefined,
  ): Promise<StoreDocuments> {
    if (!file) {
      throw invalidPhoto(DOCUMENT_REQUIRED);
    }
    // The content decides, never the client's file name or Content-Type.
    const type = detectImageType(file.buffer);
    if (!type) {
      throw invalidPhoto(PHOTO_TYPE);
    }

    const column = COLUMNS[kind];
    const name = await this.storage.save(file.buffer, type);
    let outcome: { previous: string | null; documents: StoreDocuments };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        // FOR UPDATE: a verification (which updates the row) waits for this
        // upload, or the reverse; two uploads run one after the other, so each
        // sees and removes the other's file.
        const [store] = await tx.$queryRaw<StoreDocumentRow[]>`
          SELECT "status", "managerIdPhotoPath", "tradeRegisterPhotoPath"
          FROM "hardware_stores" WHERE "id" = ${storeId}::uuid FOR UPDATE`;
        if (!store) {
          throw storeNotFound();
        }
        if (store.status !== 'PENDING') {
          throw storeNotPending(store.status);
        }
        const updated = await tx.hardwareStore.update({
          where: { id: storeId },
          data: { [column]: name },
          select: { managerIdPhotoPath: true, tradeRegisterPhotoPath: true },
        });
        return {
          previous: store[column],
          documents: toStoreDocuments(updated),
        };
      });
    } catch (error) {
      // The answer stays the real one (404, 409...): a failed cleanup only
      // leaves an unused file.
      await this.removeQuietly(name, 'A refused store document upload');
      throw error;
    }

    if (outcome.previous) {
      await this.removeQuietly(outcome.previous, 'A replaced store document');
    }
    return outcome.documents;
  }

  /**
   * One document of a store, as bytes and their type, for admins. 404 when the
   * store is unknown or the document was never sent.
   */
  async view(
    storeId: string,
    kind: StoreDocumentKind,
  ): Promise<{ content: Buffer; contentType: string }> {
    const column = COLUMNS[kind];
    const store = await this.prisma.hardwareStore.findUnique({
      where: { id: storeId },
      select: { managerIdPhotoPath: true, tradeRegisterPhotoPath: true },
    });
    if (!store) {
      throw storeNotFound();
    }
    const name = store[column];
    if (!name) {
      throw noStoreDocument();
    }
    const content = await this.storage.read(name);
    if (!content) {
      // The database points to a file that is gone: an operator problem.
      this.logger.warn(
        'A store document file is missing from STORE_DOCUMENT_DIR',
      );
      throw noStoreDocument();
    }
    return { content, contentType: contentTypeOf(name) };
  }

  /**
   * Removes a file and only warns when that fails, with the error code and
   * never its message (a Node fs message contains the file's path).
   */
  private async removeQuietly(name: string, what: string): Promise<void> {
    try {
      await this.storage.remove(name);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
      this.logger.warn(`${what} could not be removed from disk (${code})`);
    }
  }
}
