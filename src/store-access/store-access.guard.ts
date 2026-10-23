import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { invalidStoreId, storeNotFound } from '../stores/stores.errors.js';
import { AllowedStoreRoles } from './decorators/allowed-store-roles.decorator.js';
import { storeRoleRequired } from './store-access.errors.js';

/**
 * Per-store access for routes under `/stores/:storeId`. Runs after the global
 * mobile guard, so `request.mobileUser` is set. A store the caller is not an
 * active member of answers 404, as if it did not exist: other stores cannot be
 * probed. A member without an allowed role gets 403.
 */
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // Express 5 types a param as `string | string[]` (wildcards capture
    // arrays): `typeof` narrows it to a string for TypeScript.
    const storeId = request.params.storeId;
    if (typeof storeId !== 'string' || !isUUID(storeId)) {
      throw invalidStoreId();
    }

    // Scoped by the session's user and the URL's store: nothing else decides.
    const membership = await this.prisma.storeMember.findUnique({
      where: {
        userId_storeId: { userId: request.mobileUser!.userId, storeId },
      },
      select: { role: true, active: true, store: { select: { status: true } } },
    });
    if (!membership?.active) {
      throw storeNotFound();
    }

    // Method roles win over class roles, as for the admin @Roles.
    const allowed = this.reflector.getAllAndOverride(AllowedStoreRoles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.includes(membership.role)) {
      throw storeRoleRequired();
    }

    request.storeMember = {
      // Lowercase, as PostgreSQL returns ids: the URL may carry capitals, and
      // code comparing ids (idempotent replays) must see one spelling (F-02).
      storeId: storeId.toLowerCase(),
      role: membership.role,
      storeStatus: membership.store.status,
    };
    return true;
  }
}
