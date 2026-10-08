import { ApiProperty } from '@nestjs/swagger';

export const CODE_REQUESTED_MESSAGE =
  'Si ce numéro est enregistré, un code vient de lui être envoyé par SMS.';

export class CodeRequestedResponse {
  @ApiProperty({
    description:
      'Toujours le même message, que le numéro soit connu ou non, pour ne pas révéler les comptes existants',
    example: CODE_REQUESTED_MESSAGE,
  })
  message: string;
}

export class VerificationResponse {
  @ApiProperty({
    description:
      'Jeton à usage unique, lié à ce numéro et à cet appareil, à envoyer à `POST /auth/pin`',
    example: 'kq3V0d5m3n2Y...',
  })
  verificationToken: string;

  @ApiProperty({
    description:
      '`false` : première connexion, l’utilisateur choisit son PIN ; `true` : il saisit son PIN actuel',
    example: false,
  })
  pinSet: boolean;

  @ApiProperty({
    description: 'Durée de validité du jeton, en secondes',
    example: 600,
  })
  expiresIn: number;
}
