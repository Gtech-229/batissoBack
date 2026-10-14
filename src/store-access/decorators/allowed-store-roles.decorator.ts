import { Reflector } from '@nestjs/core';
import { StoreMemberRole } from '../../generated/prisma/enums.js';

export const AllowedStoreRoles = Reflector.createDecorator<StoreMemberRole[]>();
