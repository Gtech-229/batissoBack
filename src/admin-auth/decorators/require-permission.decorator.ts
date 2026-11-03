import { Reflector } from '@nestjs/core';
import type { Permission } from '../permissions.js';

/**
 * The permission an admin's role must hold for this route or controller (method
 * wins). The super admin holds every one. An admin route with no marker at all
 * is the super admin's only: the guard denies by default.
 */
export const RequirePermission = Reflector.createDecorator<Permission>();

/** Only the super admin: admins and roles. Said explicitly, never by omission. */
export const SuperAdminOnly = Reflector.createDecorator<void, true>({
  // Without transform, `@SuperAdminOnly()` would store `undefined`.
  transform: () => true,
});
