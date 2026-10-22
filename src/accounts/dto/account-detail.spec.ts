import type { Goal, User } from '../../generated/prisma/client.js';
import { toAccountDetail, type AccountWithDetail } from './account-detail.js';

const user = (id: string, firstName: string): User => ({
  id,
  phone: `+2237600000${id}`,
  firstName,
  lastName: 'Diallo',
  pinHash: 'scrypt$secret',
  failedPinAttempts: 2,
  pinLockedUntil: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
});

const goal = (overrides: Partial<Goal>): Goal => ({
  id: 'g1',
  accountId: 'a1',
  label: 'Non affecté',
  targetAmount: null,
  status: 'IN_PROGRESS',
  isSystem: true,
  balance: 0n,
  projectId: null,
  reachedAt: null,
  createdAt: new Date('2026-10-14T10:00:00.000Z'),
  ...overrides,
});

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
  status: 'ACTIVE',
  termsAcceptedAt: new Date('2026-10-14T10:00:00.000Z'),
  openedById: '2',
  createdAt: new Date('2026-10-14T10:00:00.000Z'),
  updatedAt: new Date('2026-10-14T10:00:00.000Z'),
  customer: user('1', 'Fanta'),
  openedBy: user('2', 'Moussa'),
  goals: [goal({})],
  projects: [],
  ...overrides,
});

describe('toAccountDetail', () => {
  it('writes money as exact strings, beyond the JSON number range', () => {
    const detail = toAccountDetail(
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
    const json = JSON.stringify(toAccountDetail(account()));

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
    const detail = toAccountDetail(
      account({ beneficiaryName: null, beneficiaryPhone: null }),
    );

    expect(detail.beneficiary).toBeNull();
  });

  it('keeps a beneficiary without a phone', () => {
    const detail = toAccountDetail(account({ beneficiaryPhone: null }));

    expect(detail.beneficiary).toEqual({ name: 'Ali Keita', phone: null });
  });
});
