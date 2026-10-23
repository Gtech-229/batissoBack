import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../prisma/prisma.service.js';
import { StoreAccessGuard } from './store-access.guard.js';
import { StoreRoles } from './decorators/store-roles.decorator.js';

const STORE_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

// Routes declared with the real decorator, so the guard reads real metadata.
class StaffController {
  @StoreRoles(['MANAGER'])
  managersOnly() {}

  @StoreRoles(['MANAGER', 'SELLER'])
  anyStaff() {}
}
@StoreRoles(['SELLER'])
class SellersController {
  route() {}

  // Method metadata wins over the class.
  @StoreRoles(['MANAGER'])
  override() {}
}

type Membership = {
  role: 'MANAGER' | 'SELLER';
  active: boolean;
  store: { status: string };
} | null;

function membership(overrides: Partial<NonNullable<Membership>> = {}) {
  return {
    role: 'MANAGER' as const,
    active: true,
    store: { status: 'VERIFIED' },
    ...overrides,
  };
}

function context(
  controller: new () => object,
  method: string,
  storeId: string = STORE_ID,
) {
  const request: Record<string, unknown> = {
    params: { storeId },
    mobileUser: {
      userId: 'user-1',
      sessionId: 'session-1',
      deviceId: 'device-0001-abcd',
    },
  };
  const ctx = {
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function guardWith(found: Membership) {
  const prisma = {
    storeMember: { findUnique: vi.fn().mockResolvedValue(found) },
  };
  const guard = new StoreAccessGuard(
    new Reflector(),
    prisma as unknown as PrismaService,
  );
  return { guard, prisma };
}

describe('StoreAccessGuard', () => {
  it('refuses a storeId that is not a UUID with a 400, before any lookup', async () => {
    const { guard, prisma } = guardWith(membership());

    await expect(
      guard.canActivate(
        context(StaffController, 'managersOnly', 'not-a-uuid').ctx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storeMember.findUnique).not.toHaveBeenCalled();
  });

  it('looks the membership up for the signed-in user and the URL store only', async () => {
    const { guard, prisma } = guardWith(membership());

    await guard.canActivate(context(StaffController, 'managersOnly').ctx);

    expect(prisma.storeMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_storeId: { userId: 'user-1', storeId: STORE_ID } },
      }),
    );
  });

  it.each([
    ['not a member (or no such store)', null],
    ['an inactive member', membership({ active: false })],
  ])('answers 404 Quincaillerie introuvable to %s', async (_label, found) => {
    const { guard } = guardWith(found);

    const attempt = guard.canActivate(
      context(StaffController, 'managersOnly').ctx,
    );

    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempt).rejects.toMatchObject({
      response: { message: 'Quincaillerie introuvable' },
    });
  });

  it('answers 403 STORE_ROLE_REQUIRED to an active member without the role', async () => {
    const { guard } = guardWith(membership({ role: 'SELLER' }));

    const attempt = guard.canActivate(
      context(StaffController, 'managersOnly').ctx,
    );

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toMatchObject({
      response: { error: 'STORE_ROLE_REQUIRED' },
    });
  });

  it.each([
    ['MANAGER', 'anyStaff'],
    ['SELLER', 'anyStaff'],
    ['MANAGER', 'managersOnly'],
  ] as const)(
    'lets a %s through %s and puts the store context on the request',
    async (role, method) => {
      const { guard } = guardWith(
        membership({ role, store: { status: 'SUSPENDED' } }),
      );
      const { ctx, request } = context(StaffController, method);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.storeMember).toEqual({
        storeId: STORE_ID,
        role,
        storeStatus: 'SUSPENDED',
      });
    },
  );

  it('gives the store id in lowercase when the URL has capitals (F-02)', async () => {
    const { guard } = guardWith(membership());
    const { ctx, request } = context(
      StaffController,
      'managersOnly',
      STORE_ID.toUpperCase(),
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.storeMember).toMatchObject({ storeId: STORE_ID });
  });

  it('reads class-level roles, and lets method roles override them', async () => {
    const seller = guardWith(membership({ role: 'SELLER' }));
    await expect(
      seller.guard.canActivate(context(SellersController, 'route').ctx),
    ).resolves.toBe(true);

    await expect(
      seller.guard.canActivate(context(SellersController, 'override').ctx),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
