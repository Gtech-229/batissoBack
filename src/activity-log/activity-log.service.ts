import { Injectable } from '@nestjs/common';
import {
  paginated,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toActivityEntry, type ActivityEntry } from './dto/activity-entry.js';

/** Reads a store's activity log. Each feature writes its own entries in the transaction of the change. */
@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first; this store only (the id comes from the store guard). */
  async list(
    storeId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<ActivityEntry>> {
    // One transaction so the page and the total come from the same snapshot.
    const [entries, total] = await this.prisma.$transaction([
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
    ]);
    return paginated(entries.map(toActivityEntry), total, query);
  }
}
