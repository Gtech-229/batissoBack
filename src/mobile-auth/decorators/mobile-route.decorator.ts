import { Reflector } from '@nestjs/core';

/**
 * Marks a controller (or route) of the mobile app. The admin guard skips it and
 * the mobile guard protects it instead, so each route belongs to exactly one
 * population. Combine with `@Public()` for routes that need no session at all.
 */
export const MobileRoute = Reflector.createDecorator<void, true>({
  // Without transform, `@MobileRoute()` would store `undefined`.
  transform: () => true,
});
