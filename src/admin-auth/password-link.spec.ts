import {
  newPasswordToken,
  passwordLink,
  passwordLinkEmail,
} from './password-link.js';

describe('password links', () => {
  it('makes 32-byte base64url tokens, a new one each time', () => {
    const token = newPasswordToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newPasswordToken()).not.toBe(token);
  });

  it('builds the web admin link with the mode and the token', () => {
    const link = new URL(
      passwordLink('https://admin.batisso.com', 'set', 'a-b_c'),
    );

    expect(link.origin + link.pathname).toBe(
      'https://admin.batisso.com/password',
    );
    expect(link.searchParams.get('mode')).toBe('set');
    expect(link.searchParams.get('token')).toBe('a-b_c');
  });

  it('writes a French set email with the link and the 3 days', () => {
    const email = passwordLinkEmail(
      'awa@batisso.test',
      'Awa',
      'set',
      'http://x/password?mode=set&token=t',
    );

    expect(email.to).toBe('awa@batisso.test');
    expect(email.subject).toBe('Bâtisso : choisissez votre mot de passe');
    expect(email.text).toContain('Bonjour Awa,');
    expect(email.text).toContain('http://x/password?mode=set&token=t');
    expect(email.text).toContain('valable 3 jours');
    expect(email.text).not.toContain('actuel reste valable');
  });

  it('tells a reset email that the current password still works', () => {
    const email = passwordLinkEmail('a@b.test', 'Awa', 'reset', 'http://x');

    expect(email.subject).toBe('Bâtisso : réinitialisez votre mot de passe');
    expect(email.text).toContain('actuel reste valable');
  });
});
