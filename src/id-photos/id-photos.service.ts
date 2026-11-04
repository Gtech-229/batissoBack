import { Injectable, Logger } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import { AccountsService } from '../accounts/accounts.service.js';
import type { AccountDetail } from '../accounts/dto/account-detail.js';
import { ActivityAction } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { lockVerifiedStore } from '../store-access/verified-store.js';
import {
  contentTypeOf,
  detectImageType,
  IdPhotoStorage,
} from './id-photo-storage.js';
import {
  invalidPhoto,
  noIdPhoto,
  PHOTO_REFUSAL,
  PHOTO_REQUIRED,
  PHOTO_TYPE,
} from './id-photos.errors.js';

/**
 * Customers' identity photos. The account is always looked up with the guard's
 * store, so a photo can only be attached to, or read from, this store's account.
 */
@Injectable()
export class IdPhotosService {
  private readonly logger = new Logger(IdPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: IdPhotoStorage,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Uploads or replaces the account's photo. The file is written first, then the
   * database points to it; the old file is removed only after that commit. A
   * crash in between can only leave an unused file, never a path to a missing
   * one.
   */
  async upload(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    accountId: string,
    file: Express.Multer.File | undefined,
  ): Promise<AccountDetail> {
    if (!file) {
      throw invalidPhoto(PHOTO_REQUIRED);
    }
    // The content decides, never the client's file name or Content-Type.
    const type = detectImageType(file.buffer);
    if (!type) {
      throw invalidPhoto(PHOTO_TYPE);
    }

    const name = await this.storage.save(file.buffer, type);
    let previous: string | null;
    try {
      previous = await this.prisma.$transaction(async (tx) => {
        await lockVerifiedStore(tx, store.storeId, PHOTO_REFUSAL);
        // FOR UPDATE: two uploads to the same account run one after the other,
        // so each sees the other's file and removes it.
        const [account] = await tx.$queryRaw<
          { id: string; idPhotoPath: string | null }[]
        >`
          SELECT "id", "idPhotoPath" FROM "accounts"
          WHERE "id" = ${accountId}::uuid AND "storeId" = ${store.storeId}::uuid
          FOR UPDATE`;
        if (!account) {
          throw accountNotFound();
        }
        await tx.account.update({
          where: { id: accountId },
          data: { idPhotoPath: name },
        });
        await tx.activityLog.create({
          data: {
            storeId: store.storeId,
            userId: actor.userId,
            action: ActivityAction.ID_PHOTO_UPLOADED,
            // Never the file name: the log is read by every manager.
            // account.id, not the URL's spelling: ids are logged in lowercase.
            newValue: {
              accountId: account.id,
              replaced: account.idPhotoPath !== null,
            },
            device: actor.deviceId,
          },
        });
        return account.idPhotoPath;
      });
    } catch (error) {
      // The answer stays the real one (404, 409...): a failed cleanup only
      // leaves an unused file (F-02).
      await this.removeQuietly(name, 'A refused identity photo upload');
      throw error;
    }

    if (previous) {
      // The new photo is saved: failing to delete the old file must not fail
      // the request. It only leaves an unused file.
      await this.removeQuietly(previous, 'A replaced identity photo');
    }
    return this.accounts.detail(store.storeId, accountId, actor.userId);
  }

  /**
   * Removes a file and only warns when that fails. The warning holds the error
   * code, never its message: a Node fs message contains the file's path (F-01).
   */
  private async removeQuietly(name: string, what: string): Promise<void> {
    try {
      await this.storage.remove(name);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
      this.logger.warn(`${what} could not be removed from disk (${code})`);
    }
  }

  /**
   * The photo of this store's account, as bytes and their type. Views are not
   * logged (decided by the user, 2026-10-15).
   */
  async view(
    storeId: string,
    accountId: string,
  ): Promise<{ content: Buffer; contentType: string }> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, storeId },
      select: { idPhotoPath: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    if (!account.idPhotoPath) {
      throw noIdPhoto();
    }
    const content = await this.storage.read(account.idPhotoPath);
    if (!content) {
      // The database points to a file that is gone (deleted by hand, lost
      // volume): an operator problem, logged without the customer's data.
      this.logger.warn('An identity photo file is missing from ID_PHOTO_DIR');
      throw noIdPhoto();
    }
    return { content, contentType: contentTypeOf(account.idPhotoPath) };
  }
}
