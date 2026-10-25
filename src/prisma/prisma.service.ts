import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * How long a query waits for a free pool connection before failing. pg's
 * default (0) waits forever: a stuck pool then hangs requests (and e2e tests)
 * for minutes. Failing after 10 s gives a visible error on the normal 500 path.
 */
const CONNECTION_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    super({ adapter });
  }

  async onModuleInit() {
    // With a driver adapter, $connect() is lazy; a real query makes startup fail fast if the DB is unreachable.
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
