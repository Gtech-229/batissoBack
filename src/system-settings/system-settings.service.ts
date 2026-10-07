import { Injectable } from '@nestjs/common';
import { definedOnly } from '../common/defined-only.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SystemSettingsValues {
  maxLoginAttempts: number;
  maxAdminSessions: number;
}

/** Used until an admin saves settings for the first time (no seed data). */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValues = {
  maxLoginAttempts: 5,
  maxAdminSessions: 3,
};

/** Allowed range of each setting, enforced by the update DTO. */
export const SYSTEM_SETTINGS_LIMITS = {
  maxLoginAttempts: { min: 3, max: 20 },
  maxAdminSessions: { min: 1, max: 20 },
} as const;

// The settings table holds a single row.
const SETTINGS_ROW_ID = 1;

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SystemSettingsValues> {
    const row = await this.prisma.systemSettings.findUnique({
      where: { id: SETTINGS_ROW_ID },
    });
    if (!row) {
      return { ...DEFAULT_SYSTEM_SETTINGS };
    }
    return {
      maxLoginAttempts: row.maxLoginAttempts,
      maxAdminSessions: row.maxAdminSessions,
    };
  }

  async update(
    values: Partial<SystemSettingsValues>,
    adminId: string,
  ): Promise<SystemSettingsValues> {
    const changes = definedOnly(values);
    const row = await this.prisma.systemSettings.upsert({
      where: { id: SETTINGS_ROW_ID },
      // First save: start from the defaults so unspecified values keep them.
      create: {
        id: SETTINGS_ROW_ID,
        ...DEFAULT_SYSTEM_SETTINGS,
        ...changes,
        updatedById: adminId,
      },
      update: { ...changes, updatedById: adminId },
    });
    return {
      maxLoginAttempts: row.maxLoginAttempts,
      maxAdminSessions: row.maxAdminSessions,
    };
  }
}
