import { Module } from '@nestjs/common';
import { AdminRolesController } from './admin-roles.controller.js';
import { AdminRolesService } from './admin-roles.service.js';

/** The roles and permissions of admins (feature 20). */
@Module({
  controllers: [AdminRolesController],
  providers: [AdminRolesService],
})
export class AdminRolesModule {}
