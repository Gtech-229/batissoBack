import {
  confirmationCodeMessage,
  newConfirmationCode,
} from './confirmation-code.js';

describe('newConfirmationCode', () => {
  it('gives 6 digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(newConfirmationCode()).toMatch(/^[0-9]{6}$/);
    }
  });
});

describe('confirmationCodeMessage', () => {
  it('names the order, the amount, and the store', () => {
    expect(
      confirmationCodeMessage({
        code: '048213',
        reference: 'B-00042',
        total: 250000n,
        currencyCode: 'XOF',
        storeName: 'Quincaillerie du Carrefour',
      }),
    ).toBe(
      'Bâtisso : code 048213 pour confirmer le bon B-00042 de 250 000 XOF chez Quincaillerie du Carrefour. Valable 10 minutes. Donnez-le au vendeur seulement pour confirmer cet achat.',
    );
  });
});
