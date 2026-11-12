import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { EnvironmentVariables } from './config/env.validation.js';
import { configureApp } from './configure-app.js';
import { setupDocs } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const port = config.get('PORT', { infer: true });

  configureApp(app);
  setupDocs(app, {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    SWAGGER_USER: config.get('SWAGGER_USER', { infer: true }),
    SWAGGER_PASSWORD: config.get('SWAGGER_PASSWORD', { infer: true }),
  });

  await app.listen(port);
}
await bootstrap();
