import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module.js';
import { ActivityLogModule } from './activity-log/activity-log.module.js';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { AdminsModule } from './admins/admins.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { validationExceptionFactory } from './common/validation/validation-exception.factory.js';
import { validate } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { IdPhotosModule } from './id-photos/id-photos.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { MobileAuthModule } from './mobile-auth/mobile-auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StaffModule } from './staff/staff.module.js';
import { StoresModule } from './stores/stores.module.js';
import { SystemSettingsModule } from './system-settings/system-settings.module.js';
import { CountriesModule } from './countries/countries.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
    HealthModule,
    SystemSettingsModule,
    AdminAuthModule,
    AdminsModule,
    CountriesModule,
    StoresModule,
    MobileAuthModule,
    StaffModule,
    ActivityLogModule,
    AccountsModule,
    IdPhotosModule,
    LedgerModule,
    NotificationsModule,
  ],
  providers: [
    // Registered as providers (not in main.ts) so e2e tests get them too.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
