import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Public } from '../admin-auth/decorators/public.decorator.js';
import { TokensService } from '../admin-auth/tokens.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MobileRoute } from './decorators/mobile-route.decorator.js';
import { notAuthenticated } from './mobile-auth.errors.js';

/**
 * Global guard for the mobile app: every `@MobileRoute()` needs a live mobile
 * session unless it is `@Public()`. Admin routes are the admin guard's job, so
 * both populations are denied by default and never share a route.
 * Registered with APP_GUARD in MobileAuthModule.
 */
@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (
      !this.reflector.getAllAndOverride(MobileRoute, targets) ||
      this.reflector.getAllAndOverride(Public, targets)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    // A native app sends `Authorization: Bearer <token>`; it has no cookies.
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const claims =
      scheme === 'Bearer' && token
        ? await this.tokens.verifyUserAccessToken(token)
        : null;
    if (!claims) {
      throw notAuthenticated();
    }

    // Checked in the database on every request, so logout and revocation take
    // effect immediately, not when the 15-minute token expires.
    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sid },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw notAuthenticated();
    }

    request.mobileUser = { userId: session.userId, sessionId: session.id };
    return true;
  }
}
