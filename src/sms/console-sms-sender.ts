import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Environment,
  type EnvironmentVariables,
} from '../config/env.validation.js';
import type { SmsSender } from './sms-sender.js';

/**
 * Fake provider: writes each SMS to the logs so a developer can read the code.
 * In production it never logs the text (it may hold a one-time code); it only
 * warns that no SMS was sent, since no real provider exists yet.
 */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');
  private readonly production: boolean;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.production =
      config.get('NODE_ENV', { infer: true }) === Environment.Production;
  }

  send(phone: string, text: string): Promise<void> {
    if (this.production) {
      this.logger.warn('No SMS provider is configured: the SMS was not sent');
    } else {
      this.logger.log(`To ${phone}: ${text}`);
    }
    return Promise.resolve();
  }
}
