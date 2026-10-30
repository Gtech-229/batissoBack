import { normalizeAnswer } from './normalize-answer.js';

describe('normalizeAnswer', () => {
  it.each([
    ['Bamako', 'bamako'],
    ['  bamako  ', 'bamako'],
    ['École', 'ecole'],
    ['Hamdallaye   ACI\t2000', 'hamdallaye aci 2000'],
    ['Sévaré', 'sevare'],
    ['Çà', 'ca'],
  ])('reads %j as %j', (answer, normalized) => {
    expect(normalizeAnswer(answer)).toBe(normalized);
  });

  it('gives one form to composed and decomposed accents', () => {
    const accented = 'Mandé';

    expect(normalizeAnswer(accented.normalize('NFD'))).toBe(
      normalizeAnswer(accented.normalize('NFC')),
    );
  });

  it('keeps different answers different', () => {
    expect(normalizeAnswer('Mandé')).not.toBe(normalizeAnswer('Mondé'));
  });
});
