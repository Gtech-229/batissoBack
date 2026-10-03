import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { Environment, EnvironmentVariables } from './config/env.validation.js';
import { configureApp } from './configure-app.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const port = config.get('PORT', { infer: true });

  configureApp(app);

  if (config.get('NODE_ENV', { infer: true }) !== Environment.Production) {
    setupSwagger(app);
  }

  await app.listen(port);
}
await bootstrap();
