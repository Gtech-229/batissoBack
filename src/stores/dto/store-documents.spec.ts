import { documentsComplete } from './store-documents.js';

const SELF = 'user-1';

describe('documentsComplete', () => {
  it.each([
    ['an admin-registered store, no documents', null, null, null, true],
    ['a self-registered store, no documents', SELF, null, null, false],
    ['a self-registered store, the identity only', SELF, 'id.jpg', null, false],
    [
      'a self-registered store, the trade register only',
      SELF,
      null,
      'tr.jpg',
      false,
    ],
    ['a self-registered store, both documents', SELF, 'id.jpg', 'tr.jpg', true],
  ])('%s: %s', (_case, registeredById, identity, tradeRegister, expected) => {
    expect(
      documentsComplete({
        registeredById,
        managerIdPhotoPath: identity,
        tradeRegisterPhotoPath: tradeRegister,
      }),
    ).toBe(expected);
  });
});
