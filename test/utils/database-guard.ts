/** The only database the e2e suite may touch: it truncates every table. */
export const E2E_DATABASE = 'batisso_test';

/**
 * The one refusal message: nothing in it comes from the URL, so it can never
 * carry a user, a password, or a host, whatever the URL's shape (F-10).
 */
export const E2E_DATABASE_REFUSAL = `E2E tests must run against ${E2E_DATABASE} (check DATABASE_URL in .env.test)`;

/**
 * Why the e2e suite must not run against `url`, or null when it may. The
 * database name parsed from the URL must be exactly `batisso_test`: the text
 * appearing in the user, the password, or the query does not count.
 */
export function e2eDatabaseRefusal(url: string | undefined): string | null {
  try {
    const name = new URL(url ?? '').pathname.replace(/^\//, '');
    return name === E2E_DATABASE ? null : E2E_DATABASE_REFUSAL;
  } catch {
    return E2E_DATABASE_REFUSAL;
  }
}
