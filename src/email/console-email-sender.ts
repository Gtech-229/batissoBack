import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Environment,
  type EnvironmentVariables,
} from '../config/env.validation.js';
import type { EmailMessage, EmailSender } from './email-sender.js';

/**
 * Fake provider: writes each email to the logs so a developer can follow the
 * link. In production it never logs the address or the body (the body holds a
 * password link); it only warns that no email was sent, since no real provider
 * exists yet.
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');
  private readonly production: boolean;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.production =
      config.get('NODE_ENV', { infer: true }) === Environment.Production;
  }

  send(message: EmailMessage): Promise<void> {
    if (this.production) {
      this.logger.warn(
        'No email provider is configured: the email was not sent',
      );
    } else {
      this.logger.log(`To ${message.to}: ${message.subject}\n${message.text}`);
    }
    return Promise.resolve();
  }
}
