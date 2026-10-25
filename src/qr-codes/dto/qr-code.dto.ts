import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';
import { QR_CODE_PATTERN } from '../qr-code.js';

const CODE_MESSAGE = 'Code QR invalide';

/** A scanned QR code: the code it holds, matched exactly as given. */
export class ScanQrCodeDto {
  @ApiProperty({
    description: 'Le code lu dans le QR code',
    example: 'Xq3tL0b9vY2mK7pA4sD8fG1hJ6kZ5wR0',
  })
  @Trim()
  @IsString({ message: CODE_MESSAGE })
  @Matches(QR_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;
}

export class QrCodeView {
  @ApiProperty({
    description:
      'Code à afficher en QR code : aléatoire et opaque (aucune donnée dedans), valable jusqu’à ce qu’il soit régénéré',
    example: 'Xq3tL0b9vY2mK7pA4sD8fG1hJ6kZ5wR0',
  })
  code: string;
}
