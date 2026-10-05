import type { PrismaService } from '../../src/prisma/prisma.service.js';

/** Empties every application table so each test file starts from a clean database. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) {
    return;
  }
  const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  // Table names come from pg_tables, not from user input.
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
