import { ApiProperty } from '@nestjs/swagger';

export class HealthResponse {
  @ApiProperty({ description: 'État général de l’API', example: 'ok' })
  status: 'ok';

  @ApiProperty({
    description: 'État de la connexion à la base de données',
    example: 'up',
  })
  database: 'up';

  @ApiProperty({
    description: 'Date et heure du serveur (ISO 8601, UTC)',
    example: '2026-10-03T12:00:00.000Z',
  })
  timestamp: string;
}
