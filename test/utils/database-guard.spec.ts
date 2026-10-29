import { E2E_DATABASE_REFUSAL, e2eDatabaseRefusal } from './database-guard.js';

// Fake credentials only: they must never come back in a refusal (F-10).
const SECRETS = ['not-a-real-secret', 'fakeuser', 'db.example.internal'];

/** Refused with the one fixed message, which carries nothing from the URL. */
const expectRefused = (url: string | undefined) => {
  const refusal = e2eDatabaseRefusal(url);
  expect(refusal).toBe(E2E_DATABASE_REFUSAL);
  for (const secret of SECRETS) {
    expect(refusal).not.toContain(secret);
  }
};

describe('e2eDatabaseRefusal', () => {
  it('accepts the test database', () => {
    expect(
      e2eDatabaseRefusal(
        'postgresql://fakeuser:not-a-real-secret@localhost:5433/batisso_test',
      ),
    ).toBeNull();
    expect(
      e2eDatabaseRefusal(
        'postgresql://fakeuser:not-a-real-secret@localhost:5433/batisso_test?schema=public',
      ),
    ).toBeNull();
  });

  it('refuses another database with the fixed message', () => {
    expect(E2E_DATABASE_REFUSAL).toBe(
      'E2E tests must run against batisso_test (check DATABASE_URL in .env.test)',
    );
    for (const url of [
      'postgresql://fakeuser:not-a-real-secret@db.example.internal:5432/batisso',
      'postgresql://fakeuser:not-a-real-secret@db.example.internal/batisso_test2',
      'postgresql://fakeuser:not-a-real-secret@db.example.internal/BATISSO_TEST',
      'postgresql://fakeuser:not-a-real-secret@db.example.internal/batisso_test/',
    ]) {
      expectRefused(url);
    }
  });

  it('refuses batisso_test anywhere but the database name', () => {
    for (const url of [
      'postgresql://batisso_test:not-a-real-secret@db.example.internal/batisso',
      'postgresql://fakeuser:batisso_test@db.example.internal/batisso',
      'postgresql://fakeuser:not-a-real-secret@db.example.internal/batisso?name=batisso_test',
    ]) {
      expectRefused(url);
    }
  });

  it('refuses a missing, empty, or unreadable URL', () => {
    for (const url of [
      undefined,
      '',
      'not a url',
      'postgresql://fakeuser@db.example.internal',
    ]) {
      expectRefused(url);
    }
  });

  it('never leaks a credential, whatever the URL’s shape', () => {
    for (const url of [
      // The shapes that reopened F-10: no "//", and a raw "/" read as a port.
      'postgresql:fakeuser:not-a-real-secret@db.example.internal/batisso',
      'postgresql://fakeuser:/not-a-real-secret@db.example.internal/batisso',
      // A raw "/" then "#" or "?" makes part of the password the "name".
      'postgresql://fakeuser:/not-a-real-secret#x@db.example.internal:5433/batisso',
      'postgresql://fakeuser:/not-a-real-secret?x@db.example.internal:5433/batisso',
      'postgresql://fakeuser:12/not-a-real-secret#x@db.example.internal/batisso',
      'postgresql://fakeuser:12/not-a-real-secret?x@db.example.internal/batisso',
      'postgresql://fakeuser:not-a-real-secret@db.example.internal/batisso%2Fx',
      'postgresql://fakeuser:not/a-real-secret@db.example.internal/batisso',
      'postgres://fakeuser:not-a-real-secret@db.example.internal:5432/',
    ]) {
      expectRefused(url);
    }
  });
});
