import { hashPassword } from '../../src/admin-auth/secrets.js';
import type { Admin, AdminRole } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export const TEST_PASSWORD = 'Batisso#2026';

let hashed: Promise<string> | undefined;

/** Inserts an admin directly (there is no create API before step 6). */
export async function createAdmin(
  prisma: PrismaService,
  overrides: Partial<Omit<Admin, 'id'>> & { role?: AdminRole } = {},
): Promise<Admin> {
  hashed ??= hashPassword(TEST_PASSWORD);
  return prisma.admin.create({
    data: {
      email: `admin-${Math.random().toString(36).slice(2, 10)}@batisso.test`,
      firstName: 'Awa',
      lastName: 'Diallo',
      passwordHash: await hashed,
      role: 'ADMIN',
      mustChangePassword: false,
      ...overrides,
    },
  });
}

/** Returns the `name=value` pairs of the Set-Cookie headers, by cookie name. */
export function cookiesFrom(setCookie: string[] | string | undefined) {
  const headers = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  const byName = new Map<string, { pair: string; header: string }>();
  for (const header of headers) {
    const pair = header.split(';')[0];
    const name = pair.split('=')[0];
    byName.set(name, { pair, header });
  }
  return byName;
}
