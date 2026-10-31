import {
  ApiProperty,
  IntersectionType,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import {
  OfferedQuestion,
  SecurityAnswersDto,
} from '../../security-questions/dto/security-answers.dto.js';
import { IsPin } from '../pin.js';
import { SetPinDto } from './set-pin.dto.js';

export class RecoveryQuestionsDto extends PickType(SetPinDto, [
  'verificationToken',
] as const) {}

export class RecoveryQuestionsResponse {
  @ApiProperty({
    description: 'Les questions de sécurité choisies par l’utilisateur',
    type: [OfferedQuestion],
  })
  questions: OfferedQuestion[];
}

export class RecoverAccessDto extends IntersectionType(
  SecurityAnswersDto,
  OmitType(SetPinDto, ['pin'] as const),
) {
  @ApiProperty({
    description:
      'Nouveau code PIN (6 chiffres, sans chiffres tous identiques ni suite)',
    example: '730164',
  })
  @IsPin()
  newPin: string;
}
