import { applyDecorators, UseGuards } from '@nestjs/common';
import type { StoreMemberRole } from '../../generated/prisma/client.js';
import { StoreAccessGuard } from '../store-access.guard.js';
import { AllowedStoreRoles } from './allowed-store-roles.decorator.js';

/**
 * The only way to open a route under `/stores/:storeId`: records the allowed
 * roles AND attaches the guard, so a route cannot declare roles and forget the
 * check. `@StoreRoles(['MANAGER'])` on a method or a controller.
 */
export function StoreRoles(roles: StoreMemberRole[]) {
  return applyDecorators(AllowedStoreRoles(roles), UseGuards(StoreAccessGuard));
}
