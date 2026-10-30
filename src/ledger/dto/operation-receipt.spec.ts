import {
  toOperationReceipt,
  type OperationWithReceipt,
} from './operation-receipt.js';

const DATE = new Date('2026-10-20T10:00:00.000Z');
const KEY = '0192f0a4-1111-7c3e-9d2a-5e6f7a8b9c0d';
const person = (id: string, firstName: string) => ({
  id,
  phone: `+2237600000${id}`,
  firstName,
  lastName: 'Keita',
  pinHash: 'scrypt$secret',
  failedPinAttempts: 0,
  pinLockedUntil: null,
  failedRecoveryAttempts: 0,
  recoveryLockedUntil: null,
  qrCode: null,
  createdAt: DATE,
  updatedAt: DATE,
});

const operation: OperationWithReceipt = {
  id: 'op1',
  reference: 'D-00482',
  accountId: 'a1',
  storeId: 's1',
  goalId: 'g1',
  type: 'DEPOSIT',
  amount: 9007199254740993n,
  direction: 'CREDIT',
  currencyCode: 'XOF',
  balanceBefore: 15000n,
  balanceAfter: 9007199254755993n,
  status: 'CONFIRMED',
  authorId: '2',
  validatedById: null,
  customerConfirmedAt: null,
  correctedOperationId: null,
  reason: null,
  channel: 'CASH',
  externalReference: null,
  idempotencyKey: KEY,
  device: 'device-secret-id',
  createdAt: DATE,
  goal: {
    id: 'g1',
    accountId: 'a1',
    label: 'Non affecté',
    targetAmount: null,
    status: 'IN_PROGRESS',
    isSystem: true,
    balance: 0n,
    projectId: null,
    reachedAt: null,
    articleId: null,
    createdAt: DATE,
  },
  account: {
    id: 'a1',
    number: 'C-000123',
    customerId: '1',
    storeId: 's1',
    currencyCode: 'XOF',
    balance: 0n,
    beneficiaryName: null,
    beneficiaryPhone: null,
    idPhotoPath: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d.jpg',
    status: 'ACTIVE',
    termsAcceptedAt: DATE,
    openedById: '2',
    createdAt: DATE,
    updatedAt: DATE,
    customer: person('1', 'Fanta'),
  },
  store: {
    id: 's1',
    countryCode: 'ML',
    name: 'Quincaillerie du Carrefour',
    address: 'Rue 12',
    city: 'Bamako',
    phone: '+22320220000',
    tradeRegister: 'MA.BKO.2026.B.1234',
    status: 'VERIFIED',
    verifiedAt: DATE,
    statusChangedAt: null,
    statusChangedById: null,
    statusReason: null,
    createdById: null,
    qrCode: null,
    createdAt: DATE,
    updatedAt: DATE,
  },
  author: person('2', 'Moussa'),
  correctedOperation: null,
};

describe('toOperationReceipt', () => {
  it('writes money as exact strings, beyond the JSON number range', () => {
    const receipt = toOperationReceipt(operation);

    expect(receipt).toMatchObject({
      amount: '9007199254740993',
      balanceBefore: '15000',
      balanceAfter: '9007199254755993',
    });
  });

  it('never exposes the key, the device, ids of people, phones, PIN data, or the photo', () => {
    const json = JSON.stringify(toOperationReceipt(operation));

    for (const secret of [
      KEY,
      'device-secret-id',
      'scrypt',
      '+22376000001',
      '+22376000002',
      '.jpg',
      'tradeRegister',
      '"authorId"',
      '"customerId"',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('gives no reason or corrected reference for a deposit', () => {
    expect(toOperationReceipt(operation)).toMatchObject({
      reason: null,
      correctedReference: null,
    });
  });

  it('gives a correction its reason and the reference of the deposit it fixes', () => {
    const receipt = toOperationReceipt({
      ...operation,
      type: 'CORRECTION',
      direction: 'DEBIT',
      reference: 'R-00001',
      correctedOperationId: '0192f0a4-0000-7000-8000-00000000000d',
      reason: 'Erreur de saisie',
      correctedOperation: { reference: 'D-00482' },
    });

    expect(receipt).toMatchObject({
      type: 'CORRECTION',
      reason: 'Erreur de saisie',
      correctedReference: 'D-00482',
    });
    // The link is shown by its reference, never by the operation's id.
    expect(JSON.stringify(receipt)).not.toContain(
      '0192f0a4-0000-7000-8000-00000000000d',
    );
  });
});
