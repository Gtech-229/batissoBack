import { Injectable } from '@nestjs/common';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { alertAlreadyResolved, alertNotFound } from './admin-alerts.errors.js';
import {
  ADMIN_ALERT_INCLUDE,
  toAdminAlertView,
  type AdminAlertsQueryDto,
  type AdminAlertView,
} from './dto/admin-alert.dto.js';

/** Admins read the alerts of the scheduled jobs and mark them resolved (17a). */
@Injectable()
export class AdminAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first; open ones by default. */
  async list(query: AdminAlertsQueryDto): Promise<Paginated<AdminAlertView>> {
    const status = query.status ?? 'open';
    const where: Prisma.AdminAlertWhereInput = {
      type: query.type,
      ...(status === 'open' && { resolvedAt: null }),
      ...(status === 'resolved' && { resolvedAt: { not: null } }),
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [alerts, total] = await this.prisma.$transaction(
      [
        this.prisma.adminAlert.findMany({
          where,
          include: ADMIN_ALERT_INCLUDE,
          // id breaks ties within one millisecond (uuid v7 is time-ordered).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.adminAlert.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(alerts.map(toAdminAlertView), total, query);
  }

  /**
   * Marks an open alert resolved. The update only matches an unresolved row,
   * so two admins resolving at once cannot both succeed: the second gets 409.
   */
  async resolve(id: string, adminId: string): Promise<AdminAlertView> {
    const { count } = await this.prisma.adminAlert.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: adminId },
    });
    const alert = await this.prisma.adminAlert.findUnique({
      where: { id },
      include: ADMIN_ALERT_INCLUDE,
    });
    if (!alert) {
      throw alertNotFound();
    }
    if (count === 0) {
      throw alertAlreadyResolved();
    }
    return toAdminAlertView(alert);
  }
}
