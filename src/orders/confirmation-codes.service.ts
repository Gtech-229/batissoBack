import { Inject, Injectable, Logger } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../admin-auth/secrets.js';
import {
  MaterialOrderStatus,
  OrderConfirmationChannel,
} from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { maskPhone } from '../mobile-auth/mobile-auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SMS_SENDER, type SmsSender } from '../sms/sms-sender.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { lockStoreNotClosed } from '../store-access/verified-store.js';
import {
  CONFIRMATION_CODE_COOLDOWN_MS,
  CONFIRMATION_CODE_TTL_MS,
  confirmationCodeMessage,
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_ORDER,
  newConfirmationCode,
} from './confirmation-code.js';
import { OrderConfirmationService } from './order-confirmation.service.js';
import {
  codeCooldown,
  codeLimit,
  invalidCode,
  orderNotFound,
  orderStatusConflict,
} from './orders.errors.js';

/**
 * Confirmation by SMS code, for customers without the app (user decision,
 * 2026-10-27): at the counter, staff have a code texted to the customer, who
 * reads it out; staff enter it and the order is debited. The code is bound to
 * one order, valid 10 minutes, stored hashed, and never logged.
 */
@Injectable()
export class ConfirmationCodesService {
  private readonly logger = new Logger(ConfirmationCodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly confirmation: OrderConfirmationService,
  ) {}

  /**
   * Texts a new code for an order awaiting the customer. Only the newest code
   * works: asking again retires the previous one. A 60-second cooldown and 5
   * codes per order at most. Returns when the code expires.
   */
  async request(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    orderId: string,
  ): Promise<{ expiresAt: Date }> {
    const code = newConfirmationCode();
    // The slow scrypt work happens before the transaction (short row locks).
    const codeHash = await hashPassword(code);

    const sent = await this.prisma.$transaction(async (tx) => {
      await lockStoreNotClosed(tx, store.storeId);
      // FOR UPDATE: two requests for one order run one after the other, so
      // the cooldown and the limit see each other's code.
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "material_orders"
        WHERE "id" = ${orderId}::uuid AND "storeId" = ${store.storeId}::uuid
        FOR UPDATE`;
      if (!locked) {
        throw orderNotFound();
      }
      const order = await tx.materialOrder.findUniqueOrThrow({
        where: { id: locked.id },
        include: {
          account: {
            select: {
              currencyCode: true,
              customer: { select: { phone: true } },
            },
          },
          store: { select: { name: true } },
          confirmationCodes: {
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          },
        },
      });
      if (order.status !== MaterialOrderStatus.AWAITING_CUSTOMER) {
        throw orderStatusConflict(order.status);
      }
      const now = Date.now();
      const latest = order.confirmationCodes[0];
      if (latest) {
        const waited = now - latest.createdAt.getTime();
        if (waited < CONFIRMATION_CODE_COOLDOWN_MS) {
          throw codeCooldown(
            Math.ceil((CONFIRMATION_CODE_COOLDOWN_MS - waited) / 1000),
          );
        }
      }
      if (order.confirmationCodes.length >= MAX_CODES_PER_ORDER) {
        throw codeLimit();
      }

      await tx.orderConfirmationCode.updateMany({
        where: { orderId: order.id, consumedAt: null },
        data: { consumedAt: new Date(now) },
      });
      const expiresAt = new Date(now + CONFIRMATION_CODE_TTL_MS);
      await tx.orderConfirmationCode.create({
        data: {
          orderId: order.id,
          codeHash,
          expiresAt,
          requestedById: actor.userId,
        },
      });
      return {
        phone: order.account.customer.phone,
        text: confirmationCodeMessage({
          code,
          reference: order.reference,
          total: order.total,
          currencyCode: order.account.currencyCode,
          storeName: order.store.name,
        }),
        expiresAt,
      };
    });

    // After the commit, so the code exists before the customer reads it, and
    // not awaited: a slow or failing provider never fails the request; staff
    // can ask again after the cooldown.
    this.sms.send(sent.phone, sent.text).catch((error: unknown) => {
      const kind = error instanceof Error ? error.name : 'unknown error';
      this.logger.error(
        `Order code SMS to ${maskPhone(sent.phone)} failed (${kind})`,
      );
    });
    return { expiresAt: sent.expiresAt };
  }

  /**
   * Staff enter the code the customer read out: when it is the order's newest
   * live code, the order is debited (the code is used up in the debit's
   * transaction). A wrong entry counts; the 5th uses the code up. Every
   * failure is the same 400 INVALID_CODE. Idempotent: a retry with the same
   * key after success answers 200 without needing the (now used) code.
   */
  async confirm(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    orderId: string,
    code: string,
    idempotencyKey: string,
  ): Promise<{ replayed: boolean }> {
    const order = await this.prisma.materialOrder.findFirst({
      where: { id: orderId, storeId: store.storeId },
      select: { id: true, accountId: true },
    });
    if (!order) {
      throw orderNotFound();
    }
    const request = {
      storeId: store.storeId,
      accountId: order.accountId,
      orderId: order.id,
      channel: OrderConfirmationChannel.SMS_CODE,
      actorId: actor.userId,
      device: actor.deviceId,
      idempotencyKey,
    };
    if (await this.confirmation.isReplay(this.prisma, request)) {
      return { replayed: true };
    }

    const live = await this.prisma.orderConfirmationCode.findFirst({
      where: {
        orderId: order.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!live) {
      throw invalidCode();
    }
    if (!(await verifyPassword(code, live.codeHash))) {
      // Counted under the row lock and committed before the error, so retrying
      // cannot erase it; the 5th wrong entry uses the code up.
      await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<
          { attempts: number; consumedAt: Date | null }[]
        >`SELECT "attempts", "consumedAt" FROM "order_confirmation_codes"
          WHERE "id" = ${live.id}::uuid FOR UPDATE`;
        if (!row || row.consumedAt) {
          return;
        }
        const attempts = row.attempts + 1;
        await tx.orderConfirmationCode.update({
          where: { id: live.id },
          data: {
            attempts,
            consumedAt: attempts >= MAX_CODE_ATTEMPTS ? new Date() : null,
          },
        });
      });
      throw invalidCode();
    }
    return this.confirmation.debit({
      ...request,
      confirmationCodeId: live.id,
    });
  }
}
