import 'reflect-metadata';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../admin-auth/decorators/public.decorator.js';
import { TokensService } from '../admin-auth/tokens.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MobileRoute } from './decorators/mobile-route.decorator.js';
import { UserAuthGuard } from './user-auth.guard.js';

const SECRET = 'x'.repeat(32);
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: 900 } });
const tokens = new TokensService(jwt);

// Routes declared with real decorators, so the guard reads real metadata.
class AdminController {
  route() {}
}
@MobileRoute()
class MobileController {
  route() {}

  @Public()
  open() {}
}

interface Session {
  id: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  device: { deviceId: string };
}

function liveSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'user-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    device: { deviceId: 'device-0001-abcd' },
    ...overrides,
  };
}

function context(
  controller: new () => object,
  method: string,
  authorization?: string,
) {
  const request: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };
  const ctx = {
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function guardWith(session: Session | null) {
  const prisma = {
    userSession: { findUnique: vi.fn().mockResolvedValue(session) },
  };
  const guard = new UserAuthGuard(
    new Reflector(),
    tokens,
    prisma as unknown as PrismaService,
  );
  return { guard, prisma };
}

const bearer = async (sub = 'user-1', sid = 'session-1') =>
  `Bearer ${await tokens.signUserAccessToken({ sub, sid })}`;

describe('UserAuthGuard', () => {
  it('leaves admin routes to the admin guard', async () => {
    const { guard, prisma } = guardWith(null);

    await expect(
      guard.canActivate(context(AdminController, 'route').ctx),
    ).resolves.toBe(true);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('lets a @Public() mobile route through without a token', async () => {
    const { guard, prisma } = guardWith(null);

    await expect(
      guard.canActivate(context(MobileController, 'open').ctx),
    ).resolves.toBe(true);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['no header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty Bearer', 'Bearer '],
    ['a malformed token', 'Bearer not.a.jwt'],
  ])('refuses %s', async (_label, authorization) => {
    const { guard, prisma } = guardWith(liveSession());

    await expect(
      guard.canActivate(context(MobileController, 'route', authorization).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('refuses an admin token (no typ), even with a valid signature', async () => {
    const { guard } = guardWith(liveSession());
    const adminToken = await tokens.signAccessToken({
      sub: 'user-1',
      sid: 'session-1',
    });

    await expect(
      guard.canActivate(
        context(MobileController, 'route', `Bearer ${adminToken}`).ctx,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a token signed with another secret, or expired', async () => {
    const { guard } = guardWith(liveSession());
    const forged = await new JwtService({ secret: 'y'.repeat(32) }).signAsync({
      sub: 'user-1',
      sid: 'session-1',
      typ: 'user',
    });
    const expired = await jwt.signAsync(
      { sub: 'user-1', sid: 'session-1', typ: 'user' },
      { expiresIn: -10 },
    );

    for (const token of [forged, expired]) {
      await expect(
        guard.canActivate(
          context(MobileController, 'route', `Bearer ${token}`).ctx,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it.each([
    ['unknown', null],
    ['revoked', liveSession({ revokedAt: new Date() })],
    ['expired', liveSession({ expiresAt: new Date(Date.now() - 1) })],
    ['owned by another user', liveSession({ userId: 'user-2' })],
  ])('refuses a session that is %s', async (_label, session) => {
    const { guard } = guardWith(session);

    await expect(
      guard.canActivate(context(MobileController, 'route', await bearer()).ctx),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a live session and stores the user on the request', async () => {
    const { guard } = guardWith(liveSession());
    const { ctx, request } = context(MobileController, 'route', await bearer());

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.mobileUser).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      deviceId: 'device-0001-abcd',
    });
  });
});
