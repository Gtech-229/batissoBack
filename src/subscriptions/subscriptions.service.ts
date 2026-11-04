import { Injectable } from '@nestjs/common';
import { StoreStatus, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { storeNotFound } from '../stores/stores.errors.js';
import {
  toSubscriptionView,
  type CreateSubscriptionDto,
  type SubscriptionView,
  type UpdateSubscriptionDto,
} from './dto/subscription.dto.js';
import { dateToDay, dayToDate } from './subscription-status.js';
import {
  invalidSubscriptionPeriod,
  storeClosedForSubscription,
  subscriptionNotFound,
  subscriptionOverlap,
} from './subscriptions.errors.js';

/**
 * Store subscriptions recorded by admins (feature 16a). Recorded only: no
 * billing, no plan limits, nothing automatic when one ends.
 */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    storeId: string,
    data: CreateSubscriptionDto,
    adminId: string,
  ): Promise<SubscriptionView> {
    if (data.endsOn < data.startsOn) {
      throw invalidSubscriptionPeriod();
    }
    const subscription = await this.prisma.$transaction(async (tx) => {
      const status = await lockStore(tx, storeId);
      if (status === StoreStatus.CLOSED) {
        throw storeClosedForSubscription();
      }
      await refuseOverlap(tx, storeId, data.startsOn, data.endsOn);
      return tx.subscription.create({
        data: {
          storeId,
          plan: data.plan,
          startsOn: dayToDate(data.startsOn),
          endsOn: dayToDate(data.endsOn),
          createdById: adminId,
          updatedById: adminId,
        },
      });
    });
    return toSubscriptionView(subscription);
  }

  /**
   * Corrects the plan or the dates; ending early is a new `endsOn`. The same
   * rules as a new one, against the store's other subscriptions. Allowed on a
   * closed store: it fixes the record, it adds nothing.
   */
  async update(
    id: string,
    data: UpdateSubscriptionDto,
    adminId: string,
  ): Promise<SubscriptionView> {
    const found = await this.prisma.subscription.findUnique({
      where: { id },
      select: { storeId: true },
    });
    if (!found) {
      throw subscriptionNotFound();
    }
    const subscription = await this.prisma.$transaction(async (tx) => {
      await lockStore(tx, found.storeId);
      // Read again under the store lock: an edit in parallel has committed.
      const current = await tx.subscription.findUniqueOrThrow({
        where: { id },
      });
      const startsOn = data.startsOn ?? dateToDay(current.startsOn);
      const endsOn = data.endsOn ?? dateToDay(current.endsOn);
      if (endsOn < startsOn) {
        throw invalidSubscriptionPeriod();
      }
      await refuseOverlap(tx, current.storeId, startsOn, endsOn, id);
      return tx.subscription.update({
        where: { id },
        data: {
          plan: data.plan,
          startsOn: dayToDate(startsOn),
          endsOn: dayToDate(endsOn),
          updatedById: adminId,
        },
      });
    });
    return toSubscriptionView(subscription);
  }

  /** Newest first; a store has few, so no paging. */
  async listForStore(storeId: string): Promise<SubscriptionView[]> {
    const store = await this.prisma.hardwareStore.findUnique({
      where: { id: storeId },
      select: { subscriptions: { orderBy: [{ startsOn: 'desc' }] } },
    });
    if (!store) {
      throw storeNotFound();
    }
    return store.subscriptions.map((s) => toSubscriptionView(s));
  }
}

/**
 * Locks the store row, so the overlap check and the write of two parallel
 * requests on the same store run one after the other. Returns its status.
 */
async function lockStore(
  tx: Prisma.TransactionClient,
  storeId: string,
): Promise<StoreStatus> {
  const [store] = await tx.$queryRaw<{ status: StoreStatus }[]>`
    SELECT "status" FROM "hardware_stores" WHERE "id" = ${storeId}::uuid FOR UPDATE`;
  if (!store) {
    throw storeNotFound();
  }
  return store.status;
}

/** Two periods overlap when each starts on or before the other's end. */
async function refuseOverlap(
  tx: Prisma.TransactionClient,
  storeId: string,
  startsOn: string,
  endsOn: string,
  exceptId?: string,
): Promise<void> {
  const overlapping = await tx.subscription.findFirst({
    where: {
      storeId,
      startsOn: { lte: dayToDate(endsOn) },
      endsOn: { gte: dayToDate(startsOn) },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (overlapping) {
    throw subscriptionOverlap();
  }
}
