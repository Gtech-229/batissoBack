import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description:
      'Jeton de renouvellement reçu à la connexion (ou au dernier renouvellement)',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d.kq3V0d5m...',
  })
  @IsString({ message: 'Le jeton de renouvellement est requis' })
  @Length(1, 200, { message: 'Le jeton de renouvellement est invalide' })
  refreshToken: string;
}
