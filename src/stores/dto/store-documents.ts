import { ApiProperty } from '@nestjs/swagger';
import type { HardwareStore } from '../../generated/prisma/client.js';

/** Which of the two registration photos (21b) are on the server. */
export class StoreDocuments {
  @ApiProperty({
    description: 'Photo de la pièce d’identité du gérant envoyée',
    example: false,
  })
  identity: boolean;

  @ApiProperty({
    description: 'Photo du registre du commerce envoyée',
    example: false,
  })
  tradeRegister: boolean;
}

export function toStoreDocuments(
  store: Pick<HardwareStore, 'managerIdPhotoPath' | 'tradeRegisterPhotoPath'>,
): StoreDocuments {
  // Presence only: a file name never leaves the server.
  return {
    identity: store.managerIdPhotoPath !== null,
    tradeRegister: store.tradeRegisterPhotoPath !== null,
  };
}
