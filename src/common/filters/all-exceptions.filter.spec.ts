import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { validationExceptionFactory } from '../validation/validation-exception.factory.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown, url = '/api/v1/test') {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);

  return {
    status: response.status.mock.calls[0][0] as number,
    body: response.json.mock.calls[0][0] as Record<string, unknown>,
  };
}

describe('AllExceptionsFilter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps a message written by our code and builds the full shape', () => {
    const { status, body } = run(
      new NotFoundException('Compte introuvable'),
      '/api/v1/accounts/42',
    );

    expect(status).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Compte introuvable',
      path: '/api/v1/accounts/42',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    expect(body).not.toHaveProperty('details');
  });

  it('keeps a plain string payload', () => {
    const { status, body } = run(new HttpException('Déjà enregistré', 409));

    expect(status).toBe(409);
    expect(body.message).toBe('Déjà enregistré');
    expect(body.error).toBe('CONFLICT');
  });

  it('keeps our message on a 5xx HttpException', () => {
    const { status, body } = run(
      new ServiceUnavailableException('Base de données indisponible'),
    );

    expect(status).toBe(503);
    expect(body.message).toBe('Base de données indisponible');
  });

  it('replaces the English text of an exception thrown without a message', () => {
    expect(run(new ConflictException()).body.message).toBe(
      "Conflit avec l'état actuel de la ressource",
    );
  });

  it("replaces Nest's English unknown-route message", () => {
    const { body } = run(
      new NotFoundException('Cannot GET /api/v1/nope'),
      '/api/v1/nope',
    );

    expect(body.message).toBe('Ressource introuvable');
  });

  it.each([
    ['malformed JSON', "Expected property name or '}' in JSON at position 1"],
    ['malformed URI', 'URI malformed'],
    ['undecodable path param', "Failed to decode param '%FF'"],
  ])('replaces the parser message for %s', (_label, parserMessage) => {
    const { status, body } = run(new BadRequestException(parserMessage));

    expect(status).toBe(400);
    expect(body.message).toBe('Requête invalide');
  });

  it('returns validation details from the validation factory', () => {
    const errors = [
      {
        property: 'phone',
        constraints: { isNotEmpty: 'Le numéro de téléphone est requis' },
        children: [],
      },
    ] as ValidationError[];

    const { status, body } = run(validationExceptionFactory(errors));

    expect(status).toBe(400);
    expect(body.message).toBe('Données invalides');
    expect(body.details).toEqual([
      { field: 'phone', errors: ['Le numéro de téléphone est requis'] },
    ]);
  });

  it('turns an unknown error into a 500 without leaking it, and logs it', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const secret = new Error('connection to postgres://user:secret@db failed');

    const { status, body } = run(secret);

    expect(status).toBe(500);
    expect(body.error).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('Une erreur interne est survenue');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(log).toHaveBeenCalledWith(secret);
  });

  it('handles a thrown non-Error value', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    expect(run('boom').status).toBe(500);
  });

  it('uses a domain error code passed by our code', () => {
    const { status, body } = run(
      new UnauthorizedException({
        message: 'Email ou mot de passe incorrect',
        error: 'INVALID_CREDENTIALS',
      }),
    );

    expect(status).toBe(401);
    expect(body.error).toBe('INVALID_CREDENTIALS');
    expect(body.message).toBe('Email ou mot de passe incorrect');
  });

  it("ignores Nest's own Title Case error field", () => {
    // Nest builds { message, error: 'Not Found', statusCode } for string messages.
    expect(run(new NotFoundException('Compte introuvable')).body.error).toBe(
      'NOT_FOUND',
    );
  });

  it.each(['invalid', 'Invalid_Code', 'SINGLEWORD'])(
    'ignores the non-domain code %s',
    (error) => {
      const { body } = run(new ForbiddenException({ message: 'Non', error }));

      expect(body.error).toBe('FORBIDDEN');
    },
  );
});
