import { ApiProperty } from '@nestjs/swagger';
import {
  StoreMemberRole,
  type StoreMember,
  type User,
} from '../../generated/prisma/client.js';

export class StoreMemberView {
  @ApiProperty({
    description: 'Identifiant de l’utilisateur',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  userId: string;

  @ApiProperty({ description: 'Prénom', example: 'Moussa' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Traoré' })
  lastName: string;

  @ApiProperty({ description: 'Téléphone (E.164)', example: '+22376112233' })
  phone: string;

  @ApiProperty({
    description: 'Rôle dans cette quincaillerie',
    enum: StoreMemberRole,
    example: StoreMemberRole.SELLER,
  })
  role: StoreMemberRole;

  @ApiProperty({
    description: '`false` : vendeur désactivé (peut être réactivé)',
    example: true,
  })
  active: boolean;

  @ApiProperty({
    description: 'Date d’entrée dans l’équipe',
    example: '2026-10-14T09:00:00.000Z',
  })
  since: Date;
}

/** Public fields only: never the PIN hash or the lockout state. */
export function toStoreMemberView(
  member: StoreMember & { user: User },
): StoreMemberView {
  return {
    userId: member.userId,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    phone: member.user.phone,
    role: member.role,
    active: member.active,
    since: member.createdAt,
  };
}
