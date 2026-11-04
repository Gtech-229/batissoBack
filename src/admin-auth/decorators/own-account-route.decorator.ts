import { Reflector } from '@nestjs/core';

/**
 * A route on the signed-in admin's own account (profile, password): open to
 * every admin, whatever their role's permissions.
 */
export const OwnAccountRoute = Reflector.createDecorator<void, true>({
  // Without transform, `@OwnAccountRoute()` would store `undefined`.
  transform: () => true,
});
