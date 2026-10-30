import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { IsPin } from '../pin.js';
import { PIN_FORMAT_MESSAGE } from './login.dto.js';

export class ChangePinDto {
  // Format only, not @IsPin: the strength rule applies when a PIN is chosen.
  @ApiProperty({ description: 'Code PIN actuel', example: '482915' })
  @IsString({ message: PIN_FORMAT_MESSAGE })
  @Matches(/^[0-9]{6}$/, { message: PIN_FORMAT_MESSAGE })
  currentPin: string;

  @ApiProperty({
    description:
      'Nouveau code PIN (6 chiffres, sans chiffres tous identiques ni suite)',
    example: '730164',
  })
  @IsPin()
  newPin: string;
}
