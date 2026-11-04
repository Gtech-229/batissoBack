import { NestFactory } from '@nestjs/core';
import { pathToFileURL } from 'node:url';
import { PasswordLinksService } from '../admin-auth/password-links.service.js';
import { AppModule } from '../app.module.js';

/**
 * Prints a password link for a super admin who cannot receive email, on the
 * server only: `npm run build`, then `npm run admin:password-link -- <email>`.
 * Prints the link and nothing else; exit code 1 for anyone but an active
 * super admin. The link is a secret: do not paste it anywhere public.
 */
export async function printPasswordLink(
  email: string | undefined,
  out: Pick<Console, 'log' | 'error'>,
): Promise<number> {
  if (!email?.trim()) {
    out.error('Usage : npm run admin:password-link -- <email>');
    return 1;
  }
  // No HTTP server, and no Nest logs: the link is the whole output.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const link = await app
      .get(PasswordLinksService)
      .superAdminLink(email.trim().toLowerCase());
    if (!link) {
      out.error('Aucun super administrateur actif n’a cet email.');
      return 1;
    }
    out.log(link);
    return 0;
  } finally {
    await app.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await printPasswordLink(process.argv[2], console);
}
