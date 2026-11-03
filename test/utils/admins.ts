import {
  DEFAULT_ROLE,
  type Permission,
} from '../../src/admin-auth/permissions.js';
import { hashPassword } from '../../src/admin-auth/secrets.js';
import type { Admin, AdminRole } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export const TEST_PASSWORD = 'Batisso#2026';

let hashed: Promise<string> | undefined;

/**
 * Inserts an admin directly. An ADMIN gets the `Administrateur` role (today's
 * access) unless `permissions` gives another set, or `roleId: null` none.
 */
export async function createAdmin(
  prisma: PrismaService,
  overrides: Partial<Omit<Admin, 'id'>> & {
    role?: AdminRole;
    permissions?: Permission[];
  } = {},
): Promise<Admin> {
  hashed ??= hashPassword(TEST_PASSWORD);
  const { permissions, ...fields } = overrides;
  const role = fields.role ?? 'ADMIN';
  let roleId: string | null | undefined = fields.roleId;
  if (role === 'ADMIN' && roleId === undefined) {
    roleId = permissions
      ? (
          await prisma.accessRole.create({
            data: {
              name: `Rôle ${Math.random().toString(36).slice(2, 10)}`,
              permissions,
            },
          })
        ).id
      : (
          await prisma.accessRole.upsert({
            where: { name: DEFAULT_ROLE.name },
            create: DEFAULT_ROLE,
            update: {},
          })
        ).id;
  }
  return prisma.admin.create({
    data: {
      email: `admin-${Math.random().toString(36).slice(2, 10)}@batisso.test`,
      firstName: 'Awa',
      lastName: 'Diallo',
      passwordHash: await hashed,
      mustChangePassword: false,
      ...fields,
      role,
      roleId: role === 'ADMIN' ? roleId : null,
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
