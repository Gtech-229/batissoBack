import { Inject, Injectable } from '@nestjs/common';
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
import { isPhoneCountry, normalizePhone } from '../common/phone.js';
import { invalidPhone } from '../mobile-auth/mobile-auth.errors.js';
import {
  GREEN_API_SEND,
  WhatsappSendError,
  type GreenApiCredentials,
  type GreenApiSend,
} from '../sms/green-api-client.js';
import {
  WHATSAPP_TEST_MESSAGE,
  type UpdateWhatsappSettingsDto,
  type WhatsappSettingsChangeView,
  type WhatsappSettingsResponse,
} from './dto/whatsapp-settings.dto.js';
import { TokenCipher } from './token-cipher.js';
import {
  encryptionKeyMissing,
  whatsappNotConfigured,
  whatsappSendFailed,
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
    @Inject(GREEN_API_SEND) private readonly sendWhatsapp: GreenApiSend,
  ) {}

  /**
   * The credentials to send with (25c), read for every message so a change
   * applies at once: only when WhatsApp is on, an instance is set and the
   * token decrypts; otherwise null and messages go the old way.
   */
  async deliveryCredentials(): Promise<GreenApiCredentials | null> {
    const row = await this.prisma.whatsappSettings.findUnique({
      where: { id: SETTINGS_ROW_ID },
      select: { enabled: true, instanceId: true, tokenCiphertext: true },
    });
    if (!row?.enabled || !row.instanceId || !row.tokenCiphertext) {
      return null;
    }
    const token = this.cipher.decrypt(row.tokenCiphertext);
    return token ? { instanceId: row.instanceId, token } : null;
  }

  /**
   * Sends the fixed test message to a number of the active country (25c), with
   * the saved instance and token even while WhatsApp is off, so the super admin
   * can check them before turning it on. Changes and records nothing.
   */
  async sendTest(rawPhone: string): Promise<void> {
    const row = await this.prisma.whatsappSettings.findUnique({
      where: { id: SETTINGS_ROW_ID },
      select: { instanceId: true, tokenCiphertext: true },
    });
    const token = row?.tokenCiphertext
      ? this.cipher.decrypt(row.tokenCiphertext)
      : null;
    if (!row?.instanceId || !token) {
      throw whatsappNotConfigured();
    }
    const country = await this.prisma.country.findFirst({
      where: { active: true },
      select: { code: true },
    });
    const phone =
      country && isPhoneCountry(country.code)
        ? normalizePhone(rawPhone, country.code)
        : null;
    if (!phone) {
      throw invalidPhone();
    }
    try {
      await this.sendWhatsapp(
        { instanceId: row.instanceId, token },
        phone,
        WHATSAPP_TEST_MESSAGE,
      );
    } catch (error) {
      if (error instanceof WhatsappSendError) {
        throw whatsappSendFailed(error.reason);
      }
      throw error;
    }
  }

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
