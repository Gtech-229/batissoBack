import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { RegisterOwnStoreDto } from './dto/register-own-store.dto.js';
import { RegisteredStore } from './dto/registered-store.js';
import { StoresService } from './stores.service.js';

@ApiTags('Mobile - Inscription de quincaillerie')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('stores')
export class StoreRegistrationController {
  constructor(private readonly stores: StoresService) {}

  /**
   * @description Register the signed-in user's own store (PENDING; they become its manager)
   * @route POST /api/v1/stores
   * @access Mobile session (Bearer), any signed-in user
   * @body RegisterOwnStoreDto (name, address, city, phone, tradeRegister, settings, requestedPlan)
   * @returns 201 RegisteredStore; 409 STORE_ALREADY_REGISTERED or NO_ACTIVE_COUNTRY
   */
  @Post()
  @ApiOperation({
    summary: 'Inscrire ma quincaillerie',
    description:
      'Inscrit la quincaillerie de l’utilisateur connecté dans le pays actif, en attente de vérification (PENDING) : il en devient le gérant. Les règles d’argent suivent celles du formulaire administrateur. La formule demandée est montrée aux administrateurs, qui enregistrent l’abonnement. Envoyez ensuite les photos de votre pièce d’identité et du registre du commerce. Aucun dépôt n’est possible avant la vérification. Un utilisateur n’inscrit qu’une quincaillerie.',
  })
  @ApiCreatedResponse({
    description: 'Quincaillerie inscrite',
    type: RegisteredStore,
  })
  @ApiBadRequestResponse({
    description:
      'Champ manquant ou invalide, numéro qui n’est pas du pays actif, dépôt minimum au-dessus du solde maximal (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Vous avez déjà inscrit une quincaillerie (`STORE_ALREADY_REGISTERED`) ; aucun pays actif (`NO_ACTIVE_COUNTRY`)',
    type: ErrorResponse,
  })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterOwnStoreDto,
  ): Promise<RegisteredStore> {
    return this.stores.registerOwn(dto, user.userId);
  }
}
