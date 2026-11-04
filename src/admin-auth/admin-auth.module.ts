import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { SystemSettingsModule } from '../system-settings/system-settings.module.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './admin-auth.constants.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { PasswordLinksService } from './password-links.service.js';
import { EmailModule } from '../email/email.module.js';
import { SuperAdminBootstrapService } from './super-admin-bootstrap.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  imports: [
    SystemSettingsModule,
    EmailModule,
    // registerAsync: the secret comes from the validated env, not a literal.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    SuperAdminBootstrapService,
    AdminAuthService,
    PasswordLinksService,
    TokensService,
    // Global: protects every route of the app, not only this module's.
    { provide: APP_GUARD, useClass: AdminAuthGuard },
  ],
  exports: [TokensService],
})
export class AdminAuthModule {}
