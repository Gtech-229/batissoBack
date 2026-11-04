import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { AdminRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_COOKIE } from './admin-auth.constants.js';
import { forbidden, notAuthenticated } from './admin-auth.errors.js';
import { OwnAccountRoute } from './decorators/own-account-route.decorator.js';
import { Public } from './decorators/public.decorator.js';
import {
  RequirePermission,
  SuperAdminOnly,
} from './decorators/require-permission.decorator.js';
import {
  isPermission,
  PERMISSION_NAMES,
  type Permission,
} from './permissions.js';
import type { AccessTokenClaims } from './tokens.service.js';

/**
 * Global guard: every route needs a live admin session unless it is @Public().
 * Registered with APP_GUARD in AdminAuthModule, where JwtService is available.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Method decorators win over class decorators.
    const targets = [context.getHandler(), context.getClass()];

    // Mobile routes are the mobile guard's job: an admin cookie never opens them.
    if (
      this.reflector.getAllAndOverride(Public, targets) ||
      this.reflector.getAllAndOverride(MobileRoute, targets)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const claims = await this.verifyAccessToken(
      request.cookies?.[ACCESS_COOKIE],
    );

    // Checked in the database on every request so logout, deactivation, and
    // session revocation take effect immediately, not when the JWT expires.
    const session = await this.prisma.adminSession.findUnique({
      where: { id: claims.sid },
      include: {
        admin: {
          select: {
            role: true,
            isActive: true,
            // Read here, in the same query: a change counts from the next request.
            accessRole: { select: { permissions: true } },
          },
        },
      },
    });
    if (
      !session ||
      session.adminId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.admin.isActive
    ) {
      throw notAuthenticated();
    }

    const superAdmin = session.admin.role === AdminRole.SUPER_ADMIN;
    const permissions: Permission[] = superAdmin
      ? PERMISSION_NAMES
      : (session.admin.accessRole?.permissions ?? []).filter(isPermission);
    if (!superAdmin && !this.allows(targets, permissions)) {
      throw forbidden();
    }

    request.admin = {
      adminId: session.adminId,
      sessionId: session.id,
      role: session.admin.role,
      permissions,
    };
    return true;
  }

  /**
   * Whether an ADMIN may reach this route: its permission, or their own account
   * (`@OwnAccountRoute()`). Anything else is the super admin's, so a route left
   * unmarked opens to nobody else.
   */
  private allows(
    targets: Parameters<Reflector['getAllAndOverride']>[1],
    permissions: Permission[],
  ): boolean {
    if (this.reflector.getAllAndOverride(SuperAdminOnly, targets)) {
      return false;
    }
    const required = this.reflector.getAllAndOverride(
      RequirePermission,
      targets,
    );
    if (required) {
      return permissions.includes(required);
    }
    return Boolean(this.reflector.getAllAndOverride(OwnAccountRoute, targets));
  }

  private async verifyAccessToken(token: unknown): Promise<AccessTokenClaims> {
    if (typeof token !== 'string' || token.length === 0) {
      throw notAuthenticated();
    }
    try {
      const claims = await this.jwt.verifyAsync<
        Partial<AccessTokenClaims> & { typ?: unknown }
      >(token);
      // A mobile token (`typ: 'user'`) never opens an admin route, even copied
      // into the admin cookie.
      if (
        claims.typ !== undefined ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string'
      ) {
        throw new Error('not an admin access token');
      }
      return { sub: claims.sub, sid: claims.sid };
    } catch {
      // Expired, tampered, or signed with another secret.
      throw notAuthenticated();
    }
  }
}
