import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_COOKIE } from './admin-auth.constants.js';
import {
  forbidden,
  notAuthenticated,
  passwordChangeRequired,
} from './admin-auth.errors.js';
import { AllowWhilePasswordChangeRequired } from './decorators/allow-while-password-change-required.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { Roles } from './decorators/roles.decorator.js';
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

    if (this.reflector.getAllAndOverride(Public, targets)) {
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
          select: { role: true, isActive: true, mustChangePassword: true },
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

    // Before the role check, so a new admin sees why they are blocked.
    if (
      session.admin.mustChangePassword &&
      !this.reflector.getAllAndOverride(
        AllowWhilePasswordChangeRequired,
        targets,
      )
    ) {
      throw passwordChangeRequired();
    }

    const roles = this.reflector.getAllAndOverride(Roles, targets);
    if (roles && !roles.includes(session.admin.role)) {
      throw forbidden();
    }

    request.admin = {
      adminId: session.adminId,
      sessionId: session.id,
      role: session.admin.role,
    };
    return true;
  }

  private async verifyAccessToken(token: unknown): Promise<AccessTokenClaims> {
    if (typeof token !== 'string' || token.length === 0) {
      throw notAuthenticated();
    }
    try {
      const claims =
        await this.jwt.verifyAsync<Partial<AccessTokenClaims>>(token);
      if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
        throw new Error('missing claims');
      }
      return { sub: claims.sub, sid: claims.sid };
    } catch {
      // Expired, tampered, or signed with another secret.
      throw notAuthenticated();
    }
  }
}
