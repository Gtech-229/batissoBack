import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { EnvironmentVariables } from './config/env.validation.js';

export const API_PREFIX = 'api/v1';

/**
 * App-level settings that cannot live in AppModule providers.
 * Shared by main.ts and the e2e tests so both expose the same routes.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  // Admin sessions travel in httpOnly cookies; this fills request.cookies.
  app.use(cookieParser());
  // Only the listed web admin origins may send cookies cross-origin.
  // With no origins configured, browsers get no CORS headers at all.
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });
}
