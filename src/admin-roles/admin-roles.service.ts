import { Injectable } from '@nestjs/common';
import {
  isPermission,
  PERMISSION_NAMES,
  PERMISSIONS,
} from '../admin-auth/permissions.js';
import { Prisma, type AccessRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  roleInUse,
  roleNameTaken,
  roleNotFound,
} from './admin-roles.errors.js';
import type {
  CreateRoleDto,
  PermissionView,
  RoleView,
  UpdateRoleDto,
} from './dto/role.dto.js';

type RoleWithCount = AccessRole & { _count: { admins: number } };

const WITH_COUNT = { _count: { select: { admins: true } } } as const;

function toRoleView(role: RoleWithCount): RoleView {
  return {
    id: role.id,
    name: role.name,
    // Only names the code still knows: a renamed permission never leaks out.
    permissions: role.permissions.filter(isPermission),
    adminCount: role._count.admins,
  };
}

/** P2002 on `name`: caught rather than checked first, so a race cannot pass. */
function asNameTaken(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw roleNameTaken();
  }
  throw error;
}

/** The roles the super admin gives to admins (feature 20). */
@Injectable()
export class AdminRolesService {
  constructor(private readonly prisma: PrismaService) {}

  permissions(): PermissionView[] {
    return PERMISSION_NAMES.map((name) => ({
      name,
      label: PERMISSIONS[name],
    }));
  }

  async list(): Promise<RoleView[]> {
    const roles = await this.prisma.accessRole.findMany({
      include: WITH_COUNT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return roles.map(toRoleView);
  }

  async create(data: CreateRoleDto): Promise<RoleView> {
    try {
      const role = await this.prisma.accessRole.create({
        data: { name: data.name, permissions: data.permissions },
        include: WITH_COUNT,
      });
      return toRoleView(role);
    } catch (error) {
      return asNameTaken(error);
    }
  }

  /** A change counts from each admin's next request: the guard reads it then. */
  async update(id: string, data: UpdateRoleDto): Promise<RoleView> {
    try {
      const role = await this.prisma.accessRole.update({
        where: { id },
        data: { name: data.name, permissions: data.permissions },
        include: WITH_COUNT,
      });
      return toRoleView(role);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw roleNotFound();
      }
      return asNameTaken(error);
    }
  }

  /**
   * Deletes a role no admin holds. The foreign key restricts the delete, so an
   * admin given the role in parallel makes it fail rather than leave them none.
   */
  async remove(id: string): Promise<void> {
    const role = await this.prisma.accessRole.findUnique({
      where: { id },
      include: WITH_COUNT,
    });
    if (!role) {
      throw roleNotFound();
    }
    if (role._count.admins > 0) {
      throw roleInUse();
    }
    try {
      await this.prisma.accessRole.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw roleInUse();
        }
        if (error.code === 'P2025') {
          throw roleNotFound();
        }
      }
      throw error;
    }
  }
}
