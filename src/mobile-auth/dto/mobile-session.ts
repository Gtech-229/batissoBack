import { ApiProperty } from '@nestjs/swagger';
import type { User } from '../../generated/prisma/client.js';

export class MobileUserProfile {
  @ApiProperty({
    description: 'Identifiant de l’utilisateur',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({ description: 'Prénom', example: 'Awa' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Diallo' })
  lastName: string;

  @ApiProperty({ description: 'Téléphone (E.164)', example: '+22376000000' })
  phone: string;
}

export class MobileSession {
  @ApiProperty({
    description:
      'Jeton d’accès, à envoyer dans l’en-tête `Authorization: Bearer <jeton>`',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  accessToken: string;

  @ApiProperty({
    description:
      'Jeton de renouvellement (30 jours), à garder dans le stockage sécurisé et à envoyer à `POST /auth/refresh`. Il change à chaque renouvellement.',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d.kq3V0d5m...',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'Durée de validité du jeton d’accès, en secondes',
    example: 900,
  })
  expiresIn: number;

  @ApiProperty({ type: MobileUserProfile })
  user: MobileUserProfile;
}

/** Keeps only public fields: never the PIN hash or the lockout state. */
export function toMobileUserProfile(user: User): MobileUserProfile {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
  };
}
