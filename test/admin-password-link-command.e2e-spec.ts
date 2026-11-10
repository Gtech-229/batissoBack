import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { printPasswordLink } from '../src/cli/password-link.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin, TEST_PASSWORD } from './utils/admins.js';
import { createTestApp } from './utils/app.js';
import { resetDatabase } from './utils/reset-database.js';

const EMAIL = 'super@batisso.test';

/** Runs the command and keeps what it writes. */
async function run(email: string | undefined) {
  const out = { log: vi.fn(), error: vi.fn() };
  const code = await printPasswordLink(email, out);
  return { code, log: out.log.mock.calls, error: out.error.mock.calls };
}

describe('Password link command (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const usePassword = (link: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/auth/reset-password')
      .send({ token: new URL(link).searchParams.get('token'), password });
  const login = (password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ email: EMAIL, password });

  it('prints only a reset link for a super admin, and the link works', async () => {
    await createAdmin(prisma, { email: EMAIL, role: 'SUPER_ADMIN' });

    const result = await run(' Super@Batisso.TEST ');

    expect(result.code).toBe(0);
    expect(result.error).toEqual([]);
    expect(result.log).toHaveLength(1);
    const [[link]] = result.log as [[string]];
    expect(link).toMatch(
      /^http:\/\/localhost:5173\/password\?mode=reset&token=[\w-]{43}$/,
    );

    await usePassword(link, 'Nouveau#2026').expect(204);
    await login(TEST_PASSWORD).expect(401);
    await login('Nouveau#2026').expect(200);
  });

  it('prints a set link for a super admin without a password', async () => {
    await createAdmin(prisma, {
      email: EMAIL,
      role: 'SUPER_ADMIN',
      passwordHash: null,
    });

    const { code, log } = await run(EMAIL);

    expect(code).toBe(0);
    expect(String(log[0][0])).toContain('mode=set');
  });

  it('retires the previous link, like a new email would', async () => {
    await createAdmin(prisma, { email: EMAIL, role: 'SUPER_ADMIN' });
    const first = String((await run(EMAIL)).log[0][0]);
    const second = String((await run(EMAIL)).log[0][0]);

    const refused = await usePassword(first, 'Nouveau#2026').expect(400);
    expect(refused.body.error).toBe('INVALID_PASSWORD_TOKEN');
    await usePassword(second, 'Nouveau#2026').expect(204);
  });

  it('waits for a link request on the same admin instead of deadlocking (F-78)', async () => {
    const admin = await createAdmin(prisma, {
      email: EMAIL,
      role: 'SUPER_ADMIN',
    });
    await run(EMAIL); // an unused link the next one must retire
    // A forgot-password request, held: it has locked the admin row and will
    // then retire the admin's unused links, as `request` does.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const requesting = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "admins" WHERE "id" = ${admin.id}::uuid FOR UPDATE`;
        await released;
        await tx.adminPasswordToken.updateMany({
          where: { adminId: admin.id, usedAt: null },
          data: { usedAt: new Date() },
        });
      },
      { timeout: 20_000 },
    );
    const command = run(EMAIL);

    // Release only once the command really waits on a lock.
    try {
      for (let i = 0; ; i++) {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: bigint }[]>`
          SELECT COUNT(*) AS "waiting" FROM pg_stat_activity
          WHERE "wait_event_type" = 'Lock' AND "datname" = current_database()`;
        if (waiting > 0n) {
          break;
        }
        if (i > 200) {
          throw new Error('The command never waited on the admin row');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      // Released even when the wait fails, so the held transaction ends here
      // and no rejection goes unobserved (F-79).
      release();
      await Promise.allSettled([requesting, command]);
    }
    await requesting;

    const { code, log } = await command;
    expect(code).toBe(0);
    await usePassword(String(log[0][0]), 'Nouveau#2026').expect(204);
  });

  it.each([
    ['an ADMIN', () => createAdmin(prisma, { email: EMAIL })],
    ['an unknown email', async () => {}],
  ])('refuses %s with exit code 1 and no link', async (_label, given) => {
    await given();

    const result = await run(EMAIL);

    expect(result.code).toBe(1);
    expect(result.log).toEqual([]);
    expect(result.error).toEqual([
      ['Aucun super administrateur actif n’a cet email.'],
    ]);
    expect(await prisma.adminPasswordToken.count()).toBe(0);
  });

  it('shows the usage without an email', async () => {
    const result = await run(undefined);

    expect(result.code).toBe(1);
    expect(result.error).toEqual([
      ['Usage : npm run admin:password-link -- <email>'],
    ]);
  });
});
