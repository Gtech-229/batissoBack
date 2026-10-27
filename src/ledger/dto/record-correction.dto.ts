import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { IsAmount } from '../../common/money.js';
import { Trim } from '../../common/validation/trim.js';

const REASON_MESSAGE =
  'Le motif de la correction doit contenir 1 à 500 caractères';

/** A manager's correction of a deposit (11a): an amount taken back, and why. */
export class RecordCorrectionDto {
  // What remains to correct on the deposit is checked in the service, under the lock.
  @ApiProperty({
    description:
      'Montant retiré du compte, en unités de la devise, en texte (entier positif, sans décimales) : au plus ce qui reste à corriger sur le dépôt',
    example: '4500',
  })
  @IsAmount()
  amount: string;

  @ApiProperty({
    description:
      'Pourquoi le dépôt est corrigé : visible par le client, dans son historique et dans le SMS',
    example: 'Erreur de saisie : 500 F versés, pas 5 000 F',
  })
  @Trim()
  @IsString({ message: REASON_MESSAGE })
  @Length(1, 500, { message: REASON_MESSAGE })
  reason: string;
}
