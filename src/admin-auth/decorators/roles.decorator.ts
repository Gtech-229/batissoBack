import { Reflector } from '@nestjs/core';
import type { AdminRole } from '../../generated/prisma/client.js';

/** Restricts a route or a whole controller: `@Roles(['SUPER_ADMIN'])`. */
export const Roles = Reflector.createDecorator<AdminRole[]>();
