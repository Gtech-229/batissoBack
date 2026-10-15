import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { MyAccountsController } from './my-accounts.controller.js';

/**
 * Customers' savings accounts, opened and read by store staff from the mobile
 * app. StoreAccessGuard (attached by `StoreRoles`) needs only Reflector and the
 * global PrismaService.
 */
@Module({
  controllers: [AccountsController, MyAccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
