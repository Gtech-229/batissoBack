import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Environment,
  type EnvironmentVariables,
} from '../config/env.validation.js';
import type { PushMessage, PushSender } from './push-sender.js';

/**
 * Fake provider: writes each push to the logs so a developer can see it. Never
 * logs the token (it identifies a phone). In production it only warns that no
 * push was sent, since no real provider exists yet.
 */
@Injectable()
export class ConsolePushSender implements PushSender {
  private readonly logger = new Logger('Push');
  private readonly production: boolean;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.production =
      config.get('NODE_ENV', { infer: true }) === Environment.Production;
  }

  send(_token: string, message: PushMessage): Promise<void> {
    if (this.production) {
      this.logger.warn('No push provider is configured: the push was not sent');
    } else {
      this.logger.log(`${message.title}: ${message.body}`);
    }
    return Promise.resolve();
  }
}
