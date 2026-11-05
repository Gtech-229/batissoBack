import { Injectable } from '@nestjs/common';
import { definedOnly } from '../common/defined-only.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SystemSettingsValues {
  maxLoginAttempts: number;
  maxAdminSessions: number;
  /** Wrong PINs before a mobile user is locked; 0 = no limit. */
  maxPinAttempts: number;
  /** Days a confirmed order may stay undelivered before the managers' alert (17b). */
  deliveryAlertDays: number;
  /** Hours a cancellation request may stay unanswered before an admin alert (17b). */
  cancellationEscalationHours: number;
}

/** Used until an admin saves settings for the first time (no seed data). */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValues = {
  maxLoginAttempts: 5,
  maxAdminSessions: 3,
  maxPinAttempts: 5,
  deliveryAlertDays: 7,
  cancellationEscalationHours: 48,
};

/** Allowed range of each setting, enforced by the update DTO. */
export const SYSTEM_SETTINGS_LIMITS = {
  maxLoginAttempts: { min: 3, max: 20 },
  maxAdminSessions: { min: 1, max: 20 },
  // 0 is also allowed for maxPinAttempts: it disables the PIN lock.
  maxPinAttempts: { min: 3, max: 10 },
  // Also CHECK constraints in the database (17b).
  deliveryAlertDays: { min: 1, max: 365 },
  cancellationEscalationHours: { min: 1, max: 720 },
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
    return toValues(row);
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
    return toValues(row);
  }
}

/** Only the setting values: the row also holds its id and who saved it. */
function toValues(row: SystemSettingsValues): SystemSettingsValues {
  return {
    maxLoginAttempts: row.maxLoginAttempts,
    maxAdminSessions: row.maxAdminSessions,
    maxPinAttempts: row.maxPinAttempts,
    deliveryAlertDays: row.deliveryAlertDays,
    cancellationEscalationHours: row.cancellationEscalationHours,
  };
}
