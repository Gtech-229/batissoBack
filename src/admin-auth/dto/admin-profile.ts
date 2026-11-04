import { ApiProperty } from '@nestjs/swagger';
import { AdminRole, type Admin } from '../../generated/prisma/client.js';
import { PERMISSION_NAMES, type Permission } from '../permissions.js';

export class AdminProfile {
  @ApiProperty({
    description: 'Identifiant de l’administrateur',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({ description: 'Adresse email', example: 'awa@batisso.com' })
  email: string;

  @ApiProperty({ description: 'Prénom', example: 'Awa' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Diallo' })
  lastName: string;

  @ApiProperty({
    description: 'Rôle : SUPER_ADMIN gère les administrateurs, ADMIN non',
    enum: AdminRole,
    example: AdminRole.ADMIN,
  })
  role: AdminRole;

  @ApiProperty({
    description:
      'Faux tant que l’administrateur n’a pas choisi son mot de passe (lien demandé par `POST /admin/auth/forgot-password?mode=set`) : il ne peut pas encore se connecter',
    example: true,
  })
  hasPassword: boolean;
}

/** The signed-in admin's own profile, with what they may do now. */
export class MyAdminProfile extends AdminProfile {
  @ApiProperty({
    description:
      'Ce que l’administrateur peut faire maintenant : toutes les permissions pour le super administrateur',
    enum: PERMISSION_NAMES,
    isArray: true,
  })
  permissions: Permission[];
}

/** Keeps only public fields: never the password hash or lockout state. */
export function toAdminProfile(admin: Admin): AdminProfile {
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
    role: admin.role,
    hasPassword: admin.passwordHash !== null,
  };
}
