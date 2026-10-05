import { ApiProperty } from '@nestjs/swagger';
import { AdminRole, type Admin } from '../../generated/prisma/client.js';

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
      'Vrai tant que l’administrateur doit changer son mot de passe avant d’accéder au reste de l’API',
    example: false,
  })
  mustChangePassword: boolean;
}

/** Keeps only public fields: never the password hash or lockout state. */
export function toAdminProfile(admin: Admin): AdminProfile {
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
    role: admin.role,
    mustChangePassword: admin.mustChangePassword,
  };
}
