import { Reflector } from '@nestjs/core';

/** Skips the admin guard: the route answers without a session. */
export const Public = Reflector.createDecorator<void, true>({
  // Without transform, `@Public()` would store `undefined`.
  transform: () => true,
});
