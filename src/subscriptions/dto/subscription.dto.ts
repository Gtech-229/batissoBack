import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, ValidateIf } from 'class-validator';
import {
  SubscriptionPlan,
  type Subscription,
} from '../../generated/prisma/client.js';
import { IsDay } from '../../common/validation/day.js';
import {
  dateToDay,
  SUBSCRIPTION_STATUSES,
  subscriptionStatus,
  today,
  type SubscriptionStatus,
} from '../subscription-status.js';

const PLAN_DESCRIPTION =
  'Formule : TRIAL (Essai), STANDARD (Standard) ou PRO (Pro)';
const PLAN_MESSAGE = 'La formule doit être TRIAL, STANDARD ou PRO';

export class CreateSubscriptionDto {
  @ApiProperty({
    description: PLAN_DESCRIPTION,
    enum: SubscriptionPlan,
    example: SubscriptionPlan.STANDARD,
  })
  @IsEnum(SubscriptionPlan, { message: PLAN_MESSAGE })
  plan: SubscriptionPlan;

  @ApiProperty({
    description: 'Premier jour de l’abonnement, inclus (AAAA-MM-JJ, UTC)',
    example: '2026-11-01',
  })
  @IsDay()
  startsOn: string;

  @ApiProperty({
    description:
      'Dernier jour de l’abonnement, inclus (AAAA-MM-JJ, UTC) ; le même jour que le début ou après',
    example: '2026-11-30',
  })
  @IsDay()
  endsOn: string;
}

// Not @IsOptional(): it lets null through to Prisma, a 500 (F-38).
const sent = (_: object, value: unknown) => value !== undefined;

/** Corrects a subscription; only the fields sent change. */
export class UpdateSubscriptionDto {
  @ApiPropertyOptional({
    description: PLAN_DESCRIPTION,
    enum: SubscriptionPlan,
    example: SubscriptionPlan.PRO,
  })
  @ValidateIf(sent)
  @IsEnum(SubscriptionPlan, { message: PLAN_MESSAGE })
  plan?: SubscriptionPlan;

  @ApiPropertyOptional({
    description: 'Nouveau premier jour, inclus (AAAA-MM-JJ, UTC)',
    example: '2026-11-01',
  })
  @ValidateIf(sent)
  @IsDay()
  startsOn?: string;

  @ApiPropertyOptional({
    description:
      'Nouveau dernier jour, inclus (AAAA-MM-JJ, UTC) : avancez-le pour arrêter l’abonnement plus tôt',
    example: '2026-11-15',
  })
  @ValidateIf(sent)
  @IsDay()
  endsOn?: string;
}

export class SubscriptionView {
  @ApiProperty({
    description: 'Identifiant de l’abonnement',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({
    description: 'Identifiant de la quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0e',
  })
  storeId: string;

  @ApiProperty({
    description: PLAN_DESCRIPTION,
    enum: SubscriptionPlan,
    example: SubscriptionPlan.STANDARD,
  })
  plan: SubscriptionPlan;

  @ApiProperty({ description: 'Premier jour, inclus', example: '2026-11-01' })
  startsOn: string;

  @ApiProperty({ description: 'Dernier jour, inclus', example: '2026-11-30' })
  endsOn: string;

  @ApiProperty({
    description:
      'Calculé chaque jour (UTC) : UPCOMING avant le premier jour, ACTIVE pendant la période, EXPIRED après le dernier jour',
    enum: SUBSCRIPTION_STATUSES,
    example: 'ACTIVE',
  })
  status: SubscriptionStatus;

  @ApiProperty({
    description: 'Date d’enregistrement (ISO 8601, UTC)',
    example: '2026-10-28T12:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Date de la dernière modification (ISO 8601, UTC)',
    example: '2026-10-28T12:00:00.000Z',
  })
  updatedAt: string;
}

/** Never the admins who recorded or edited it. */
export function toSubscriptionView(
  subscription: Subscription,
  day: string = today(),
): SubscriptionView {
  const startsOn = dateToDay(subscription.startsOn);
  const endsOn = dateToDay(subscription.endsOn);
  return {
    id: subscription.id,
    storeId: subscription.storeId,
    plan: subscription.plan,
    startsOn,
    endsOn,
    status: subscriptionStatus({ startsOn, endsOn }, day),
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}
