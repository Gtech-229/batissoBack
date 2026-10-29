import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';

const MESSAGE_RULE = 'Le message doit contenir 1 à 1000 caractères';

/** A message of a dispute's thread: plain text, never interpreted. */
export class DisputeMessageDto {
  @ApiProperty({
    description: 'Le message, en texte simple (1 à 1000 caractères)',
    example: 'Je n’ai versé que 500 F ce jour-là, pas 5 000 F.',
  })
  @Trim()
  @IsString({ message: MESSAGE_RULE })
  @Length(1, 1000, { message: MESSAGE_RULE })
  message: string;
}
