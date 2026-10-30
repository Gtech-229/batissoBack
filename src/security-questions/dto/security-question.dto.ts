import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';
import type { SecurityQuestion } from '../../generated/prisma/client.js';

export class CreateSecurityQuestionDto {
  @ApiProperty({
    description:
      'Texte de la question, en français. Il ne pourra plus changer : des utilisateurs y auront répondu.',
    example: 'Quel est le prénom de votre premier enseignant ?',
  })
  @Trim()
  @IsString({ message: 'Le texte de la question est requis' })
  @Length(5, 200, {
    message: 'Le texte de la question doit contenir 5 à 200 caractères',
  })
  text: string;
}

export class UpdateSecurityQuestionDto {
  @ApiProperty({
    description: 'Proposée ou non aux utilisateurs',
    example: false,
  })
  @IsBoolean({ message: 'Le champ active doit être vrai ou faux' })
  active: boolean;
}

export class SecurityQuestionView {
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

  @ApiProperty({ description: 'Proposée aux utilisateurs', example: true })
  active: boolean;

  @ApiProperty({
    description: 'Date de création',
    example: '2026-10-30T10:00:00.000Z',
  })
  createdAt: Date;
}

export function toSecurityQuestionView(
  question: SecurityQuestion,
): SecurityQuestionView {
  return {
    id: question.id,
    text: question.text,
    active: question.active,
    createdAt: question.createdAt,
  };
}
