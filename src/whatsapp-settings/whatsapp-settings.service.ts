import { Injectable } from '@nestjs/common';
import { AdminAuthService } from '../admin-auth/admin-auth.service.js';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../common/pagination.js';
import { AdminAlertType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  UpdateWhatsappSettingsDto,
  WhatsappSettingsChangeView,
  WhatsappSettingsResponse,
} from './dto/whatsapp-settings.dto.js';
import { TokenCipher } from './token-cipher.js';
import {
  encryptionKeyMissing,
  whatsappNotConfigured,
} from './whatsapp-settings.errors.js';

// The settings table holds a single row.
const SETTINGS_ROW_ID = 1;

const ADMIN_FIELDS = { id: true, firstName: true, lastName: true } as const;

type SettingsRow = {
  enabled: boolean;
  instanceId: string | null;
  tokenCiphertext: string | null;
  tokenLast4: string | null;
  updatedAt: Date;
  updatedBy: { id: string; firstName: string; lastName: string } | null;
};

/** What the code uses until a first save: WhatsApp off, nothing configured. */
const NO_SETTINGS = {
  enabled: false,
  instanceId: null,
  tokenCiphertext: null,
  tokenLast4: null,
} as const;

/**
 * The Green API credentials of the WhatsApp delivery (25b). Only the super
 * admin reaches it (controller); every change re-confirms their password, is
 * recorded, and opens an admin alert. The token is stored encrypted and never
 * returned.
 */
@Injectable()
export class WhatsappSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipher,
    private readonly adminAuth: AdminAuthService,
  ) {}

  async get(): Promise<WhatsappSettingsResponse> {
    const row = await this.prisma.whatsappSettings.findUnique({
      where: { id: SETTINGS_ROW_ID },
      include: { updatedBy: { select: ADMIN_FIELDS } },
    });
    return this.toView(row);
  }

  async update(
    dto: UpdateWhatsappSettingsDto,
    adminId: string,
  ): Promise<WhatsappSettingsResponse> {
    // First: a wrong password counts in the login lockout (F-05).
    await this.adminAuth.confirmPassword(adminId, dto.currentPassword);
    if (dto.token !== undefined && !this.cipher.available) {
      throw encryptionKeyMissing();
    }

    await this.prisma.$transaction(async (tx) => {
      // One change at a time: each one is compared with the saved state.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('whatsapp-settings'))`;
      const current =
        (await tx.whatsappSettings.findUnique({
          where: { id: SETTINGS_ROW_ID },
        })) ?? NO_SETTINGS;
      const currentToken = current.tokenCiphertext
        ? this.cipher.decrypt(current.tokenCiphertext)
        : null;

      const enabled = dto.enabled ?? current.enabled;
      const instanceId = dto.instanceId ?? current.instanceId;
      const tokenChanged =
        dto.token !== undefined && dto.token !== currentToken;
      const tokenReadable = tokenChanged || currentToken !== null;
      if (enabled && (!instanceId || !tokenReadable)) {
        throw whatsappNotConfigured();
      }
      // Saving the same values records nothing and alerts no one.
      if (
        enabled === current.enabled &&
        instanceId === current.instanceId &&
        !tokenChanged
      ) {
        return;
      }

      const token = tokenChanged
        ? {
            tokenCiphertext: this.cipher.encrypt(dto.token!),
            tokenLast4: dto.token!.slice(-4),
          }
        : {};
      await tx.whatsappSettings.upsert({
        where: { id: SETTINGS_ROW_ID },
        create: {
          id: SETTINGS_ROW_ID,
          enabled,
          instanceId,
          ...token,
          updatedById: adminId,
        },
        update: { enabled, instanceId, ...token, updatedById: adminId },
      });
      const change = await tx.whatsappSettingsChange.create({
        data: {
          adminId,
          enabledBefore: current.enabled,
          enabledAfter: enabled,
          instanceIdBefore: current.instanceId,
          instanceIdAfter: instanceId,
          tokenChanged,
          tokenLast4: tokenChanged ? dto.token!.slice(-4) : current.tokenLast4,
        },
      });
      // One alert per change, for every super admin to see (user decision).
      await tx.adminAlert.create({
        data: {
          type: AdminAlertType.WHATSAPP_SETTINGS_CHANGED,
          whatsappSettingsChangeId: change.id,
        },
      });
    });
    return this.get();
  }

  /** Every saved change, newest first: who, when, what (never the token). */
  async changes(
    query: PaginationQueryDto,
  ): Promise<Paginated<WhatsappSettingsChangeView>> {
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.whatsappSettingsChange.findMany({
          include: { admin: { select: ADMIN_FIELDS } },
          // id breaks ties within one millisecond (uuid v7 is time-ordered).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.whatsappSettingsChange.count(),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(
      rows.map((row) => ({
        id: row.id,
        changedAt: row.createdAt.toISOString(),
        changedBy: row.admin,
        enabledBefore: row.enabledBefore,
        enabledAfter: row.enabledAfter,
        instanceIdBefore: row.instanceIdBefore,
        instanceIdAfter: row.instanceIdAfter,
        tokenChanged: row.tokenChanged,
        tokenLast4: row.tokenLast4,
      })),
      total,
      query,
    );
  }

  private toView(row: SettingsRow | null): WhatsappSettingsResponse {
    const settings = row ?? {
      ...NO_SETTINGS,
      updatedAt: null,
      updatedBy: null,
    };
    return {
      enabled: settings.enabled,
      instanceId: settings.instanceId,
      tokenConfigured: settings.tokenCiphertext !== null,
      tokenLast4: settings.tokenLast4,
      tokenReadable:
        settings.tokenCiphertext !== null &&
        this.cipher.decrypt(settings.tokenCiphertext) !== null,
      encryptionAvailable: this.cipher.available,
      updatedAt: settings.updatedAt?.toISOString() ?? null,
      updatedBy: settings.updatedBy,
    };
  }
}
