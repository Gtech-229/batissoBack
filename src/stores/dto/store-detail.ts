import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import type {
  Country,
  HardwareStore,
  StoreMember,
  StoreSettings,
  Subscription,
  User,
} from '../../generated/prisma/client.js';
import { SubscriptionView } from '../../subscriptions/dto/subscription.dto.js';
import { toStoreSubscription } from '../../subscriptions/store-subscription.js';
import {
  SUBSCRIPTION_STATES,
  type SubscriptionState,
} from '../../subscriptions/subscription-status.js';
import {
  StoreStatus,
  SubscriptionPlan,
} from '../../generated/prisma/client.js';
import { StoreDocuments, toStoreDocuments } from './store-documents.js';

export class StoreCountry {
  @ApiProperty({ example: 'ML' })
  code: string;

  @ApiProperty({ example: 'Mali' })
  name: string;

  @ApiProperty({ example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ example: 'F CFA' })
  currencySymbol: string;

  @ApiProperty({
    description: 'Chiffres après la virgule pour afficher les montants',
    example: 0,
  })
  decimals: number;
}

/** Amounts are strings of the smallest currency unit (`"200000"`). */
export class StoreSettingsView {
  @ApiProperty({ example: '2000000' })
  maxBalance: string;

  @ApiProperty({ example: '200000' })
  validationThreshold: string;

  @ApiProperty({ example: '500' })
  minDeposit: string;

  @ApiProperty({ description: 'Toujours faux en V1', example: false })
  refundAllowed: boolean;

  @ApiProperty({ description: 'Toujours faux en V1', example: false })
  reservationEnabled: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  terms: string | null;

  @ApiProperty({
    description:
      'Jours après la confirmation du client au-delà desquels il peut demander l’annulation d’un bon non livré',
    example: 30,
  })
  deliveryDelayDays: number;
}

export class StoreManager {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  userId: string;

  @ApiProperty({ example: 'Awa' })
  firstName: string;

  @ApiProperty({ example: 'Diallo' })
  lastName: string;

  @ApiProperty({ example: '+22376000000' })
  phone: string;
}

export class StoreDetail {
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

  @ApiProperty({ enum: StoreStatus, example: StoreStatus.PENDING })
  status: StoreStatus;

  @ApiProperty({ type: String, nullable: true, example: null })
  verifiedAt: string | null;

  @ApiProperty({
    description: 'Motif de la dernière suspension ou fermeture',
    type: String,
    nullable: true,
    example: null,
  })
  statusReason: string | null;

  @ApiProperty({ type: StoreCountry })
  country: StoreCountry;

  @ApiProperty({ type: StoreSettingsView })
  settings: StoreSettingsView;

  @ApiProperty({ type: [StoreManager] })
  managers: StoreManager[];

  @ApiProperty({
    description:
      'Abonnement du jour (UTC) : ACTIVE (en cours), UPCOMING (aucun en cours, un à venir), EXPIRED (tous terminés) ou NONE (jamais abonnée)',
    enum: SUBSCRIPTION_STATES,
    example: 'ACTIVE',
  })
  subscriptionState: SubscriptionState;

  @ApiProperty({
    description: 'L’abonnement en cours, null si aucun',
    type: SubscriptionView,
    nullable: true,
  })
  currentSubscription: SubscriptionView | null;

  @ApiProperty({
    description:
      'Formule demandée à l’inscription depuis l’application, null pour une quincaillerie inscrite par un administrateur',
    enum: SubscriptionPlan,
    nullable: true,
    example: null,
  })
  requestedPlan: SubscriptionPlan | null;

  @ApiProperty({
    description:
      'Inscrite depuis l’application par son gérant : sa vérification exige les deux documents',
    example: false,
  })
  selfRegistered: boolean;

  @ApiProperty({ type: StoreDocuments })
  documents: StoreDocuments;

  @ApiProperty({ example: '2026-10-06T09:00:00.000Z' })
  createdAt: string;
}

/** The Prisma shape loaded by STORE_DETAIL_INCLUDE. */
export type StoreWithDetail = HardwareStore & {
  country: Country;
  settings: StoreSettings | null;
  members: (StoreMember & { user: User })[];
  subscriptions: Subscription[];
};

/** What to load for a store detail: country, settings, active managers. */
export const STORE_DETAIL_INCLUDE = {
  country: true,
  settings: true,
  members: {
    where: { role: 'MANAGER', active: true },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  },
  // A store has few: its state and current one are computed from all of them.
  subscriptions: true,
} as const;

export function toStoreDetail(store: StoreWithDetail): StoreDetail {
  if (!store.settings) {
    // Every store is created with its settings in the same transaction.
    throw new Error(`Store ${store.id} has no settings`);
  }
  return {
    id: store.id,
    name: store.name,
    address: store.address,
    city: store.city,
    phone: store.phone,
    tradeRegister: store.tradeRegister,
    status: store.status,
    verifiedAt: store.verifiedAt?.toISOString() ?? null,
    statusReason: store.statusReason,
    country: toStoreCountry(store.country),
    settings: toStoreSettingsView(store.settings),
    managers: store.members.map((member) => ({
      userId: member.user.id,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      phone: member.user.phone,
    })),
    ...toStoreSubscription(store.subscriptions),
    requestedPlan: store.requestedPlan,
    selfRegistered: store.registeredById !== null,
    documents: toStoreDocuments(store),
    createdAt: store.createdAt.toISOString(),
  };
}

export function toStoreCountry(country: Country): StoreCountry {
  return {
    code: country.code,
    name: country.name,
    currencyCode: country.currencyCode,
    currencySymbol: country.currencySymbol,
    decimals: country.decimals,
  };
}

export function toStoreSettingsView(
  settings: StoreSettings,
): StoreSettingsView {
  // BigInt cannot go through JSON.stringify: always format amounts.
  return {
    maxBalance: formatAmount(settings.maxBalance),
    validationThreshold: formatAmount(settings.validationThreshold),
    minDeposit: formatAmount(settings.minDeposit),
    refundAllowed: settings.refundAllowed,
    reservationEnabled: settings.reservationEnabled,
    terms: settings.terms,
    deliveryDelayDays: settings.deliveryDelayDays,
  };
}
