import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PIN_FORMAT_MESSAGE } from '../../mobile-auth/dto/login.dto.js';
import { IsSecurityAnswer } from '../normalize-answer.js';
import {
  SECURITY_QUESTION_MAX,
  SECURITY_QUESTION_MIN,
} from '../security-questions.constants.js';

const ANSWER_COUNT_MESSAGE = `Il faut de ${SECURITY_QUESTION_MIN} à ${SECURITY_QUESTION_MAX} réponses`;

export class SecurityAnswerDto {
  @ApiProperty({
    description: 'Identifiant de la question',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @IsUUID(undefined, { message: 'Identifiant de question invalide' })
  questionId: string;

  @ApiProperty({
    description:
      'La réponse (2 à 100 caractères). Majuscules, accents et espaces en trop ne comptent pas.',
    example: 'École de Mandé',
  })
  @IsSecurityAnswer()
  answer: string;
}

/** The answers of a user: the same shape to set them and to recover. */
export class SecurityAnswersDto {
  @ApiProperty({
    description: 'Une réponse par question (3 à 5)',
    type: [SecurityAnswerDto],
    minItems: SECURITY_QUESTION_MIN,
    maxItems: SECURITY_QUESTION_MAX,
  })
  @IsArray({ message: ANSWER_COUNT_MESSAGE })
  @ArrayMinSize(SECURITY_QUESTION_MIN, { message: ANSWER_COUNT_MESSAGE })
  @ArrayMaxSize(SECURITY_QUESTION_MAX, { message: ANSWER_COUNT_MESSAGE })
  @ValidateNested({ each: true })
  @Type(() => SecurityAnswerDto)
  answers: SecurityAnswerDto[];
}

export class SetSecurityAnswersDto extends SecurityAnswersDto {
  // Format only, not @IsPin: the strength rule applies when a PIN is chosen.
  @ApiProperty({ description: 'Code PIN actuel', example: '482915' })
  @IsString({ message: PIN_FORMAT_MESSAGE })
  @Matches(/^[0-9]{6}$/, { message: PIN_FORMAT_MESSAGE })
  currentPin: string;
}

export class OfferedQuestion {
  @ApiProperty({
    description: 'Identifiant de la question',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({
    description: 'Texte de la question',
    example: 'Quel est le nom de votre école primaire ?',
  })
  text: string;
}

export class MySecurityQuestions {
  @ApiProperty({ description: 'Mes questions sont définies', example: true })
  configured: boolean;

  @ApiProperty({
    description: 'Mes questions, même désactivées depuis. Jamais les réponses.',
    type: [OfferedQuestion],
  })
  chosen: OfferedQuestion[];

  @ApiProperty({
    description: 'Les questions proposées aujourd’hui',
    type: [OfferedQuestion],
  })
  available: OfferedQuestion[];
}
