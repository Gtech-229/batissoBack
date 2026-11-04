import { BadRequestException, Injectable } from '@nestjs/common';
import {
  paginated,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
  ONE_SNAPSHOT,
} from '../common/pagination.js';
import { parseDay } from '../common/validation/day.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toActivityEntry, type ActivityEntry } from './dto/activity-entry.js';
import {
  toAdminActivityEntry,
  type AdminActivityEntry,
  type AdminActivityQueryDto,
} from './dto/admin-activity.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function invalidPeriod(): BadRequestException {
  return new BadRequestException({
    message: 'Le dernier jour doit être le même que le premier ou après',
    error: 'INVALID_PERIOD',
  });
}

/** Reads a store's activity log. Each feature writes its own entries in the transaction of the change. */
@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every store's log, for admins (16c), newest first. The period's days are
   * UTC, both included; entries without a store are listed too.
   */
  async listAll(
    query: AdminActivityQueryDto,
  ): Promise<Paginated<AdminActivityEntry>> {
    // The DTO checked both days; only their order is left.
    const start = query.from ? parseDay(query.from) : null;
    const last = query.to ? parseDay(query.to) : null;
    if (start && last && last < start) {
      throw invalidPeriod();
    }
    const where: Prisma.ActivityLogWhereInput = {
      storeId: query.storeId,
      action: query.action,
      ...((start || last) && {
        createdAt: {
          ...(start && { gte: start }),
          ...(last && { lt: new Date(last.getTime() + DAY_MS) }),
        },
      }),
    };
    const [entries, total] = await this.prisma.$transaction(
      [
        this.prisma.activityLog.findMany({
          where,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            store: { select: { id: true, name: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.activityLog.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(entries.map(toAdminActivityEntry), total, query);
  }

  /** Newest first; this store only (the id comes from the store guard). */
  async list(
    storeId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<ActivityEntry>> {
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [entries, total] = await this.prisma.$transaction(
      [
        this.prisma.activityLog.findMany({
          where: { storeId },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          // id breaks ties within one millisecond (uuid v7 is time-ordered).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.activityLog.count({ where: { storeId } }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(entries.map(toActivityEntry), total, query);
  }
}
