import { ApiProperty, OmitType } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { SubscriptionPlan } from '../../generated/prisma/client.js';
import { RegisterStoreDto } from './register-store.dto.js';

/**
 * A store registered from the app (21b): the admin form's fields and rules,
 * without the country (the active one) and the manager (the registrant).
 * OmitType keeps the validators of the fields it copies.
 */
export class RegisterOwnStoreDto extends OmitType(RegisterStoreDto, [
  'countryCode',
  'manager',
] as const) {
  @ApiProperty({
    description:
      'Formule souhaitée. Montrée aux administrateurs, qui enregistrent l’abonnement : l’inscription n’en crée aucun.',
    enum: SubscriptionPlan,
    example: SubscriptionPlan.STANDARD,
  })
  @IsEnum(SubscriptionPlan, {
    message: 'La formule doit être TRIAL, STANDARD ou PRO',
  })
  requestedPlan: SubscriptionPlan;
}
