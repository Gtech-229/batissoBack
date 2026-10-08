import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { SystemSettingsModule } from '../system-settings/system-settings.module.js';
import { MeController } from './me.controller.js';
import { MobileAuthController } from './mobile-auth.controller.js';
import { MobileAuthService } from './mobile-auth.service.js';
import { PinHasher } from './pin-hasher.js';
import { UserAuthGuard } from './user-auth.guard.js';

@Module({
  // AdminAuthModule for TokensService: one token toolkit for both populations.
  imports: [SmsModule, SystemSettingsModule, AdminAuthModule],
  controllers: [MobileAuthController, MeController],
  providers: [
    MobileAuthService,
    PinHasher,
    // Global, next to the admin guard: each one protects its own population.
    { provide: APP_GUARD, useClass: UserAuthGuard },
  ],
})
export class MobileAuthModule {}
