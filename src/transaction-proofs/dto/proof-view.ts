import { ApiProperty } from '@nestjs/swagger';

/** Who attached a proof, never by name: the customer does not see staff names. */
export const PROOF_UPLOADERS = ['STORE', 'CUSTOMER'] as const;

export class ProofView {
  @ApiProperty({
    description: 'Identifiant de la preuve',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({
    description: 'Date de l’ajout',
    example: '2026-10-31T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Ajoutée par la quincaillerie ou par le client',
    enum: PROOF_UPLOADERS,
    example: 'STORE',
  })
  uploadedBy: (typeof PROOF_UPLOADERS)[number];
}
