import { execSync } from 'node:child_process';

/**
 * Runs once before the e2e suite: brings batisso_test up to the latest migration.
 * DATABASE_URL comes from .env.test, loaded in vitest.config.e2e.ts.
 */
export default function setup(): void {
  if (!process.env.DATABASE_URL?.includes('batisso_test')) {
    throw new Error(
      `E2E tests must run against batisso_test, got DATABASE_URL=${process.env.DATABASE_URL ?? '(unset)'}`,
    );
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
