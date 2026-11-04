import { ApiProperty } from '@nestjs/swagger';
import {
  AdminProfile,
  toAdminProfile,
} from '../../admin-auth/dto/admin-profile.js';
import type { Admin } from '../../generated/prisma/client.js';

/** An admin as the super admin sees it in the management list. */
export class AdminSummary extends AdminProfile {
  @ApiProperty({
    description: 'Faux si le compte est désactivé (connexion refusée)',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description:
      'Identifiant du rôle de l’administrateur ; null pour le super administrateur, qui a toutes les permissions',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
    nullable: true,
    type: String,
  })
  roleId: string | null;

  @ApiProperty({
    description: 'Date de création (ISO 8601, UTC)',
    example: '2026-10-05T12:00:00.000Z',
  })
  createdAt: string;
}

export function toAdminSummary(admin: Admin): AdminSummary {
  const profile = toAdminProfile(admin);
  return {
    id: profile.id,
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    role: profile.role,
    hasPassword: profile.hasPassword,
    isActive: admin.isActive,
    roleId: admin.roleId,
    createdAt: admin.createdAt.toISOString(),
  };
}
