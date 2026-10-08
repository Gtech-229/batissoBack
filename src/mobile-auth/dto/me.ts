import { ApiProperty } from '@nestjs/swagger';
import { StoreMemberRole } from '../../generated/prisma/client.js';
import { MobileUserProfile } from './mobile-session.js';

export class Membership {
  @ApiProperty({
    description: 'Identifiant de la quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  storeId: string;

  @ApiProperty({
    description: 'Nom de la quincaillerie',
    example: 'Quincaillerie du Carrefour',
  })
  storeName: string;

  @ApiProperty({
    description: 'Rôle dans cette quincaillerie',
    enum: StoreMemberRole,
    example: StoreMemberRole.MANAGER,
  })
  role: StoreMemberRole;
}

export class MeResponse extends MobileUserProfile {
  @ApiProperty({
    description:
      'Quincailleries où l’utilisateur travaille (rattachements actifs seulement)',
    type: [Membership],
  })
  memberships: Membership[];
}
