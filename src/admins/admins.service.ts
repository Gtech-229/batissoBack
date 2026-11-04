import { Injectable } from '@nestjs/common';
import {
  roleNotFound,
  superAdminHasNoRole,
} from '../admin-roles/admin-roles.errors.js';
import { AdminRole, Prisma, type Admin } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  adminNotFound,
  emailAlreadyUsed,
  protectedAdmin,
} from './admins.errors.js';
import { toAdminSummary, type AdminSummary } from './dto/admin-summary.js';
import type { CreateAdminDto } from './dto/create-admin.dto.js';
import type { UpdateAdminDto } from './dto/update-admin.dto.js';

@Injectable()
export class AdminsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * New admins are always ADMIN, with no password: they set their own from a
   * link they request (`forgot-password?mode=set`). No email is sent here.
   */
  async create(
    data: CreateAdminDto,
    createdById: string,
  ): Promise<AdminSummary> {
    try {
      const admin = await this.prisma.admin.create({
        data: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: AdminRole.ADMIN,
          roleId: data.roleId,
          createdById,
        },
      });
      return toAdminSummary(admin);
    } catch (error) {
      // P2002: unique constraint (the email). Caught here rather than checked
      // beforehand, so two simultaneous creations cannot both pass.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw emailAlreadyUsed();
      }
      // P2003: the foreign key, so the role does not exist (or was just deleted).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw roleNotFound();
      }
      throw error;
    }
  }

  async list(): Promise<AdminSummary[]> {
    const admins = await this.prisma.admin.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return admins.map(toAdminSummary);
  }

  /**
   * Gives an ADMIN another role. It counts from their next request; their
   * sessions stay open. The super admin has none to give.
   */
  async assignRole(id: string, roleId: string): Promise<AdminSummary> {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw adminNotFound();
    }
    if (admin.role === AdminRole.SUPER_ADMIN) {
      throw superAdminHasNoRole();
    }
    try {
      const updated = await this.prisma.admin.update({
        where: { id },
        data: { roleId },
      });
      return toAdminSummary(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw roleNotFound();
      }
      throw error;
    }
  }

  /**
   * Corrects an ADMIN's email or names, for example a mistyped email. A new
   * email retires their unused password links: a link sent to the wrong
   * address must not work; the admin asks for another one.
   */
  async update(
    id: string,
    data: UpdateAdminDto,
    currentAdminId: string,
  ): Promise<AdminSummary> {
    const current = await this.findManageable(id, currentAdminId);
    const emailChanged =
      data.email !== undefined && data.email !== current.email;
    try {
      const admin = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.admin.update({
          where: { id },
          data: {
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
          },
        });
        if (emailChanged) {
          await tx.adminPasswordToken.updateMany({
            where: { adminId: id, usedAt: null },
            data: { usedAt: new Date() },
          });
        }
        return updated;
      });
      return toAdminSummary(admin);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw emailAlreadyUsed();
      }
      throw error;
    }
  }

  /** Blocks login and signs the admin out everywhere, immediately. */
  async deactivate(id: string, currentAdminId: string): Promise<AdminSummary> {
    await this.findManageable(id, currentAdminId);
    const [admin] = await this.prisma.$transaction([
      this.prisma.admin.update({ where: { id }, data: { isActive: false } }),
      this.prisma.adminSession.updateMany({
        where: { adminId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return toAdminSummary(admin);
  }

  async activate(id: string, currentAdminId: string): Promise<AdminSummary> {
    await this.findManageable(id, currentAdminId);
    const admin = await this.prisma.admin.update({
      where: { id },
      data: { isActive: true },
    });
    return toAdminSummary(admin);
  }

  private async findManageable(
    id: string,
    currentAdminId: string,
  ): Promise<Admin> {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw adminNotFound();
    }
    if (admin.id === currentAdminId || admin.role === AdminRole.SUPER_ADMIN) {
      throw protectedAdmin();
    }
    return admin;
  }
}
