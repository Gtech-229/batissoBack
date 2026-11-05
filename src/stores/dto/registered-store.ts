import { ApiProperty } from '@nestjs/swagger';
import {
  StoreStatus,
  SubscriptionPlan,
  type Country,
  type HardwareStore,
  type StoreSettings,
} from '../../generated/prisma/client.js';
import { StoreDocuments, toStoreDocuments } from './store-documents.js';
import {
  StoreCountry,
  StoreSettingsView,
  toStoreCountry,
  toStoreSettingsView,
} from './store-detail.js';

/** A store as its registrant (its manager) reads it after registering. */
export class RegisteredStore {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;

  @ApiProperty({ example: 'Rue 12, Hippodrome' })
  address: string;

  @ApiProperty({ example: 'Bamako' })
  city: string;

  @ApiProperty({ description: 'Format E.164', example: '+22320220000' })
  phone: string;

  @ApiProperty({ example: 'MA.BKO.2026.B.1234' })
  tradeRegister: string;

  @ApiProperty({
    description: 'PENDING jusqu’à la vérification par un administrateur',
    enum: StoreStatus,
    example: StoreStatus.PENDING,
  })
  status: StoreStatus;

  @ApiProperty({ type: StoreCountry })
  country: StoreCountry;

  @ApiProperty({ type: StoreSettingsView })
  settings: StoreSettingsView;

  @ApiProperty({
    description:
      'Formule demandée, montrée aux administrateurs (qui enregistrent l’abonnement)',
    enum: SubscriptionPlan,
    example: SubscriptionPlan.STANDARD,
  })
  requestedPlan: SubscriptionPlan;

  @ApiProperty({ type: StoreDocuments })
  documents: StoreDocuments;

  @ApiProperty({ example: '2026-11-05T09:00:00.000Z' })
  createdAt: string;
}

/** What to load for a RegisteredStore. */
export const REGISTERED_STORE_INCLUDE = {
  country: true,
  settings: true,
} as const;

export function toRegisteredStore(
  store: HardwareStore & { country: Country; settings: StoreSettings | null },
): RegisteredStore {
  if (!store.settings || !store.requestedPlan) {
    // Both are written with the store, in the same transaction.
    throw new Error(`Store ${store.id} is not a self-registered store`);
  }
  return {
    id: store.id,
    name: store.name,
    address: store.address,
    city: store.city,
    phone: store.phone,
    tradeRegister: store.tradeRegister,
    status: store.status,
    country: toStoreCountry(store.country),
    settings: toStoreSettingsView(store.settings),
    requestedPlan: store.requestedPlan,
    documents: toStoreDocuments(store),
    createdAt: store.createdAt.toISOString(),
  };
}
