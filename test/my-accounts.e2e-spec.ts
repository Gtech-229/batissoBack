import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { newDeviceKey, TEST_PIN } from './utils/users.js';

describe('The customer’s own accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let storeId: string;
  let seller: MobileStaff;

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sms.clear();
    await createMali(prisma);
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Carrefour',
        status: 'VERIFIED',
      })
    ).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = (
    customer: { phone: string; firstName: string; lastName: string },
    as = seller,
    store = storeId,
  ) =>
    api()
      .post(`/api/v1/stores/${store}/accounts`)
      .set('Authorization', as.authorization)
      .send({ customer, termsAccepted: true })
      .expect(201);
  const myAccounts = (authorization: string) =>
    api().get('/api/v1/me/accounts').set('Authorization', authorization);

  it('takes a customer from the opening at the counter to their accounts in the app', async () => {
    const opened = await openAccount({
      phone: '76 44 55 66',
      firstName: 'Fanta',
      lastName: 'Keita',
    });
    const phone = '+22376445566';
    const deviceId = 'device-fanta-0001';
    const key = newDeviceKey();

    // First sign-in: SMS code, then the PIN that activates the account.
    await api().post('/api/v1/auth/code').send({ phone }).expect(202);
    const { verificationToken } = (
      await api()
        .post('/api/v1/auth/code/verify')
        .send({ phone, deviceId, code: sms.lastCodeFor(phone) })
        .expect(200)
    ).body as { verificationToken: string };
    const session = await api()
      .post('/api/v1/auth/pin')
      .send({ verificationToken, pin: TEST_PIN, publicKey: key.publicKey })
      .expect(200);

    const response = await myAccounts(
      `Bearer ${(session.body as { accessToken: string }).accessToken}`,
    ).expect(200);

    expect(response.body).toEqual([
      {
        id: opened.body.id,
        number: opened.body.number,
        status: 'ACTIVE',
        balance: '0',
        currencyCode: 'XOF',
        customer: {
          userId: opened.body.customer.userId,
          firstName: 'Fanta',
          lastName: 'Keita',
          phone,
        },
        beneficiary: null,
        termsAcceptedAt: opened.body.termsAcceptedAt,
        goals: [
          {
            id: expect.any(String),
            label: 'Non affecté',
            isSystem: true,
            targetAmount: null,
            status: 'IN_PROGRESS',
          },
        ],
        store: { id: storeId, name: 'Quincaillerie du Carrefour' },
        createdAt: opened.body.createdAt,
      },
    ]);
  });

  it('shows a customer their accounts in two stores, and only theirs', async () => {
    const otherStoreId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Fleuve',
        status: 'VERIFIED',
      })
    ).id;
    const otherSeller = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'SELLER' },
    });
    // The customer is a staff member elsewhere: signedInStaff gives a session.
    const customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    const fanta = {
      phone: customer.phone,
      firstName: 'Fanta',
      lastName: 'Diallo',
    };
    await openAccount(fanta);
    await openAccount(fanta, otherSeller, otherStoreId);
    // Someone else's account in the same store.
    await openAccount({
      phone: '76 11 22 33',
      firstName: 'Ali',
      lastName: 'Cissé',
    });

    const response = await myAccounts(customer.authorization).expect(200);

    const accounts = response.body as {
      store: { name: string };
      customer: { userId: string };
    }[];
    // Newest first: the second store's account was opened last.
    expect(accounts.map((account) => account.store.name)).toEqual([
      'Quincaillerie du Fleuve',
      'Quincaillerie du Carrefour',
    ]);
    expect(
      accounts.every((account) => account.customer.userId === customer.userId),
    ).toBe(true);
    expect(accounts[0]).not.toHaveProperty('openedBy');
  });

  it('gives an empty list to a staff member with no account', async () => {
    await openAccount({
      phone: '76 44 55 66',
      firstName: 'Fanta',
      lastName: 'Keita',
    });

    await myAccounts(seller.authorization)
      .expect(200)
      .expect((r) => expect(r.body).toEqual([]));
  });

  it('answers 401 without a session', async () => {
    await api().get('/api/v1/me/accounts').expect(401);
  });
});
