import {
  accessRecoveredMessage,
  accessResetMessage,
  accountStatusMessage,
  cancellationRequestedMessage,
  correctionMessage,
  depositMessage,
  disputeClosedMessage,
  disputeCustomerMessage,
  disputeExcerpt,
  disputeOpenedMessage,
  disputeStoreReplyMessage,
  goalReachedMessage,
  groupThousands,
  orderAwaitingCustomerMessage,
  orderDeliveredMessage,
  orderRefusedByCustomerMessage,
  paidOrderCancelledMessage,
  purchaseMessage,
} from './messages.js';

describe('accountStatusMessage', () => {
  const change = { accountNumber: 'C-000123', storeName: 'Quincaillerie Sira' };

  it('tells a suspension: account, store, what stops and what still works', () => {
    const { title, body } = accountStatusMessage({
      ...change,
      suspended: true,
    });

    expect(title).toBe('Compte suspendu');
    expect(body).toContain('C-000123');
    expect(body).toContain('Quincaillerie Sira');
    expect(body).toContain('ne reçoit plus de dépôts');
    expect(body).toContain('achats de matériaux restent possibles');
  });

  it('tells a reactivation', () => {
    const { title, body } = accountStatusMessage({
      ...change,
      suspended: false,
    });

    expect(title).toBe('Compte réactivé');
    expect(body).toContain('de nouveau actif');
  });

  it('never claims the money is "sécurisé" or "garanti"', () => {
    const text = [true, false]
      .map((suspended) => accountStatusMessage({ ...change, suspended }))
      .map((m) => m.title + m.body)
      .join(' ');

    expect(text).not.toMatch(/sécuris|garanti/);
  });

  it('fits the columns with a long store name', () => {
    const { title, body } = accountStatusMessage({
      ...change,
      storeName: 'Q'.repeat(150),
      suspended: true,
    });

    expect(title.length).toBeLessThanOrEqual(100);
    expect(body.length).toBeLessThanOrEqual(500);
  });
});

describe('accessResetMessage', () => {
  it('names the store and the way back in', () => {
    const { title, body } = accessResetMessage({
      storeName: 'Quincaillerie Sira',
    });

    expect(title).toBe('Accès réinitialisé');
    expect(body).toContain('Quincaillerie Sira a réinitialisé votre accès');
    expect(body).toContain('nouveau code PIN');
  });
});

describe('accessRecoveredMessage', () => {
  it('says what changed and what to do if it was not the user', () => {
    const { title, body } = accessRecoveredMessage();

    expect(title).toBe('Accès récupéré');
    expect(body).toContain('votre code PIN a changé');
    expect(body).toContain('Si ce n’est pas vous');
  });
});

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

describe('orderRefusedByCustomerMessage', () => {
  const order = {
    reference: 'B-00042',
    total: 250000n,
    currencyCode: 'XOF',
    accountNumber: 'C-000123',
  };

  it('tells the manager which order the customer refused, with the reason', () => {
    expect(
      orderRefusedByCustomerMessage({ ...order, reason: 'Pas commandé' }),
    ).toEqual({
      title: 'Bon refusé par le client',
      body: 'Le client du compte C-000123 a refusé le bon B-00042 de 250 000 XOF. Motif : « Pas commandé ».',
    });
  });

  it('leaves the reason out when there is none', () => {
    expect(orderRefusedByCustomerMessage({ ...order, reason: null }).body).toBe(
      'Le client du compte C-000123 a refusé le bon B-00042 de 250 000 XOF.',
    );
  });
});

describe('orderAwaitingCustomerMessage', () => {
  it('names the order, the amount, and the store, and says nothing is debited yet', () => {
    expect(
      orderAwaitingCustomerMessage({
        reference: 'B-00042',
        total: 20000n,
        currencyCode: 'XOF',
        storeName: 'Quincaillerie du Carrefour',
      }),
    ).toEqual({
      title: 'Bon à confirmer',
      body: 'Le bon B-00042 de 20 000 XOF chez Quincaillerie du Carrefour attend votre confirmation. Rien n’est débité avant.',
    });
  });
});

describe('purchaseMessage', () => {
  it('gives the amount, the order, the new balance, and the reference', () => {
    const message = purchaseMessage({
      total: 20000n,
      currencyCode: 'XOF',
      orderReference: 'B-00042',
      storeName: 'Quincaillerie du Carrefour',
      accountNumber: 'C-000123',
      balanceAfter: 80000n,
      reference: 'A-00007',
    });

    expect(message).toEqual({
      title: 'Achat enregistré',
      body: 'Achat de 20 000 XOF (bon B-00042) chez Quincaillerie du Carrefour sur votre compte C-000123. Nouveau solde : 80 000 XOF. Réf. A-00007.',
    });
    // Project rule: money is never said to be "sécurisé" or "garanti".
    expect(message.body).not.toMatch(/sécuris|garanti/);
  });
});

describe('orderDeliveredMessage', () => {
  it('names the order, the amount, and the store', () => {
    const message = orderDeliveredMessage({
      reference: 'B-00042',
      total: 20000n,
      currencyCode: 'XOF',
      storeName: 'Quincaillerie du Carrefour',
    });

    expect(message).toEqual({
      title: 'Bon livré',
      body: 'Le bon B-00042 de 20 000 XOF chez Quincaillerie du Carrefour vous a été livré.',
    });
    // Project rule: money is never said to be "sécurisé" or "garanti".
    expect(message.body).not.toMatch(/sécuris|garanti/);
  });
});

describe('correctionMessage', () => {
  it('gives the amount, the deposit, the reason, the new balance, and the reference', () => {
    const message = correctionMessage({
      amount: 4500n,
      currencyCode: 'XOF',
      storeName: 'Quincaillerie du Carrefour',
      accountNumber: 'C-000123',
      depositReference: 'D-00482',
      reason: 'Erreur de saisie',
      balanceAfter: 15000n,
      reference: 'R-00001',
    });

    expect(message).toEqual({
      title: 'Correction de votre compte',
      body: 'Correction de 4 500 XOF retirée de votre compte C-000123 chez Quincaillerie du Carrefour (dépôt D-00482) : « Erreur de saisie ». Nouveau solde : 15 000 XOF. Réf. R-00001.',
    });
    // Project rule: money is never said to be "sécurisé" or "garanti".
    expect(message.body).not.toMatch(/sécuris|garanti/);
  });
});

describe('paidOrderCancelledMessage', () => {
  it('gives the order, the reason, the amount back, the new balance, and the reference', () => {
    const message = paidOrderCancelledMessage({
      orderReference: 'B-00042',
      total: 20000n,
      currencyCode: 'XOF',
      storeName: 'Quincaillerie du Carrefour',
      accountNumber: 'C-000123',
      reason: 'Rupture de stock',
      balanceAfter: 300000n,
      reference: 'R-00002',
    });

    expect(message).toEqual({
      title: 'Bon annulé et remboursé',
      body: 'Le bon B-00042 chez Quincaillerie du Carrefour est annulé : « Rupture de stock ». 20 000 XOF remis sur votre compte C-000123. Nouveau solde : 300 000 XOF. Réf. R-00002.',
    });
    // Project rule: money is never said to be "sécurisé" or "garanti".
    expect(message.body).not.toMatch(/sécuris|garanti/);
  });
});

describe('cancellationRequestedMessage', () => {
  const order = {
    accountNumber: 'C-000123',
    orderReference: 'B-00042',
    total: 20000n,
    currencyCode: 'XOF',
  };

  it('names the account, the order, the amount, and what the manager must do, with the reason', () => {
    const message = cancellationRequestedMessage({
      ...order,
      reason: 'Toujours pas livré',
    });

    expect(message).toEqual({
      title: 'Demande d’annulation d’un bon',
      body: 'Le client du compte C-000123 demande l’annulation du bon B-00042 de 20 000 XOF, toujours pas livré. Livrez-le ou annulez-le avec remboursement. Motif : « Toujours pas livré ».',
    });
    // Project rule: money is never said to be "sécurisé" or "garanti".
    expect(message.body).not.toMatch(/sécuris|garanti/);
  });

  it('leaves the reason out when there is none', () => {
    expect(cancellationRequestedMessage({ ...order, reason: null }).body).toBe(
      'Le client du compte C-000123 demande l’annulation du bon B-00042 de 20 000 XOF, toujours pas livré. Livrez-le ou annulez-le avec remboursement.',
    );
  });
});

describe('dispute messages', () => {
  const dispute = {
    operationReference: 'D-00482',
    accountNumber: 'C-000123',
    storeName: 'Quincaillerie du Carrefour',
    message: 'Je n’ai versé que 5 000 F.',
  };

  it('tells the managers of a new dispute, a customer message, and a close', () => {
    expect(disputeOpenedMessage(dispute)).toEqual({
      title: 'Nouvelle contestation',
      body: 'Contestation ouverte sur l’opération D-00482 du compte C-000123 : « Je n’ai versé que 5 000 F. ».',
    });
    expect(disputeCustomerMessage(dispute)).toEqual({
      title: 'Contestation : nouveau message du client',
      body: 'Le client du compte C-000123 a écrit dans sa contestation sur l’opération D-00482 : « Je n’ai versé que 5 000 F. ».',
    });
    expect(disputeClosedMessage(dispute)).toEqual({
      title: 'Contestation close',
      body: 'Le client du compte C-000123 a clos sa contestation sur l’opération D-00482.',
    });
  });

  it('tells the customer of the store’s reply, by the store’s name only', () => {
    const message = disputeStoreReplyMessage({
      ...dispute,
      message: 'Le cahier montre 50 000 F.',
    });

    expect(message).toEqual({
      title: 'Réponse à votre contestation',
      body: 'Réponse de Quincaillerie du Carrefour à votre contestation sur l’opération D-00482 : « Le cahier montre 50 000 F. ».',
    });
    // Project rule: money is never said to be "sécurisé" or "garanti".
    expect(message.body).not.toMatch(/sécuris|garanti/);
  });

  it('cuts a message over 200 characters in the notification', () => {
    expect(disputeExcerpt('x'.repeat(200))).toBe('x'.repeat(200));
    expect(disputeExcerpt('x'.repeat(201))).toBe(`${'x'.repeat(200)}…`);
    expect(disputeExcerpt(`${'a'.repeat(199)} ${'b'.repeat(50)}`)).toBe(
      `${'a'.repeat(199)}…`,
    );
  });

  it('never splits an emoji at the cut (F-18)', () => {
    // A surrogate pair left alone, with no partner on either side.
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    // 199 letters, then an emoji (2 UTF-16 units) across position 200.
    const straddling = `${'a'.repeat(199)}🙂🙂 la suite`;

    const cut = disputeExcerpt(straddling);

    expect(cut).toBe(`${'a'.repeat(199)}🙂…`);
    expect(cut).not.toMatch(loneSurrogate);
    // Exactly 200 emoji is 200 characters: nothing is cut.
    expect(disputeExcerpt('🙂'.repeat(200))).toBe('🙂'.repeat(200));
    expect(disputeExcerpt('🙂'.repeat(201))).toBe(`${'🙂'.repeat(200)}…`);
  });
});
