import { Injectable, Logger } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import {
  ActivityAction,
  OperationType,
  type Prisma,
} from '../generated/prisma/client.js';
import {
  contentTypeOf,
  detectImageType,
} from '../id-photos/id-photo-storage.js';
import {
  invalidPhoto,
  PHOTO_REQUIRED,
  PHOTO_TYPE,
} from '../id-photos/id-photos.errors.js';
import { operationNotFound } from '../ledger/ledger.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { orderNotFound } from '../orders/orders.errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockStoreNotClosed } from '../store-access/verified-store.js';
import type { ProofView } from './dto/proof-view.js';
import { ProofStorage } from './proof-storage.js';
import {
  MAX_PROOFS_PER_TARGET,
  proofLimitReached,
  proofNotFound,
  proofTargetNotAllowed,
} from './transaction-proofs.errors.js';

/** What a proof is attached to. */
export type ProofTarget =
  { kind: 'operation'; id: string } | { kind: 'order'; id: string };

/** Where the target is looked for: always a store, and an account when known. */
export interface ProofScope {
  storeId: string;
  accountId?: string;
}

type Tx = Prisma.TransactionClient;

/**
 * The photos of the paper behind a deposit or a material order (24). A proof
 * never changes what it is attached to: nothing here writes to an operation, an
 * order, or a balance.
 */
@Injectable()
export class TransactionProofsService {
  private readonly logger = new Logger(TransactionProofsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProofStorage,
  ) {}

  /** The scope of the account's holder: anyone else's account is a 404. */
  async customerScope(userId: string, accountId: string): Promise<ProofScope> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: userId },
      select: { id: true, storeId: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    return { storeId: account.storeId, accountId: account.id };
  }

  /**
   * Attaches a photo. The file is written first, then the row; a refused request
   * removes the file. A crash in between can only leave an unused file, never a
   * row pointing to a missing one.
   */
  async attach(
    scope: ProofScope,
    actor: AuthenticatedUser,
    target: ProofTarget,
    file: Express.Multer.File | undefined,
  ): Promise<ProofView> {
    if (!file) {
      throw invalidPhoto(PHOTO_REQUIRED);
    }
    // The content decides, never the client's file name or Content-Type.
    const type = detectImageType(file.buffer);
    if (!type) {
      throw invalidPhoto(PHOTO_TYPE);
    }

    const fileName = await this.storage.save(file.buffer, type);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockStoreNotClosed(tx, scope.storeId);
        const { accountId, allowed } = await this.findTarget(tx, scope, target);
        if (!allowed) {
          throw proofTargetNotAllowed();
        }
        // FOR UPDATE: two uploads run one after the other, so each counts the
        // other's proof. The existing lock order; the row itself does not change.
        const [account] = await tx.$queryRaw<{ customerId: string }[]>`
          SELECT "customerId" FROM "accounts"
          WHERE "id" = ${accountId}::uuid FOR UPDATE`;
        const live = await tx.transactionProof.count({
          where: { ...this.targetWhere(target), removedAt: null },
        });
        if (live >= MAX_PROOFS_PER_TARGET) {
          throw proofLimitReached();
        }

        const proof = await tx.transactionProof.create({
          data: {
            storeId: scope.storeId,
            accountId,
            ...this.targetWhere(target),
            fileName,
            uploadedById: actor.userId,
          },
        });
        await tx.activityLog.create({
          data: {
            storeId: scope.storeId,
            userId: actor.userId,
            action: ActivityAction.PROOF_ATTACHED,
            // Never the file name: the log is read by every manager.
            newValue: { proofId: proof.id, ...this.targetWhere(target) },
            device: actor.deviceId,
          },
        });
        return {
          id: proof.id,
          createdAt: proof.createdAt,
          uploadedBy:
            actor.userId === account.customerId ? 'CUSTOMER' : 'STORE',
        };
      });
    } catch (error) {
      // The answer stays the real one (404, 409...): a failed cleanup only
      // leaves an unused file.
      await this.removeQuietly(fileName, 'A refused proof');
      throw error;
    }
  }

  /** The live proofs of a target, oldest first. */
  async list(scope: ProofScope, target: ProofTarget): Promise<ProofView[]> {
    await this.findTarget(this.prisma, scope, target);
    const proofs = await this.prisma.transactionProof.findMany({
      where: { ...this.targetWhere(target), removedAt: null },
      // id breaks ties within one millisecond (uuid v7 is time-ordered).
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { account: { select: { customerId: true } } },
    });
    return proofs.map((proof) => ({
      id: proof.id,
      createdAt: proof.createdAt,
      uploadedBy:
        proof.uploadedById === proof.account.customerId ? 'CUSTOMER' : 'STORE',
    }));
  }

  /** A live proof's image. Views are not logged, like identity photos. */
  async file(
    scope: ProofScope,
    proofId: string,
  ): Promise<{ content: Buffer; contentType: string }> {
    const proof = await this.prisma.transactionProof.findFirst({
      where: { id: proofId, ...scope, removedAt: null },
      select: { fileName: true },
    });
    if (!proof?.fileName) {
      throw proofNotFound();
    }
    const content = await this.storage.read(proof.fileName);
    if (!content) {
      // A row points to a file that is gone: an operator problem, logged
      // without the customer's data.
      this.logger.warn('A proof file is missing from PROOF_DIR');
      throw proofNotFound();
    }
    return { content, contentType: contentTypeOf(proof.fileName) };
  }

  /**
   * Removes a proof, on a manager's word and with a reason. The row stays, with
   * who, when, and why; the file goes once that is committed. A failure there is
   * only a warning: the proof is already out of every view.
   */
  async remove(
    storeId: string,
    actor: AuthenticatedUser,
    proofId: string,
    reason: string,
  ): Promise<void> {
    const fileName = await this.prisma.$transaction(async (tx) => {
      const proof = await tx.transactionProof.findFirst({
        where: { id: proofId, storeId, removedAt: null },
        select: { fileName: true },
      });
      if (!proof) {
        throw proofNotFound();
      }
      // Conditional: of two removals in parallel, one finds nothing left to do.
      const { count } = await tx.transactionProof.updateMany({
        where: { id: proofId, removedAt: null },
        data: {
          fileName: null,
          removedAt: new Date(),
          removedById: actor.userId,
          removalReason: reason,
        },
      });
      if (count === 0) {
        throw proofNotFound();
      }
      await tx.activityLog.create({
        data: {
          storeId,
          userId: actor.userId,
          action: ActivityAction.PROOF_REMOVED,
          newValue: { proofId, reason },
          device: actor.deviceId,
        },
      });
      return proof.fileName;
    });
    if (fileName) {
      await this.removeQuietly(fileName, 'A removed proof');
    }
  }

  /** The target in this scope, or a 404. Another store's answers the same. */
  private async findTarget(
    client: Tx | PrismaService,
    scope: ProofScope,
    target: ProofTarget,
  ): Promise<{ accountId: string; allowed: boolean }> {
    if (target.kind === 'operation') {
      const operation = await client.operation.findFirst({
        where: { id: target.id, ...scope },
        select: { accountId: true, type: true },
      });
      if (!operation) {
        throw operationNotFound();
      }
      return {
        accountId: operation.accountId,
        allowed: operation.type === OperationType.DEPOSIT,
      };
    }
    const order = await client.materialOrder.findFirst({
      where: { id: target.id, ...scope },
      select: { accountId: true },
    });
    if (!order) {
      throw orderNotFound();
    }
    return { accountId: order.accountId, allowed: true };
  }

  private targetWhere(target: ProofTarget) {
    return target.kind === 'operation'
      ? { operationId: target.id }
      : { orderId: target.id };
  }

  /**
   * Removes a file and only warns when that fails. The warning holds the error
   * code, never its message: a Node fs message contains the file's path.
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
