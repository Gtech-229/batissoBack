import {
  depositMessage,
  goalReachedMessage,
  groupThousands,
} from './messages.js';

describe('groupThousands', () => {
  it.each([
    [0n, '0'],
    [500n, '500'],
    [5000n, '5 000'],
    [20000n, '20 000'],
    [1990000n, '1 990 000'],
    [123456789012n, '123 456 789 012'],
  ])('writes %s as %s', (value, text) => {
    expect(groupThousands(value)).toBe(text);
  });
});

describe('depositMessage', () => {
  const message = depositMessage({
    amount: 5000n,
    currencyCode: 'XOF',
    storeName: 'Quincaillerie du Carrefour',
    accountNumber: 'C-000123',
    balanceAfter: 20000n,
    reference: 'D-00482',
  });

  it('gives the agreed French title and body', () => {
    expect(message).toEqual({
      title: 'Dépôt reçu',
      body: 'Dépôt de 5 000 XOF reçu par Quincaillerie du Carrefour sur votre compte C-000123. Nouveau solde : 20 000 XOF. Réf. D-00482.',
    });
  });

  it('never claims the money is "sécurisé" or "garanti"', () => {
    const text = `${message.title} ${message.body}`.toLowerCase();

    expect(text).not.toMatch(/sécuris|garanti/);
  });

  it('fits the database columns', () => {
    expect(message.title.length).toBeLessThanOrEqual(100);
    expect(message.body.length).toBeLessThanOrEqual(500);
  });
});

describe('goalReachedMessage', () => {
  const message = goalReachedMessage({
    label: 'Ciment',
    balance: 150000n,
    targetAmount: 150000n,
    currencyCode: 'XOF',
    accountNumber: 'C-000123',
    storeName: 'Quincaillerie du Carrefour',
  });

  it('gives the agreed French title and body', () => {
    expect(message).toEqual({
      title: 'Objectif atteint',
      body: 'Votre objectif « Ciment » atteint 150 000 XOF (objectif : 150 000 XOF) sur votre compte C-000123 chez Quincaillerie du Carrefour.',
    });
  });

  it('never claims the money is "sécurisé" or "garanti", and fits the columns', () => {
    expect(`${message.title} ${message.body}`.toLowerCase()).not.toMatch(
      /sécuris|garanti/,
    );
    expect(message.body.length).toBeLessThanOrEqual(500);
  });
});
