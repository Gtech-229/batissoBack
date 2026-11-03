import 'reflect-metadata';
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AllowWhilePasswordChangeRequired } from './decorators/allow-while-password-change-required.decorator.js';
import { Public } from './decorators/public.decorator.js';
import {
  RequirePermission,
  SuperAdminOnly,
} from './decorators/require-permission.decorator.js';
import { PERMISSION_NAMES } from './permissions.js';

const SECRET = 'x'.repeat(32);
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: 900 } });

// Routes declared with real decorators, so the guard reads real metadata.
class PlainController {
  @RequirePermission('stores.read')
  route() {}

  // No marker: the super admin's only, by default.
  unmarked() {}
}
class DecoratedController {
  @Public()
  open() {}

  @AllowWhilePasswordChangeRequired()
  me() {}

  @SuperAdminOnly()
  superOnly() {}
}
@SuperAdminOnly()
class SuperAdminController {
  route() {}
}
@RequirePermission('countries.read')
class CountriesController {
  route() {}

  @RequirePermission('countries.manage')
  manage() {}
}
@MobileRoute()
class MobileController {
  route() {}
}

interface Session {
  id: string;
  adminId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  admin: {
    role: string;
    isActive: boolean;
    mustChangePassword: boolean;
    accessRole?: { permissions: string[] } | null;
  };
}

function activeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    adminId: 'admin-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    admin: {
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
      accessRole: { permissions: ['stores.read', 'countries.read'] },
    },
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

  it('leaves a @MobileRoute() to the mobile guard, without reading any cookie', async () => {
    const { guard, prisma } = guardWith(null);

    await expect(
      guard.canActivate(context(MobileController, 'route').ctx),
    ).resolves.toBe(true);
    expect(prisma.adminSession.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a protected route without the access cookie', async () => {
    const { guard } = guardWith(activeSession());

    await expect(
      guard.canActivate(context(PlainController, 'route').ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a mobile token copied into the admin cookie, without any lookup', async () => {
    const { guard, prisma } = guardWith(activeSession());
    const mobileToken = await jwt.signAsync({
      sub: 'admin-1',
      sid: 'session-1',
      typ: 'user',
    });

    await expect(
      guard.canActivate(
        context(PlainController, 'route', { batisso_admin_access: mobileToken })
          .ctx,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.adminSession.findUnique).not.toHaveBeenCalled();
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
      permissions: ['stores.read', 'countries.read'],
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

  describe('permissions', () => {
    const admin = (permissions: string[] | null) =>
      activeSession({
        admin: {
          role: 'ADMIN',
          isActive: true,
          mustChangePassword: false,
          accessRole: permissions === null ? null : { permissions },
        },
      });
    const superAdmin = activeSession({
      admin: {
        role: 'SUPER_ADMIN',
        isActive: true,
        mustChangePassword: false,
        accessRole: null,
      },
    });
    const allowed = async (
      session: Session,
      controller: new () => object,
      method: string,
    ) =>
      guardWith(session).guard.canActivate(
        context(controller, method, await accessCookie()).ctx,
      );

    it('lets an ADMIN through with the route’s permission', async () => {
      await expect(
        allowed(admin(['stores.read']), PlainController, 'route'),
      ).resolves.toBe(true);
    });

    it('refuses an ADMIN without it', async () => {
      await expect(
        allowed(admin(['countries.read']), PlainController, 'route'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an ADMIN without any role', async () => {
      await expect(
        allowed(admin(null), PlainController, 'route'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ignores a stored name that is not a permission', async () => {
      await expect(
        allowed(admin(['stores.*']), PlainController, 'route'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reads a permission set on the class, and lets the method override it', async () => {
      await expect(
        allowed(admin(['countries.read']), CountriesController, 'route'),
      ).resolves.toBe(true);
      await expect(
        allowed(admin(['countries.read']), CountriesController, 'manage'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an ADMIN on an unmarked route: deny by default', async () => {
      await expect(
        allowed(admin([...PERMISSION_NAMES]), PlainController, 'unmarked'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an ADMIN on a super admin route, every permission or not', async () => {
      await expect(
        allowed(admin([...PERMISSION_NAMES]), DecoratedController, 'superOnly'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        allowed(admin([...PERMISSION_NAMES]), SuperAdminController, 'route'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an ADMIN with no role reach their own account', async () => {
      await expect(
        allowed(admin(null), DecoratedController, 'me'),
      ).resolves.toBe(true);
    });

    it('lets the super admin through everywhere, with every permission', async () => {
      for (const [controller, method] of [
        [PlainController, 'route'],
        [PlainController, 'unmarked'],
        [DecoratedController, 'superOnly'],
        [SuperAdminController, 'route'],
        [CountriesController, 'manage'],
      ] as const) {
        await expect(allowed(superAdmin, controller, method)).resolves.toBe(
          true,
        );
      }
      const { ctx, request } = context(
        PlainController,
        'route',
        await accessCookie(),
      );
      await guardWith(superAdmin).guard.canActivate(ctx);
      expect((request.admin as { permissions: string[] }).permissions).toEqual(
        PERMISSION_NAMES,
      );
    });
  });
});
