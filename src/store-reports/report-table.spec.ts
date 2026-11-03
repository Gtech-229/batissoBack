import { customersTable, sellersTable, totalsTable } from './report-table.js';

describe('totalsTable', () => {
  const report = {
    from: '2026-10-01',
    to: '2026-10-31',
    currencyCode: 'XOF',
    deposits: { count: 2, total: '25000' },
    corrections: { count: 1, total: '3000' },
    purchases: { count: 1, total: '7000' },
    recredits: { count: 0, total: '0' },
    netCash: '-400',
  };

  it('names the period and the currency', () => {
    const table = totalsTable(report);

    expect(table.subtitle).toBe('Du 2026-10-01 au 2026-10-31 (UTC)');
    expect(table.columns[2].label).toBe('Montant (XOF)');
  });

  it('gives one line per kind, and the cash with no count', () => {
    expect(totalsTable(report).rows).toEqual([
      ['Dépôts', 2, 25000n],
      ['Corrections de dépôts', 1, 3000n],
      ['Achats de matériaux', 1, 7000n],
      ['Recrédits', 0, 0n],
      ['Espèces reçues', null, -400n],
    ]);
  });
});

describe('customersTable', () => {
  const row = {
    accountId: 'a',
    accountNumber: 'C-000042',
    firstName: 'Fanta',
    lastName: 'Coulibaly',
    balance: '85000',
    lastDepositAt: new Date('2026-10-28T09:30:00.000Z'),
    status: 'ACTIVE' as const,
  };

  it('prints a row in French, with the deposit’s day', () => {
    expect(customersTable([row], undefined, '2026-11-02', 'XOF').rows).toEqual([
      ['C-000042', 'Fanta Coulibaly', 'Actif', '2026-10-28', 85000n],
    ]);
  });

  it('names the currency', () => {
    const { columns } = customersTable([], undefined, '2026-11-02', 'XOF');

    expect(columns[4].label).toBe('Solde (XOF)');
  });

  it('says when there was no deposit', () => {
    const [cells] = customersTable(
      [{ ...row, lastDepositAt: null, status: 'INACTIVE' }],
      undefined,
      '2026-11-02',
      'XOF',
    ).rows;

    expect(cells[2]).toBe('Inactif');
    expect(cells[3]).toBe('Aucun');
  });

  it.each([
    [undefined, 'tous les clients'],
    ['ACTIVE' as const, 'clients actifs'],
    ['INACTIVE' as const, 'clients inactifs'],
  ])('names the filter %s in the subtitle', (status, scope) => {
    expect(customersTable([], status, '2026-11-02', 'XOF').subtitle).toBe(
      `Au 2026-11-02 (UTC), ${scope}`,
    );
  });
});

describe('sellersTable', () => {
  const report = {
    from: '2026-10-01',
    to: '2026-10-31',
    currencyCode: 'XOF',
    staff: [
      {
        userId: 'u',
        firstName: 'Moussa',
        lastName: 'Traoré',
        role: 'SELLER' as const,
        active: false,
        deposits: { count: 2, total: '5000' },
        ordersPrepared: 3,
        ordersPaid: { count: 1, total: '700' },
        correctionsOnDeposits: 1,
      },
    ],
  };

  it('prints a row, marking a former member', () => {
    expect(sellersTable(report).rows).toEqual([
      ['Moussa Traoré', 'Vendeur (ancien)', 2, 5000n, 3, 1, 700n, 1],
    ]);
  });

  it('names the currency in the subtitle', () => {
    expect(sellersTable(report).subtitle).toContain('montants en XOF');
  });
});
