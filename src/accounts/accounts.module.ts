import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { AdminAccountsController } from './admin-accounts.controller.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { MyAccountsController } from './my-accounts.controller.js';

/**
 * Customers' savings accounts, opened and read by store staff from the mobile
 * app, and searched, suspended and reactivated by admins (16b). StoreAccessGuard (attached by `StoreRoles`) needs only Reflector and the
 * global PrismaService.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    AccountsController,
    MyAccountsController,
    AdminAccountsController,
  ],
  providers: [AccountsService, AdminAccountsService],
  // The identity photo routes answer with the account detail.
  exports: [AccountsService],
})
export class AccountsModule {}
