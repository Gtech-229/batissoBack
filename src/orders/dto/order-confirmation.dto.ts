import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

const PIN_FORMAT_MESSAGE = 'Le code PIN doit contenir 6 chiffres';

/** The customer confirms an order with their PIN, in the app. */
export class ConfirmByPinDto {
  // Format only, as at sign-in: the strength rule applies when a PIN is chosen.
  @ApiProperty({
    description: 'Votre code PIN à 6 chiffres',
    example: '482915',
  })
  @IsString({ message: PIN_FORMAT_MESSAGE })
  @Matches(/^[0-9]{6}$/, { message: PIN_FORMAT_MESSAGE })
  pin: string;
}

const CODE_FORMAT_MESSAGE = 'Le code doit contenir 6 chiffres';

/** Staff enter the code the customer received by SMS and read out. */
export class ConfirmByCodeDto {
  @ApiProperty({
    description: 'Le code à 6 chiffres reçu par le client',
    example: '048213',
  })
  @IsString({ message: CODE_FORMAT_MESSAGE })
  @Matches(/^[0-9]{6}$/, { message: CODE_FORMAT_MESSAGE })
  code: string;
}

export class ConfirmationCodeSent {
  @ApiProperty({
    description: 'Le code envoyé au client expire à cette date (10 minutes)',
    example: '2026-10-27T10:10:00.000Z',
  })
  expiresAt: Date;
}
