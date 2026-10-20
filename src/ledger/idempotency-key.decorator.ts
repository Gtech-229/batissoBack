import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { invalidIdempotencyKey } from './ledger.errors.js';

/**
 * The `Idempotency-Key` header of a money-moving request: a UUID the app
 * generates once per request and sends again unchanged when it retries. Missing
 * or not a UUID: a French 400 before anything is written.
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, context: ExecutionContext): string => {
    const value = context
      .switchToHttp()
      .getRequest<Request>()
      .header('idempotency-key');
    if (typeof value !== 'string' || !isUUID(value)) {
      throw invalidIdempotencyKey();
    }
    // Lowercase: the same key in another case is the same key.
    return value.toLowerCase();
  },
);
