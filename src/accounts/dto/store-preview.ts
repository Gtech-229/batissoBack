import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import type {
  Country,
  HardwareStore,
  StoreSettings,
} from '../../generated/prisma/client.js';

/**
 * A store as a user sees it before joining it (21c): who it is and the rules
 * they accept. Amounts are strings of the smallest currency unit.
 */
export class StorePreview {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;

  @ApiProperty({ example: 'Bamako' })
  city: string;

  @ApiProperty({
    description: 'Conditions générales de la quincaillerie, à accepter',
    type: String,
    nullable: true,
    example: null,
  })
  terms: string | null;

  @ApiProperty({ example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ example: 'F CFA' })
  currencySymbol: string;

  @ApiProperty({
    description: 'Chiffres après la virgule pour afficher les montants',
    example: 0,
  })
  decimals: number;

  @ApiProperty({ description: 'Dépôt minimum', example: '500' })
  minDeposit: string;

  @ApiProperty({ description: 'Solde maximal du compte', example: '2000000' })
  maxBalance: string;

  @ApiProperty({
    description:
      'Jours après la confirmation d’un bon au-delà desquels vous pouvez en demander l’annulation s’il n’est pas livré',
    example: 30,
  })
  deliveryDelayDays: number;
}

export function toStorePreview(
  store: HardwareStore & { country: Country; settings: StoreSettings | null },
): StorePreview {
  if (!store.settings) {
    // Every store is created with its settings in the same transaction.
    throw new Error(`Store ${store.id} has no settings`);
  }
  return {
    id: store.id,
    name: store.name,
    city: store.city,
    terms: store.settings.terms,
    currencyCode: store.country.currencyCode,
    currencySymbol: store.country.currencySymbol,
    decimals: store.country.decimals,
    minDeposit: formatAmount(store.settings.minDeposit),
    maxBalance: formatAmount(store.settings.maxBalance),
    deliveryDelayDays: store.settings.deliveryDelayDays,
  };
}
