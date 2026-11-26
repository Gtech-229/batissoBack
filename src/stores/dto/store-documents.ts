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

/**
 * Whether the registration documents are all there (26b): always for an
 * admin-registered store, which has none to send; for a self-registered one
 * (21b), both photos. Information only: verification never requires them.
 */
export function documentsComplete(
  store: Pick<
    HardwareStore,
    'registeredById' | 'managerIdPhotoPath' | 'tradeRegisterPhotoPath'
  >,
): boolean {
  return (
    store.registeredById === null ||
    (store.managerIdPhotoPath !== null && store.tradeRegisterPhotoPath !== null)
  );
}
