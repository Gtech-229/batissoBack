import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ResetAccessDto {
  @ApiPropertyOptional({
    description:
      'Efface aussi les questions de sécurité, si la personne a oublié ses réponses et que son identité a été vérifiée. Sans cela, elle devra y répondre pour choisir un nouveau code PIN.',
    example: true,
  })
  @IsOptional()
  @IsBoolean({
    message: 'Le champ clearSecurityQuestions doit être vrai ou faux',
  })
  clearSecurityQuestions?: boolean;
}
