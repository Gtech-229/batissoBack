import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsAmount } from '../../common/money.js';

export class RecordDepositDto {
  // The store's minimum and maximum are checked in the service, under the lock.
  @ApiProperty({
    description:
      'Montant remis en espèces, en unités de la devise, en texte (entier positif, sans décimales)',
    example: '5000',
  })
  @IsAmount()
  amount: string;

  @ApiPropertyOptional({
    description:
      'Objectif du compte qui reçoit le dépôt (non fermé) ; sans lui, « Non affecté »',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Identifiant d’objectif invalide' })
  goalId?: string;
}
