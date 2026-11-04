import { randomBytes } from 'node:crypto';
import type { EmailMessage } from '../email/email-sender.js';
import { PasswordTokenMode } from '../generated/prisma/client.js';

/** The mode in the URL and the query string: `set` or `reset`. */
export type PasswordLinkMode = 'set' | 'reset';

export const PASSWORD_LINK_MODES: PasswordLinkMode[] = ['set', 'reset'];

export function toTokenMode(mode: PasswordLinkMode): PasswordTokenMode {
  return mode === 'set' ? PasswordTokenMode.SET : PasswordTokenMode.RESET;
}

/** 32 random bytes, base64url: what the link carries; only its hash is stored. */
export function newPasswordToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The web admin page that takes the token and the new password. */
export function passwordLink(
  adminWebUrl: string,
  mode: PasswordLinkMode,
  token: string,
): string {
  const query = new URLSearchParams({ mode, token });
  return `${adminWebUrl}/password?${query.toString()}`;
}

/** The French email carrying the link. */
export function passwordLinkEmail(
  to: string,
  firstName: string,
  mode: PasswordLinkMode,
  link: string,
): EmailMessage {
  const action =
    mode === 'set'
      ? 'Pour choisir le mot de passe de votre compte administrateur Bâtisso, ouvrez ce lien :'
      : 'Pour choisir un nouveau mot de passe pour votre compte administrateur Bâtisso, ouvrez ce lien :';
  const keep =
    mode === 'reset'
      ? '\nVotre mot de passe actuel reste valable tant que vous n’utilisez pas ce lien.'
      : '';
  return {
    to,
    subject:
      mode === 'set'
        ? 'Bâtisso : choisissez votre mot de passe'
        : 'Bâtisso : réinitialisez votre mot de passe',
    text: [
      `Bonjour ${firstName},`,
      '',
      action,
      link,
      '',
      `Ce lien est valable 3 jours et ne sert qu’une fois.${keep}`,
      'Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.',
    ].join('\n'),
  };
}
