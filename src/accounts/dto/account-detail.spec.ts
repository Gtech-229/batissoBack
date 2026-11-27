import type { Article, User } from '../../generated/prisma/client.js';
import {
  closedByOf,
  closedReasonFor,
  reasonFor,
  toAccountDetail,
  type AccountWithDetail,
  type GoalWithArticle,
} from './account-detail.js';

const user = (id: string, firstName: string): User => ({
  id,
  phone: `+2237600000${id}`,
  firstName,
  lastName: 'Diallo',
  pinHash: 'scrypt$secret',
  failedPinAttempts: 2,
  pinLockedUntil: null,
  failedRecoveryAttempts: 0,
  recoveryLockedUntil: null,
  qrCode: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
});

const goal = (overrides: Partial<GoalWithArticle>): GoalWithArticle => ({
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
  article: null,
  createdAt: new Date('2026-10-14T10:00:00.000Z'),
  ...overrides,
});

const cement: Article = {
  id: 'art1',
  storeId: 's1',
  categoryId: 'cat1',
  name: 'Ciment CPA 45',
  unit: 'sac de 50 kg',
  currentPrice: 5000n,
  available: true,
  createdAt: new Date('2026-10-14T10:00:00.000Z'),
  updatedAt: new Date('2026-10-14T10:00:00.000Z'),
};

const account = (
  overrides: Partial<AccountWithDetail> = {},
): AccountWithDetail => ({
  id: 'a1',
  number: 'C-000123',
  customerId: '1',
  storeId: 's1',
  currencyCode: 'XOF',
  balance: 9007199254740993n,
  beneficiaryName: 'Ali Keita',
  beneficiaryPhone: '+22376778899',
  idPhotoPath: null,
  status: 'ACTIVE',
  statusReason: null,
  inactivityRemindedAt: null,
  statusChangedAt: null,
  statusChangedById: null,
  termsAcceptedAt: new Date('2026-10-14T10:00:00.000Z'),
  openedById: '2',
  closedAt: null,
  closedById: null,
  closedReason: null,
  createdAt: new Date('2026-10-14T10:00:00.000Z'),
  updatedAt: new Date('2026-10-14T10:00:00.000Z'),
  customer: user('1', 'Fanta'),
  openedBy: user('2', 'Moussa'),
  goals: [goal({})],
  projects: [],
  ...overrides,
});

/** Read by a colleague: not the account's customer ('1'). */
const STAFF_ID = 'staff-9';
const detailFor = (a: Parameters<typeof toAccountDetail>[0]) =>
  toAccountDetail(a, STAFF_ID);

describe('reasonFor (F-43)', () => {
  const suspended = { customerId: '1', statusReason: 'Fraude suspectée' };

  it('gives a colleague the reason', () => {
    expect(reasonFor(suspended, STAFF_ID)).toBe('Fraude suspectée');
  });

  it('never gives it to the account’s own customer, even as staff', () => {
    expect(reasonFor(suspended, '1')).toBeNull();
  });
});

describe('closedByOf (28)', () => {
  it('is null while the account is not closed', () => {
    expect(closedByOf({ customerId: '1', closedById: null })).toBeNull();
  });

  it('is CUSTOMER when the customer left', () => {
    expect(closedByOf({ customerId: '1', closedById: '1' })).toBe('CUSTOMER');
  });

  it('is STORE when someone else (the manager) closed it', () => {
    expect(closedByOf({ customerId: '1', closedById: '2' })).toBe('STORE');
  });
});

describe('closedReasonFor (28)', () => {
  const removed = { customerId: '1', closedReason: 'Client injoignable' };

  it('gives a colleague the reason', () => {
    expect(closedReasonFor(removed, STAFF_ID)).toBe('Client injoignable');
  });

  it('never gives it to the account’s own customer, even as staff', () => {
    expect(closedReasonFor(removed, '1')).toBeNull();
  });
});

describe('toAccountDetail', () => {
  it('shows a removal to staff: when, by the store, and why', () => {
    const closedAt = new Date('2026-11-27T09:00:00.000Z');
    const detail = detailFor(
      account({
        status: 'CLOSED',
        closedAt,
        closedById: '2',
        closedReason: 'Client injoignable',
      }),
    );

    expect(detail).toMatchObject({
      status: 'CLOSED',
      closedAt,
      closedBy: 'STORE',
      closedReason: 'Client injoignable',
    });
  });

  it('never shows the closing reason to the account’s own customer', () => {
    const detail = toAccountDetail(
      account({
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: '2',
        closedReason: 'Client injoignable',
      }),
      '1',
    );

    expect(detail.closedBy).toBe('STORE');
    expect(detail.closedReason).toBeNull();
  });

  it('writes money as exact strings, beyond the JSON number range', () => {
    const detail = detailFor(
      account({
        goals: [
          goal({}),
          goal({
            id: 'g2',
            label: 'Ciment',
            isSystem: false,
            targetAmount: 150000n,
          }),
        ],
      }),
    );

    expect(detail.balance).toBe('9007199254740993');
    expect(detail.goals.map((g) => g.targetAmount)).toEqual([null, '150000']);
  });

  it('never exposes PIN data or internal foreign keys', () => {
    const json = JSON.stringify(detailFor(account()));

    expect(json).not.toContain('scrypt');
    for (const key of [
      'pinHash',
      'failedPinAttempts',
      'customerId',
      'storeId',
      'openedById',
      'accountId',
      'updatedAt',
    ]) {
      expect(json).not.toContain(`"${key}"`);
    }
  });

  it('gives a null beneficiary when none was recorded', () => {
    const detail = detailFor(
      account({ beneficiaryName: null, beneficiaryPhone: null }),
    );

    expect(detail.beneficiary).toBeNull();
  });

  it('keeps a beneficiary without a phone', () => {
    const detail = detailFor(account({ beneficiaryPhone: null }));

    expect(detail.beneficiary).toEqual({ name: 'Ali Keita', phone: null });
  });

  it('gives no equivalence for a goal without an article', () => {
    expect(detailFor(account()).goals[0].equivalence).toBeNull();
  });

  it('shows a linked goal as whole units of its article at the price of the day', () => {
    const detail = detailFor(
      account({
        goals: [
          goal({
            id: 'g2',
            isSystem: false,
            label: 'Ciment',
            targetAmount: 152500n,
            balance: 34999n,
            articleId: cement.id,
            article: cement,
          }),
        ],
      }),
    );

    expect(detail.goals[0].equivalence).toEqual({
      article: {
        id: 'art1',
        name: 'Ciment CPA 45',
        unit: 'sac de 50 kg',
        unitPrice: '5000',
        available: true,
      },
      quantity: '6',
      targetQuantity: '30',
    });
    // Only the public fields of the article.
    const json = JSON.stringify(detail.goals[0].equivalence);
    expect(json).not.toContain('categoryId');
    expect(json).not.toContain('"storeId"');
  });
});
