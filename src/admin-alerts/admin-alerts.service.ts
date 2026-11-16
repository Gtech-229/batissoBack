import { Injectable } from '@nestjs/common';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination.js';
import {
  AdminAlertType,
  AdminRole,
  type Prisma,
} from '../generated/prisma/client.js';
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

  /**
   * Newest first; open ones by default. A WhatsApp settings alert is the super
   * admin's only (25b): an ADMIN never sees it, whatever their permissions.
   */
  async list(
    query: AdminAlertsQueryDto,
    role: AdminRole,
  ): Promise<Paginated<AdminAlertView>> {
    const status = query.status ?? 'open';
    const where: Prisma.AdminAlertWhereInput = {
      AND: [{ type: query.type }, visibleTo(role)],
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
  async resolve(
    id: string,
    adminId: string,
    role: AdminRole,
  ): Promise<AdminAlertView> {
    // An alert the admin cannot see is unknown to them (404), never resolved.
    const { count } = await this.prisma.adminAlert.updateMany({
      where: { AND: [{ id, resolvedAt: null }, visibleTo(role)] },
      data: { resolvedAt: new Date(), resolvedById: adminId },
    });
    const alert = await this.prisma.adminAlert.findFirst({
      where: { AND: [{ id }, visibleTo(role)] },
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

/** The alerts an admin may see and resolve: all for the super admin. */
function visibleTo(role: AdminRole): Prisma.AdminAlertWhereInput {
  return role === AdminRole.SUPER_ADMIN
    ? {}
    : { type: { not: AdminAlertType.WHATSAPP_SETTINGS_CHANGED } };
}
