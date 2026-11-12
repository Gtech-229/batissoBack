import { createHash, timingSafeEqual } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { ACCESS_COOKIE } from './admin-auth/admin-auth.constants.js';
import { ErrorResponse } from './common/errors/error-response.js';
import {
  Environment,
  type EnvironmentVariables,
} from './config/env.validation.js';

export const SWAGGER_PATH = 'docs';

export type DocsSettings = Pick<
  EnvironmentVariables,
  'NODE_ENV' | 'SWAGGER_USER' | 'SWAGGER_PASSWORD'
>;

/**
 * Serves the API docs (/docs, /docs-json, /docs-yaml): open in development
 * and test; in production only when SWAGGER_USER and SWAGGER_PASSWORD are set
 * (validated together at startup), behind HTTP Basic auth; otherwise not at
 * all. Call before app.init() / listen().
 */
export function setupDocs(app: INestApplication, settings: DocsSettings): void {
  if (settings.NODE_ENV !== Environment.Production) {
    setupSwagger(app);
    return;
  }
  if (settings.SWAGGER_USER && settings.SWAGGER_PASSWORD) {
    // Registered before Swagger's own routes, so it runs first.
    app.use(docsBasicAuth(settings.SWAGGER_USER, settings.SWAGGER_PASSWORD));
    setupSwagger(app);
  }
}

// Every docs path: /docs, /docs/ and its assets (swagger-ui-init.js embeds the
// whole document), /docs-json, /docs-yaml. Case-insensitive like Express's
// routing, so /DOCS-JSON cannot slip past.
const DOCS_PATHS = new RegExp(`^/${SWAGGER_PATH}(?:[/-]|$)`, 'i');

const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

function docsBasicAuth(user: string, password: string) {
  const expectedUser = sha256(user);
  const expectedPassword = sha256(password);

  return (request: Request, response: Response, next: NextFunction): void => {
    if (!DOCS_PATHS.test(request.path)) {
      next();
      return;
    }
    const given = parseBasic(request.headers.authorization);
    // Fixed-length digests, so timingSafeEqual always applies; both are
    // compared every time, so the time does not tell which one failed.
    const userOk = timingSafeEqual(sha256(given?.user ?? ''), expectedUser);
    const passwordOk = timingSafeEqual(
      sha256(given?.password ?? ''),
      expectedPassword,
    );
    if (given && userOk && passwordOk) {
      next();
      return;
    }
    response
      .status(401)
      .set(
        'WWW-Authenticate',
        'Basic realm="Batisso API docs", charset="UTF-8"',
      )
      .type('text/plain')
      .send('Authentification requise.');
  };
}

/** `Basic base64(user:password)`; the user name holds no `:`. */
function parseBasic(
  header: string | undefined,
): { user: string; password: string } | undefined {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? '');
  if (!match) {
    return undefined;
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) {
    return undefined;
  }
  return {
    user: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}

function setupSwagger(app: INestApplication): void {
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
    // Admin routes read the httpOnly access cookie set by POST /admin/auth/login.
    .addCookieAuth(ACCESS_COOKIE)
    // Mobile routes read `Authorization: Bearer <accessToken>` from POST /auth/pin or /auth/login.
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponse],
  });

  // Served outside the /api/v1 prefix: http://localhost:3000/docs
  SwaggerModule.setup(SWAGGER_PATH, app, document);
}
