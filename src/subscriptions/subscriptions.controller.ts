import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedAdmin } from '../admin-auth/authenticated-admin.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { invalidStoreId } from '../stores/stores.errors.js';
import {
  CreateSubscriptionDto,
  SubscriptionView,
  UpdateSubscriptionDto,
} from './dto/subscription.dto.js';
import { invalidSubscriptionId } from './subscriptions.errors.js';
import { SubscriptionsService } from './subscriptions.service.js';

const StoreIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidStoreId });
const SubscriptionIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidSubscriptionId,
});

@ApiTags('Administration - Abonnements')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Permission manquante',
  type: ErrorResponse,
})
@Controller('admin')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /**
   * @description Record a subscription of a store: a plan over a period of days
   * @route POST /api/v1/admin/stores/:id/subscriptions
   * @access Admin with subscriptions.manage
   * @param id (UUID) store id
   * @body CreateSubscriptionDto (plan, startsOn, endsOn)
   * @returns 201 SubscriptionView; 404 store; 409 STORE_CLOSED, SUBSCRIPTION_OVERLAP; 400 INVALID_SUBSCRIPTION_PERIOD
   */
  @Post('stores/:id/subscriptions')
  @RequirePermission('subscriptions.manage')
  @ApiOperation({
    summary: 'Enregistrer un abonnement',
    description:
      'Enregistre une formule (Essai, Standard, Pro) du premier au dernier jour inclus. Enregistrement seulement : aucun paiement, aucune limite selon la formule, rien d’automatique à la fin. Deux abonnements d’une quincaillerie ne se chevauchent jamais ; une quincaillerie fermée n’en reçoit plus.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiCreatedResponse({
    description: 'Abonnement enregistré',
    type: SubscriptionView,
  })
  @ApiBadRequestResponse({
    description:
      'Données invalides (`details`) ou fin avant le début (`INVALID_SUBSCRIPTION_PERIOD`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie fermée (`STORE_CLOSED`) ou période qui chevauche un autre abonnement (`SUBSCRIPTION_OVERLAP`)',
    type: ErrorResponse,
  })
  create(
    @Param('id', StoreIdPipe) storeId: string,
    @Body() body: CreateSubscriptionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<SubscriptionView> {
    return this.subscriptions.create(storeId, body, admin.adminId);
  }

  /**
   * @description List a store's subscriptions, newest first
   * @route GET /api/v1/admin/stores/:id/subscriptions
   * @access Admin with subscriptions.read
   * @param id (UUID) store id
   * @returns SubscriptionView[]; 404 store
   */
  @Get('stores/:id/subscriptions')
  @RequirePermission('subscriptions.read')
  @ApiOperation({
    summary: 'Lister les abonnements d’une quincaillerie',
    description:
      'Tous ses abonnements, le plus récent d’abord, chacun avec son état du jour (UPCOMING, ACTIVE, EXPIRED).',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Abonnements', type: [SubscriptionView] })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  list(@Param('id', StoreIdPipe) storeId: string): Promise<SubscriptionView[]> {
    return this.subscriptions.listForStore(storeId);
  }

  /**
   * @description Correct a subscription: its plan or dates; ending early is a new end day
   * @route PATCH /api/v1/admin/subscriptions/:subscriptionId
   * @access Admin with subscriptions.manage
   * @param subscriptionId (UUID) subscription id
   * @body UpdateSubscriptionDto (plan?, startsOn?, endsOn?)
   * @returns SubscriptionView; 404; 409 SUBSCRIPTION_OVERLAP; 400 INVALID_SUBSCRIPTION_PERIOD
   */
  @Patch('subscriptions/:subscriptionId')
  @RequirePermission('subscriptions.manage')
  @ApiOperation({
    summary: 'Corriger un abonnement',
    description:
      'Change la formule ou les dates ; seuls les champs envoyés changent. Pour arrêter un abonnement plus tôt, avancez son dernier jour. Les mêmes règles qu’à l’enregistrement s’appliquent, face aux autres abonnements de la quincaillerie. Aucune suppression : une erreur se corrige.',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Identifiant de l’abonnement',
  })
  @ApiOkResponse({ description: 'Abonnement corrigé', type: SubscriptionView })
  @ApiBadRequestResponse({
    description:
      'Données invalides (`details`) ou fin avant le début (`INVALID_SUBSCRIPTION_PERIOD`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Abonnement introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Période qui chevauche un autre abonnement (`SUBSCRIPTION_OVERLAP`)',
    type: ErrorResponse,
  })
  update(
    @Param('subscriptionId', SubscriptionIdPipe) id: string,
    @Body() body: UpdateSubscriptionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<SubscriptionView> {
    return this.subscriptions.update(id, body, admin.adminId);
  }
}
