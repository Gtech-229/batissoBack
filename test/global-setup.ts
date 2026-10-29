import { execSync } from 'node:child_process';
import { e2eDatabaseRefusal } from './utils/database-guard.js';

/**
 * Runs once before the e2e suite: brings batisso_test up to the latest migration.
 * DATABASE_URL comes from .env.test, loaded in vitest.config.e2e.ts. The guard
 * refuses any other database without ever printing a credential (F-10).
 */
export default function setup(): void {
  const refusal = e2eDatabaseRefusal(process.env.DATABASE_URL);
  if (refusal) {
    throw new Error(refusal);
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
