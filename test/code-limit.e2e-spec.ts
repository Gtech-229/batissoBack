import { Logger, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AdminAlertType } from '../src/generated/prisma/client.js';
import { CODE_REQUESTED_MESSAGE } from '../src/mobile-auth/dto/code-responses.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DEFAULT_SYSTEM_SETTINGS } from '../src/system-settings/system-settings.service.js';
import { createTestApp } from './utils/app.js';
import { createMali } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';

/** Platform-wide sign-in code caps (25a), on top of the per-phone limits. */
describe('Global code limit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sms.clear();
    await createMali(prisma);
    warn = vi.spyOn(Logger.prototype, 'warn');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  /** A distinct Mali number per index: 76 00 00 01, 76 00 00 02, ... */
  const phone = (n: number) => `76 00 00 ${String(n).padStart(2, '0')}`;
  const e164 = (n: number) => `+2237600${String(n).padStart(4, '0')}`;
  const requestCode = (n: number) =>
    api()
      .post('/api/v1/auth/code')
      .send({ countryCode: 'ML', phone: phone(n) })
      .expect(202);

  const saveCaps = (maxCodesPerHour: number, maxCodesPerDay: number) =>
    prisma.systemSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        ...DEFAULT_SYSTEM_SETTINGS,
        maxCodesPerHour,
        maxCodesPerDay,
      },
      update: { maxCodesPerHour, maxCodesPerDay },
    });

  const openCodeAlerts = () =>
    prisma.adminAlert.findMany({
      where: { type: AdminAlertType.CODE_LIMIT_REACHED, resolvedAt: null },
    });

  /** The alert is recorded after the answer, without being awaited. */
  const waitForOpenAlerts = (count: number) =>
    vi.waitFor(async () => {
      expect(await openCodeAlerts()).toHaveLength(count);
    });

  it('stops codes past the hourly cap with an unchanged answer, and alerts once', async () => {
    await saveCaps(2, 200);

    const first = await requestCode(1);
    await requestCode(2);
    const capped = await requestCode(3);

    // The third phone gets no code, and the answer says nothing about it.
    expect(capped.body).toEqual(first.body);
    expect(capped.body).toEqual({ message: CODE_REQUESTED_MESSAGE });
    expect(sms.messages.map((m) => m.phone)).toEqual([e164(1), e164(2)]);
    expect(await prisma.phoneVerification.count()).toBe(2);
    await waitForOpenAlerts(1);
    const [alert] = await openCodeAlerts();
    expect(alert).toMatchObject({
      storeId: null,
      accountId: null,
      goalId: null,
      orderId: null,
      difference: null,
    });
    // A warning without the phone number.
    expect(warn).toHaveBeenCalledWith(
      'Code limit reached (hour): no code sent',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('7600');

    // A fourth capped request adds no second open alert.
    await requestCode(4);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await openCodeAlerts()).toHaveLength(1);
    expect(sms.messages).toHaveLength(2);
  });

  it('opens a new alert once the previous one is resolved', async () => {
    await saveCaps(1, 200);
    await requestCode(1);
    await requestCode(2);
    await waitForOpenAlerts(1);

    await prisma.adminAlert.updateMany({
      where: { type: AdminAlertType.CODE_LIMIT_REACHED },
      data: { resolvedAt: new Date() },
    });
    await requestCode(3);

    await waitForOpenAlerts(1);
    expect(
      await prisma.adminAlert.count({
        where: { type: AdminAlertType.CODE_LIMIT_REACHED },
      }),
    ).toBe(2);
  });

  it('stops codes past the daily cap, counting the last 24 hours only', async () => {
    await saveCaps(10_000, 2);
    await requestCode(1);
    await requestCode(2);
    // Both codes move back 2 hours: out of the hour, still in the day.
    await prisma.$executeRaw`
      UPDATE "phone_verifications"
      SET "createdAt" = "createdAt" - interval '2 hours'`;

    await requestCode(3);

    expect(sms.messages).toHaveLength(2);
    await waitForOpenAlerts(1);
    expect(warn).toHaveBeenCalledWith('Code limit reached (day): no code sent');

    // Older than 24 hours, they no longer count: the next phone gets its code.
    await prisma.$executeRaw`
      UPDATE "phone_verifications"
      SET "createdAt" = "createdAt" - interval '23 hours'`;
    await requestCode(4);

    expect(sms.messages.map((m) => m.phone)).toEqual([
      e164(1),
      e164(2),
      e164(4),
    ]);
  });

  it('counts only codes of the last hour against the hourly cap', async () => {
    await saveCaps(2, 200);
    await requestCode(1);
    await requestCode(2);
    await prisma.$executeRaw`
      UPDATE "phone_verifications"
      SET "createdAt" = "createdAt" - interval '61 minutes'`;

    await requestCode(3);

    expect(sms.messages).toHaveLength(3);
    expect(await openCodeAlerts()).toHaveLength(0);
  });

  it('keeps the per-phone limits, which never raise the platform alert', async () => {
    await saveCaps(50, 200);
    await requestCode(1);
    // Within the 1-minute cooldown: refused per phone, not by the platform.
    await requestCode(1);

    expect(sms.messages).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await openCodeAlerts()).toHaveLength(0);
  });

  it('uses the defaults (50 an hour) when no settings were saved', async () => {
    // 50 codes already sent this hour by other phones.
    await prisma.phoneVerification.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        phone: `+2236500${String(i).padStart(4, '0')}`,
        codeHash: 'x',
        expiresAt: new Date(Date.now() + 600_000),
      })),
    });

    await requestCode(1);

    expect(sms.messages).toHaveLength(0);
    await waitForOpenAlerts(1);
  });

  it('lets exactly the free slots through when requests arrive together (F-93)', async () => {
    await saveCaps(2, 200);

    // Six different phones at once, for two free slots: the global lock
    // makes each request count after the previous one stored its code.
    const answers = await Promise.all([1, 2, 3, 4, 5, 6].map(requestCode));

    expect(new Set(answers.map((a) => JSON.stringify(a.body))).size).toBe(1);
    expect(await prisma.phoneVerification.count()).toBe(2);
    expect(sms.messages).toHaveLength(2);
    await waitForOpenAlerts(1);
  });

  it('keeps the answer and logs, without the phone, when the alert cannot be recorded (F-93)', async () => {
    await saveCaps(1, 200);
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const createMany = vi
      .spyOn(prisma.adminAlert, 'createMany')
      .mockRejectedValueOnce(new Error('database unavailable'));
    await requestCode(1);

    const capped = await requestCode(2);

    expect(capped.body).toEqual({ message: CODE_REQUESTED_MESSAGE });
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        'Code limit alert not recorded (Error)',
      );
    });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('7600');
    expect(await openCodeAlerts()).toHaveLength(0);
  });

  it.each([
    [
      'another type with only an account',
      { type: 'GOAL_SUM_GAP', storeId: null, accountId: 'acct' },
    ],
    [
      'another type with only a store',
      { type: 'GOAL_SUM_GAP', storeId: 'store', accountId: null },
    ],
    [
      'another type with neither',
      { type: 'GOAL_SUM_GAP', storeId: null, accountId: null },
    ],
    [
      'a code-limit alert with a store',
      { type: 'CODE_LIMIT_REACHED', storeId: 'store', accountId: null },
    ],
  ])('refuses %s in the database (F-92)', async (_label, row) => {
    // Checked before the foreign keys: random ids are enough.
    const id = (value: string | null) => (value ? crypto.randomUUID() : null);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "admin_alerts" ("id", "type", "storeId", "accountId")
        VALUES (${crypto.randomUUID()}::uuid, ${row.type}::"AdminAlertType",
                ${id(row.storeId)}::uuid, ${id(row.accountId)}::uuid)`,
    ).rejects.toThrow(/admin_alerts_target_check/);
  });
});
