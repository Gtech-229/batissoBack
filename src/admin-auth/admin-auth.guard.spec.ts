import 'reflect-metadata';
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AllowWhilePasswordChangeRequired } from './decorators/allow-while-password-change-required.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { Roles } from './decorators/roles.decorator.js';

const SECRET = 'x'.repeat(32);
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: 900 } });

// Routes declared with real decorators, so the guard reads real metadata.
class PlainController {
  route() {}
}
class DecoratedController {
  @Public()
  open() {}

  @AllowWhilePasswordChangeRequired()
  me() {}

  @Roles(['SUPER_ADMIN'])
  superOnly() {}
}
@Roles(['SUPER_ADMIN'])
class SuperAdminController {
  route() {}
}

interface Session {
  id: string;
  adminId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  admin: { role: string; isActive: boolean; mustChangePassword: boolean };
}

function activeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    adminId: 'admin-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    admin: { role: 'ADMIN', isActive: true, mustChangePassword: false },
    ...overrides,
  };
}

function context(
  controller: new () => object,
  method: string,
  cookies: Record<string, string> = {},
) {
  const request: Record<string, unknown> = { cookies };
  const ctx = {
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function guardWith(session: Session | null) {
  const prisma = {
    adminSession: { findUnique: vi.fn().mockResolvedValue(session) },
  };
  const guard = new AdminAuthGuard(
    new Reflector(),
    jwt,
    prisma as unknown as PrismaService,
  );
  return { guard, prisma };
}

async function accessCookie(sub = 'admin-1', sid = 'session-1') {
  return { batisso_admin_access: await jwt.signAsync({ sub, sid }) };
}

describe('AdminAuthGuard', () => {
  it('lets a @Public() route through without any cookie or database call', async () => {
    const { guard, prisma } = guardWith(null);
    const { ctx } = context(DecoratedController, 'open');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.adminSession.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a protected route without the access cookie', async () => {
    const { guard } = guardWith(activeSession());

    await expect(
      guard.canActivate(context(PlainController, 'route').ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a token signed with another secret', async () => {
    const { guard } = guardWith(activeSession());
    const forged = await new JwtService({ secret: 'y'.repeat(32) }).signAsync({
      sub: 'admin-1',
      sid: 'session-1',
    });

    await expect(
      guard.canActivate(
        context(PlainController, 'route', { batisso_admin_access: forged }).ctx,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an expired token', async () => {
    const { guard } = guardWith(activeSession());
    const expired = await jwt.signAsync(
      { sub: 'admin-1', sid: 'session-1' },
      { expiresIn: -10 },
    );

    await expect(
      guard.canActivate(
        context(PlainController, 'route', { batisso_admin_access: expired })
          .ctx,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['unknown', null],
    ['revoked', activeSession({ revokedAt: new Date() })],
    ['expired', activeSession({ expiresAt: new Date(Date.now() - 1) })],
    ['owned by another admin', activeSession({ adminId: 'admin-2' })],
    [
      'of a deactivated admin',
      activeSession({
        admin: { role: 'ADMIN', isActive: false, mustChangePassword: false },
      }),
    ],
  ])('refuses a session that is %s', async (_label, session) => {
    const { guard } = guardWith(session);

    await expect(
      guard.canActivate(
        context(PlainController, 'route', await accessCookie()).ctx,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a live session and stores the admin on the request', async () => {
    const { guard } = guardWith(activeSession());
    const { ctx, request } = context(
      PlainController,
      'route',
      await accessCookie(),
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.admin).toEqual({
      adminId: 'admin-1',
      sessionId: 'session-1',
      role: 'ADMIN',
    });
  });

  describe('forced password change', () => {
    const mustChange = activeSession({
      admin: { role: 'ADMIN', isActive: true, mustChangePassword: true },
    });

    it('blocks ordinary routes with PASSWORD_CHANGE_REQUIRED', async () => {
      const { guard } = guardWith(mustChange);

      await expect(
        guard.canActivate(
          context(PlainController, 'route', await accessCookie()).ctx,
        ),
      ).rejects.toMatchObject({
        response: { error: 'PASSWORD_CHANGE_REQUIRED' },
      });
    });

    it('allows routes marked @AllowWhilePasswordChangeRequired()', async () => {
      const { guard } = guardWith(mustChange);

      await expect(
        guard.canActivate(
          context(DecoratedController, 'me', await accessCookie()).ctx,
        ),
      ).resolves.toBe(true);
    });

    it('reports the password change before a role refusal', async () => {
      const { guard } = guardWith(mustChange);

      await expect(
        guard.canActivate(
          context(DecoratedController, 'superOnly', await accessCookie()).ctx,
        ),
      ).rejects.toMatchObject({
        response: { error: 'PASSWORD_CHANGE_REQUIRED' },
      });
    });
  });

  describe('roles', () => {
    it('refuses an ADMIN on a method restricted to SUPER_ADMIN', async () => {
      const { guard } = guardWith(activeSession());

      await expect(
        guard.canActivate(
          context(DecoratedController, 'superOnly', await accessCookie()).ctx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('applies @Roles() placed on the controller class', async () => {
      const { guard } = guardWith(activeSession());

      await expect(
        guard.canActivate(
          context(SuperAdminController, 'route', await accessCookie()).ctx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a SUPER_ADMIN through', async () => {
      const { guard } = guardWith(
        activeSession({
          admin: {
            role: 'SUPER_ADMIN',
            isActive: true,
            mustChangePassword: false,
          },
        }),
      );

      await expect(
        guard.canActivate(
          context(DecoratedController, 'superOnly', await accessCookie()).ctx,
        ),
      ).resolves.toBe(true);
    });
  });
});
