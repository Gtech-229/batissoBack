import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, Length, ValidateIf } from 'class-validator';

const TOKEN_MESSAGE =
  'Le jeton de notification doit être un texte de 1 à 4096 caractères, ou null';

export class PushTokenDto {
  @ApiProperty({
    description:
      'Jeton d’enregistrement push (FCM) de cette installation de l’application ; `null` désactive les notifications push sur ce téléphone',
    example: 'fGc3x...:APA91b...',
    nullable: true,
    type: String,
  })
  // Required, but `null` is a valid value (push off): validated only when not null.
  @IsDefined({ message: TOKEN_MESSAGE })
  @ValidateIf((_object, value) => value !== null)
  @IsString({ message: TOKEN_MESSAGE })
  @Length(1, 4096, { message: TOKEN_MESSAGE })
  token: string | null;
}
