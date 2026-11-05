import { ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { ScanQrCodeDto } from '../../qr-codes/dto/qr-code.dto.js';
import { OpenAccountDto } from './open-account.dto.js';

/**
 * Joining a store from the app (21c): the scanned code, the acceptance of the
 * store's terms, and an optional beneficiary with the counter form's rules.
 * The mapped types keep the validators of the fields they copy.
 */
export class JoinStoreDto extends IntersectionType(
  ScanQrCodeDto,
  PickType(OpenAccountDto, ['beneficiary'] as const),
) {
  @ApiProperty({
    description:
      'Vous acceptez les conditions de la quincaillerie montrées dans l’application ; doit valoir `true`',
    example: true,
  })
  @Equals(true, {
    message: 'Vous devez accepter les conditions de la quincaillerie',
  })
  termsAccepted: true;
}
