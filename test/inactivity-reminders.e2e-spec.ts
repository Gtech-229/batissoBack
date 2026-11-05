import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SchedulerRegistry } from '@nestjs/schedule';
import { INACTIVITY_REMINDERS_JOB } from '../src/admin-alerts/inactivity-reminders.job.js';
import { InactivityRemindersService } from '../src/admin-alerts/inactivity-reminders.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { CapturingPushSender } from './utils/push.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Inactivity reminders (e2e)', () => {
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let reminders: InactivityRemindersService;
  let storeId: string;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let accountNumber: string;

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
    prisma = app.get(PrismaService);
    reminders = app.get(InactivityRemindersService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Carrefour',
        status: 'VERIFIED',
      })
    ).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      store: { id: storeId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    await prisma.userDevice.updateMany({
      where: { deviceId: customer.deviceId },
      data: { pushToken: 'token-customer-phone' },
    });
    ({ id: accountId, number: accountNumber } = await openAccount(
      storeId,
      customer.phone,
    ));
    await settled();
    sms.clear();
    push.clear();
  });

  // Let every dispatch finish before the next reset deletes its rows.
  afterEach(async () => {
    await settled();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (store: string, phone: string, as = seller) => {
    const body = (
      await api()
        .post(`/api/v1/stores/${store}/accounts`)
        .set('Authorization', as.authorization)
        .send({
          customer: { phone, firstName: 'F', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201)
    ).body as { id: string; number: string };
    return body;
  };
  const deposit = async (amount = '5000', account = accountId) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${account}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount })
        .expect(201)
    ).body as { id: string };
  /** The account's opening, or its only deposit: when its quiet period began. */
  const startOf = async () => {
    const last = await prisma.operation.findFirst({
      where: { accountId, type: 'DEPOSIT' },
      orderBy: { createdAt: 'desc' },
    });
    return (
      last?.createdAt ??
      (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
        .createdAt
    );
  };
  const daysAfter = (start: Date, days: number) =>
    new Date(start.getTime() + days * DAY_MS);
  /**
   * Operations are append-only (no UPDATE, even in tests), so a later
   * operation is a copy of `sourceId` inserted with its own type and date.
   */
  const insertCopy = async (
    sourceId: string,
    type: 'DEPOSIT' | 'CORRECTION' | 'MATERIAL_DEBIT',
    createdAt: Date,
  ) => {
    const columns = (
      await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'operations' ORDER BY ordinal_position`
    ).map((c) => c.column_name);
    const overrides: Record<string, string> = {
      id: 'gen_random_uuid()',
      reference: `'T-' || substr(md5(random()::text), 1, 10)`,
      idempotencyKey: 'gen_random_uuid()',
      type: `$2::"OperationType"`,
      direction: `(CASE WHEN $2 = 'DEPOSIT' THEN 'CREDIT' ELSE 'DEBIT' END)::"OperationDirection"`,
      correctedOperationId: `(CASE WHEN $2 = 'CORRECTION' THEN "id" ELSE NULL END)`,
      reason: `(CASE WHEN $2 = 'CORRECTION' THEN 'Erreur' ELSE "reason" END)`,
      createdAt: '$3::timestamp',
    };
    const list = columns.map((c) => `"${c}"`).join(', ');
    const values = columns.map((c) => overrides[c] ?? `"${c}"`).join(', ');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "operations" (${list}) SELECT ${values} FROM "operations" WHERE "id" = $1::uuid`,
      sourceId,
      type,
      createdAt,
    );
  };
  const reminderRows = () =>
    prisma.notification.findMany({
      where: { type: 'INACTIVITY_REMINDER' },
      orderBy: { channel: 'asc' },
    });
  const settled = async () => {
    for (let i = 0; i < 100; i++) {
      if (
        (await prisma.notification.count({ where: { status: 'PENDING' } })) ===
        0
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  describe('remindQuietAccounts', () => {
    it('reminds a customer once by app, push and SMS, naming the account and the store', async () => {
      await deposit();
      await settled();
      sms.clear();
      push.clear();
      const now = daysAfter(await startOf(), 31);

      const result = await reminders.remindQuietAccounts(now);
      await settled();

      expect(result).toEqual({ accountsReminded: 1 });
      const rows = await reminderRows();
      expect(rows.map((row) => [row.channel, row.userId])).toEqual([
        ['APP', customer.userId],
        ['PUSH', customer.userId],
        ['SMS', customer.userId],
      ]);
      const body = `Vous n’avez fait aucun dépôt sur votre compte ${accountNumber} chez Quincaillerie du Carrefour depuis 31 jours. Votre épargne reste entière, elle ne diminue jamais. Passez déposer quand vous voulez.`;
      expect(rows[0]).toMatchObject({
        title: 'Rappel : pensez à épargner',
        body,
        storeId,
        operationId: null,
      });
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Rappel : pensez à épargner' }),
      ]);
      expect(sms.messages).toEqual([
        expect.objectContaining({ phone: customer.phone }),
      ]);
      expect(body).not.toMatch(/sécuris|garanti/i);
      const account = await prisma.account.findUniqueOrThrow({
        where: { id: accountId },
      });
      expect(account.inactivityRemindedAt).toEqual(now);
      expect(account.balance).toBe(5000n);
    });

    it('never reminds twice for one quiet period, even in two parallel runs', async () => {
      await deposit();
      const now = daysAfter(await startOf(), 31);

      const [first, second] = await Promise.all([
        reminders.remindQuietAccounts(now),
        reminders.remindQuietAccounts(now),
      ]);
      const later = await reminders.remindQuietAccounts(daysAfter(now, 60));

      expect(first.accountsReminded + second.accountsReminded).toBe(1);
      expect(later.accountsReminded).toBe(0);
      expect(
        (await reminderRows()).filter((row) => row.channel === 'APP'),
      ).toHaveLength(1);
    });

    it('starts a new quiet period at the next deposit', async () => {
      const { id } = await deposit();
      const start = await startOf();
      await reminders.remindQuietAccounts(daysAfter(start, 31));
      // A deposit made 40 days after the first one, then 31 quiet days.
      await insertCopy(id, 'DEPOSIT', daysAfter(start, 40));

      expect(await reminders.remindQuietAccounts(daysAfter(start, 60))).toEqual(
        { accountsReminded: 0 },
      );
      expect(await reminders.remindQuietAccounts(daysAfter(start, 71))).toEqual(
        { accountsReminded: 1 },
      );
    });

    it.each(['CORRECTION', 'MATERIAL_DEBIT'] as const)(
      'does not restart the period on a %s',
      async (type) => {
        const { id } = await deposit();
        const start = await startOf();
        await insertCopy(id, type, daysAfter(start, 20));

        expect(
          await reminders.remindQuietAccounts(daysAfter(start, 31)),
        ).toEqual({ accountsReminded: 1 });
        const [row] = await reminderRows();
        expect(row.body).toContain('depuis 31 jours');
      },
    );

    it('counts an account that never had a deposit from its opening', async () => {
      const opened = await startOf();

      expect(
        await reminders.remindQuietAccounts(daysAfter(opened, 29)),
      ).toEqual({ accountsReminded: 0 });
      expect(
        await reminders.remindQuietAccounts(daysAfter(opened, 30)),
      ).toEqual({ accountsReminded: 1 });
      expect((await reminderRows())[0].body).toContain('depuis 30 jours');
    });

    it('takes the delay from the platform settings', async () => {
      await deposit();
      const start = await startOf();
      await prisma.systemSettings.create({
        data: {
          id: 1,
          maxLoginAttempts: 5,
          maxAdminSessions: 3,
          inactivityReminderDays: 45,
        },
      });

      expect(await reminders.remindQuietAccounts(daysAfter(start, 44))).toEqual(
        { accountsReminded: 0 },
      );
      expect(await reminders.remindQuietAccounts(daysAfter(start, 45))).toEqual(
        { accountsReminded: 1 },
      );
    });

    it('does not remind a suspended account', async () => {
      await deposit();
      const start = await startOf();
      await prisma.account.update({
        where: { id: accountId },
        data: { status: 'SUSPENDED', statusReason: 'Fraude suspectée' },
      });

      expect(await reminders.remindQuietAccounts(daysAfter(start, 31))).toEqual(
        { accountsReminded: 0 },
      );
    });

    it.each(['PENDING', 'SUSPENDED', 'CLOSED'] as const)(
      'does not remind in a %s store',
      async (status) => {
        await deposit();
        const start = await startOf();
        await prisma.hardwareStore.update({
          where: { id: storeId },
          data: { status },
        });

        expect(
          await reminders.remindQuietAccounts(daysAfter(start, 31)),
        ).toEqual({ accountsReminded: 0 });
        expect(await reminderRows()).toEqual([]);
      },
    );

    it('reminds each of a customer’s accounts separately, naming each store', async () => {
      const otherStore = (
        await createStoreRecord(prisma, {
          name: 'Matériaux Diallo',
          status: 'VERIFIED',
        })
      ).id;
      const otherSeller = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStore, role: 'SELLER' },
      });
      await openAccount(otherStore, customer.phone, otherSeller);
      const now = daysAfter(new Date(), 31);

      expect(await reminders.remindQuietAccounts(now)).toEqual({
        accountsReminded: 2,
      });
      const bodies = (await reminderRows())
        .filter((row) => row.channel === 'APP')
        .map((row) => row.body);
      expect(bodies).toEqual(
        expect.arrayContaining([
          expect.stringContaining('chez Quincaillerie du Carrefour'),
          expect.stringContaining('chez Matériaux Diallo'),
        ]),
      );
    });
  });

  it('schedules the reminders every day at 09:00 UTC', () => {
    const job = app.get(SchedulerRegistry).getCronJob(INACTIVITY_REMINDERS_JOB);

    expect(job.cronTime.source).toBe('0 9 * * *');
    expect(job.cronTime.timeZone).toBe('UTC');
    expect(job.isActive).toBe(true);
  });
});
