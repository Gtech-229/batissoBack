import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { AdminRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from './secrets.js';

/**
 * Creates the super admin on startup when none exists, so the web admin is
 * usable without seed data. Never overwrites an existing super admin.
 */
@Injectable()
export class SuperAdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.prisma.admin.findFirst({
      where: { role: AdminRole.SUPER_ADMIN },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const email = this.config.get('SUPER_ADMIN_EMAIL', { infer: true });
    const password = this.config.get('SUPER_ADMIN_PASSWORD', { infer: true });
    if (!email || !password) {
      throw new Error(
        'No SUPER_ADMIN exists: set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD to create one at startup.',
      );
    }

    const emailOwner = await this.prisma.admin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (emailOwner) {
      throw new Error(
        `SUPER_ADMIN_EMAIL ${email} already belongs to an ADMIN account; choose another email.`,
      );
    }

    await this.prisma.admin.create({
      data: {
        email,
        firstName: 'Super',
        lastName: 'Administrateur',
        passwordHash: await hashPassword(password),
        role: AdminRole.SUPER_ADMIN,
        // The operator chose this password in the env; no forced change.
        mustChangePassword: false,
      },
    });
    this.logger.log(`Super admin created: ${email}`);
  }
}
