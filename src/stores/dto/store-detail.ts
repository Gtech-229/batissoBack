import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import type {
  Country,
  HardwareStore,
  StoreMember,
  StoreSettings,
  User,
} from '../../generated/prisma/client.js';
import { StoreStatus } from '../../generated/prisma/client.js';

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

  @ApiProperty({ example: '2026-10-06T09:00:00.000Z' })
  createdAt: string;
}

/** The Prisma shape loaded by STORE_DETAIL_INCLUDE. */
export type StoreWithDetail = HardwareStore & {
  country: Country;
  settings: StoreSettings | null;
  members: (StoreMember & { user: User })[];
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
    country: {
      code: store.country.code,
      name: store.country.name,
      currencyCode: store.country.currencyCode,
      currencySymbol: store.country.currencySymbol,
      decimals: store.country.decimals,
    },
    // BigInt cannot go through JSON.stringify: always format amounts.
    settings: {
      maxBalance: formatAmount(store.settings.maxBalance),
      validationThreshold: formatAmount(store.settings.validationThreshold),
      minDeposit: formatAmount(store.settings.minDeposit),
      refundAllowed: store.settings.refundAllowed,
      reservationEnabled: store.settings.reservationEnabled,
      terms: store.settings.terms,
    },
    managers: store.members.map((member) => ({
      userId: member.user.id,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      phone: member.user.phone,
    })),
    createdAt: store.createdAt.toISOString(),
  };
}
