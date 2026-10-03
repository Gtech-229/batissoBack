import type { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'api/v1';

/**
 * App-level settings that cannot live in AppModule providers.
 * Shared by main.ts and the e2e tests so both expose the same routes.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}
