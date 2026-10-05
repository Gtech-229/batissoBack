import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DEFAULT_ERROR_MESSAGES,
  FALLBACK_ERROR_MESSAGE,
} from '../errors/error-messages.js';
import type {
  ErrorResponse,
  ValidationErrorDetail,
} from '../errors/error-response.js';

const DOMAIN_ERROR_CODE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

/** Turns every thrown error into the shared French ErrorResponse. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!(exception instanceof HttpException)) {
      // Unexpected failure: keep the details in the server logs only.
      this.logger.error(exception);
    }

    const body: ErrorResponse = {
      statusCode: status,
      error: this.errorCodeFor(exception, status),
      message: this.messageFor(exception, status),
      // originalUrl keeps the /api/v1 prefix; url can lose it on unmatched routes.
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    };

    const details = this.detailsFor(exception);
    if (details) {
      body.details = details;
    }

    response.status(status).json(body);
  }

  /**
   * Our code can pass a domain code: `new UnauthorizedException({ message, error: 'INVALID_CREDENTIALS' })`.
   * Nest's own payloads use Title Case ("Not Found"), so only UPPER_SNAKE_CASE counts as ours.
   */
  private errorCodeFor(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'object') {
        const { error } = payload as { error?: unknown };
        if (typeof error === 'string' && DOMAIN_ERROR_CODE.test(error)) {
          return error;
        }
      }
    }
    return HttpStatus[status] ?? 'ERROR';
  }

  private messageFor(exception: unknown, status: number): string {
    const fallback =
      DEFAULT_ERROR_MESSAGES[status as HttpStatus] ?? FALLBACK_ERROR_MESSAGE;

    if (!(exception instanceof HttpException)) {
      return fallback;
    }

    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return payload;
    }

    const { message, error } = payload as {
      message?: unknown;
      error?: unknown;
    };
    if (typeof message !== 'string') {
      return fallback;
    }

    // Our code throws with French messages (`new NotFoundException('Compte introuvable')`).
    // Messages Nest writes itself are English, so they are replaced by the French default.
    const thrownWithoutMessage = error === undefined && !('details' in payload);
    const routeNotFound =
      status === Number(HttpStatus.NOT_FOUND) && message.startsWith('Cannot ');
    const unreadableRequest =
      status === Number(HttpStatus.BAD_REQUEST) &&
      /in JSON at position|URI malformed|Failed to decode param/.test(message);

    return thrownWithoutMessage || routeNotFound || unreadableRequest
      ? fallback
      : message;
  }

  private detailsFor(exception: unknown): ValidationErrorDetail[] | undefined {
    if (!(exception instanceof HttpException)) {
      return undefined;
    }
    const payload = exception.getResponse();
    if (typeof payload !== 'object') {
      return undefined;
    }
    const { details } = payload as { details?: unknown };
    return Array.isArray(details)
      ? (details as ValidationErrorDetail[])
      : undefined;
  }
}
