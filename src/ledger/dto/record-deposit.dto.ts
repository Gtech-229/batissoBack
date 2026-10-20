import { ApiProperty } from '@nestjs/swagger';
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
}
