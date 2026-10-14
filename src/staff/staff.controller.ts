import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { AddSellerDto } from './dto/add-seller.dto.js';
import { StoreMemberView } from './dto/store-member.js';
import { invalidUserId } from './staff.errors.js';
import { StaffService } from './staff.service.js';

const UserIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidUserId });

@ApiTags('Mobile - Équipe de la quincaillerie')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Membre de la quincaillerie sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Quincaillerie introuvable : vous n’en êtes pas membre actif, ou vendeur introuvable',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER'])
@Controller('stores/:storeId')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /**
   * @description List the store's team: managers first, then sellers (inactive sellers included)
   * @route GET /api/v1/stores/:storeId/members
   * @access Store manager (mobile session)
   * @param storeId the store
   * @returns 200 StoreMemberView[]
   */
  @Get('members')
  @ApiOperation({
    summary: 'Équipe de la quincaillerie',
    description:
      'Gérants puis vendeurs, du plus ancien au plus récent. Les vendeurs désactivés sont inclus (`active: false`) pour pouvoir les réactiver.',
  })
  @ApiOkResponse({ description: 'Équipe', type: [StoreMemberView] })
  members(
    @CurrentStore() store: CurrentStoreContext,
  ): Promise<StoreMemberView[]> {
    return this.staff.members(store.storeId);
  }

  /**
   * @description Add a seller by phone (creates the user if the phone is new; reactivates a former seller)
   * @route POST /api/v1/stores/:storeId/sellers
   * @access Store manager (mobile session)
   * @param storeId the store
   * @body AddSellerDto (phone, firstName, lastName)
   * @returns 201 StoreMemberView (200 when a former seller is reactivated); 409 STORE_NOT_VERIFIED or ALREADY_MEMBER
   */
  @Post('sellers')
  @ApiOperation({
    summary: 'Ajouter un vendeur',
    description:
      'Si le numéro n’a pas encore de compte, il est créé avec ces nom et prénom (sans PIN : le vendeur active l’application par code SMS). Un compte existant garde ses nom et prénom. Un ancien vendeur de la quincaillerie est réactivé (réponse 200). Seulement pour une quincaillerie vérifiée.',
  })
  @ApiCreatedResponse({ description: 'Vendeur ajouté', type: StoreMemberView })
  @ApiOkResponse({
    description: 'Ancien vendeur réactivé',
    type: StoreMemberView,
  })
  @ApiBadRequestResponse({
    description:
      'Données invalides, ou numéro d’un autre pays que la quincaillerie (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie non vérifiée (`STORE_NOT_VERIFIED`) ; déjà vendeur actif ou gérant de la quincaillerie (`ALREADY_MEMBER`)',
    type: ErrorResponse,
  })
  async addSeller(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: AddSellerDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StoreMemberView> {
    const { member, created } = await this.staff.addSeller(store, actor, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return member;
  }

  /**
   * @description Deactivate a seller: they keep their account but lose access to this store at once
   * @route PATCH /api/v1/stores/:storeId/sellers/:userId/deactivate
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param userId the seller's user id
   * @returns 200 StoreMemberView; 404 seller not found; 409 STORE_NOT_VERIFIED or ALREADY_INACTIVE
   */
  @Patch('sellers/:userId/deactivate')
  @ApiOperation({
    summary: 'Désactiver un vendeur',
    description:
      'Le vendeur garde son compte (il peut être client ou membre d’une autre quincaillerie) mais n’a plus accès à cette quincaillerie dès sa prochaine requête. Seulement pour une quincaillerie vérifiée.',
  })
  @ApiParam({ name: 'userId', description: 'Identifiant du vendeur' })
  @ApiOkResponse({ description: 'Vendeur désactivé', type: StoreMemberView })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie non vérifiée (`STORE_NOT_VERIFIED`) ; vendeur déjà désactivé (`ALREADY_INACTIVE`)',
    type: ErrorResponse,
  })
  deactivate(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', UserIdPipe) userId: string,
  ): Promise<StoreMemberView> {
    return this.staff.setSellerActive(store, actor, userId, false);
  }

  /**
   * @description Reactivate a deactivated seller
   * @route PATCH /api/v1/stores/:storeId/sellers/:userId/reactivate
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param userId the seller's user id
   * @returns 200 StoreMemberView; 404 seller not found; 409 STORE_NOT_VERIFIED or ALREADY_ACTIVE
   */
  @Patch('sellers/:userId/reactivate')
  @ApiOperation({
    summary: 'Réactiver un vendeur',
    description:
      'Rend l’accès à la quincaillerie à un vendeur désactivé. Seulement pour une quincaillerie vérifiée.',
  })
  @ApiParam({ name: 'userId', description: 'Identifiant du vendeur' })
  @ApiOkResponse({ description: 'Vendeur réactivé', type: StoreMemberView })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie non vérifiée (`STORE_NOT_VERIFIED`) ; vendeur déjà actif (`ALREADY_ACTIVE`)',
    type: ErrorResponse,
  })
  reactivate(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', UserIdPipe) userId: string,
  ): Promise<StoreMemberView> {
    return this.staff.setSellerActive(store, actor, userId, true);
  }
}
