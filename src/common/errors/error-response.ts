import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidationErrorDetail {
  @ApiProperty({
    description:
      'Chemin du champ en erreur (notation pointée pour les objets imbriqués)',
    example: 'phone',
  })
  field: string;

  @ApiProperty({
    description: 'Messages expliquant pourquoi la valeur est refusée',
    example: ['Le numéro de téléphone est requis'],
    type: [String],
  })
  errors: string[];
}

/** Body of every non-2xx response. */
export class ErrorResponse {
  @ApiProperty({ description: 'Code de statut HTTP', example: 400 })
  statusCode: number;

  @ApiProperty({
    description: 'Code d’erreur stable, utilisable par les applications',
    example: 'BAD_REQUEST',
  })
  error: string;

  @ApiProperty({
    description: 'Message en français, affichable à l’utilisateur',
    example: 'Données invalides',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Détail des champs refusés (erreurs de validation uniquement)',
    type: [ValidationErrorDetail],
  })
  details?: ValidationErrorDetail[];

  @ApiProperty({
    description: 'Chemin de la requête',
    example: '/api/v1/health',
  })
  path: string;

  @ApiProperty({
    description: 'Date et heure du serveur (ISO 8601, UTC)',
    example: '2026-10-03T12:00:00.000Z',
  })
  timestamp: string;
}
