import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import {
  StoreStatus,
  type HardwareStore,
  type Subscription,
} from '../../generated/prisma/client.js';
import { Trim, TrimUpperCase } from '../../common/validation/trim.js';
import { SubscriptionView } from '../../subscriptions/dto/subscription.dto.js';
import {
  toStoreSubscription,
  type StoreSubscription,
} from '../../subscriptions/store-subscription.js';
import {
  SUBSCRIPTION_STATES,
  type SubscriptionState,
} from '../../subscriptions/subscription-status.js';

/** `GET /admin/stores?page=1&pageSize=20&status=PENDING&countryCode=ML&q=carrefour` */
export class ListStoresQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: StoreStatus, description: 'Filtrer par statut' })
  @IsOptional()
  @IsEnum(StoreStatus, {
    message: 'Le statut doit être PENDING, VERIFIED, SUSPENDED ou CLOSED',
  })
  status?: StoreStatus;

  @ApiPropertyOptional({ description: 'Filtrer par pays', example: 'ML' })
  @IsOptional()
  @TrimUpperCase()
  @IsISO31661Alpha2({
    message: 'Le code pays doit être un code ISO à 2 lettres (ex. ML)',
  })
  countryCode?: string;

  @ApiPropertyOptional({
    description:
      'Recherche dans le nom ou la ville (sans tenir compte des majuscules)',
    example: 'carrefour',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La recherche doit être un texte' })
  @Length(1, 100, { message: 'La recherche doit contenir 1 à 100 caractères' })
  q?: string;

  @ApiPropertyOptional({
    enum: SUBSCRIPTION_STATES,
    description:
      'Filtrer par abonnement du jour : ACTIVE, UPCOMING, EXPIRED ou NONE',
  })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATES, {
    message: 'L’état d’abonnement doit être ACTIVE, UPCOMING, EXPIRED ou NONE',
  })
  subscriptionState?: SubscriptionState;
}

/** One line of the store list (the detail route gives the rest). */
export class StoreSummary {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;

  @ApiProperty({ example: 'Bamako' })
  city: string;

  @ApiProperty({ example: 'ML' })
  countryCode: string;

  @ApiProperty({ example: '+22320220000' })
  phone: string;

  @ApiProperty({ enum: StoreStatus, example: StoreStatus.PENDING })
  status: StoreStatus;

  @ApiProperty({ example: '2026-10-06T09:00:00.000Z' })
  createdAt: string;

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
}

export function toStoreSummary(
  store: HardwareStore & { subscriptions: Subscription[] },
): StoreSummary {
  const subscription: StoreSubscription = toStoreSubscription(
    store.subscriptions,
  );
  return {
    id: store.id,
    name: store.name,
    city: store.city,
    countryCode: store.countryCode,
    phone: store.phone,
    status: store.status,
    createdAt: store.createdAt.toISOString(),
    ...subscription,
  };
}
