import { Reflector } from '@nestjs/core';

/** Lets an admin who must change their password still reach this route. */
export const AllowWhilePasswordChangeRequired = Reflector.createDecorator<
  void,
  true
>({
  // Without transform, `@AllowWhilePasswordChangeRequired()` would store `undefined`.
  transform: () => true,
});
