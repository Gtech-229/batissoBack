import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponse } from './common/errors/error-response.js';

export const SWAGGER_PATH = 'docs';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('API Bâtisso')
    .setDescription(
      [
        'API de la plateforme Bâtisso : épargne-construction pour les quincailleries.',
        '',
        'Toutes les routes sont préfixées par `/api/v1`.',
        'Toute réponse en erreur suit le schéma `ErrorResponse` : le champ `message` est en français et peut être affiché à l’utilisateur, le champ `error` est un code stable destiné aux applications.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponse],
  });

  // Served outside the /api/v1 prefix: http://localhost:3000/docs
  SwaggerModule.setup(SWAGGER_PATH, app, document);
}
