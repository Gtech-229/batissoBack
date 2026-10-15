import { escapeLike } from './like.js';

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('t_s')).toBe('t\\_s');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeLike('Fanta Keita')).toBe('Fanta Keita');
  });
});
