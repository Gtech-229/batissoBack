import { ApiProperty } from '@nestjs/swagger';

/** What the manager sees: the person's name, never their phone, keys, or tokens. */
export class AccessResetView {
  @ApiProperty({ description: 'Prénom', example: 'Fanta' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Coulibaly' })
  lastName: string;

  @ApiProperty({
    description: 'Date de la réinitialisation',
    example: '2026-10-30T10:00:00.000Z',
  })
  resetAt: Date;

  @ApiProperty({ description: 'Sessions fermées', example: 1 })
  sessionsRevoked: number;

  @ApiProperty({
    description: 'Appareils qui ne sont plus reconnus',
    example: 1,
  })
  devicesUntrusted: number;
}
