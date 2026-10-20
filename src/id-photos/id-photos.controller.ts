import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { invalidAccountId } from '../accounts/accounts.errors.js';
import { AccountDetail } from '../accounts/dto/account-detail.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { IdPhotoUploadInterceptor } from './id-photo-upload.interceptor.js';
import { IdPhotosService } from './id-photos.service.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });

@ApiTags('Mobile - Comptes clients')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiParam({ name: 'accountId', description: 'Identifiant du compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Membre de la quincaillerie sans le rôle de vendeur ou de gérant (`STORE_ROLE_REQUIRED`)',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Quincaillerie introuvable : vous n’en êtes pas membre actif ; compte introuvable dans cette quincaillerie ; ou, en lecture, aucune photo pour ce compte',
  type: ErrorResponse,
})
// Every route answers 400 to a malformed store id (StoreAccessGuard). A route
// that declares its own 400 replaces this one, so it names the store id too.
@ApiBadRequestResponse({
  description: 'Identifiant de quincaillerie ou de compte invalide',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER', 'SELLER'])
@Controller('stores/:storeId/accounts/:accountId/id-photo')
export class IdPhotosController {
  constructor(private readonly photos: IdPhotosService) {}

  /**
   * @description Upload or replace the customer's identity photo (JPEG or PNG, at most 5 MB)
   * @route PUT /api/v1/stores/:storeId/accounts/:accountId/id-photo
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @body multipart/form-data, one file in the field `photo`
   * @returns 200 AccountDetail (hasIdPhoto: true); 409 STORE_NOT_VERIFIED
   */
  @Put()
  @UseInterceptors(IdPhotoUploadInterceptor)
  @ApiOperation({
    summary: 'Enregistrer la photo d’identité',
    description:
      'Photo de la pièce d’identité du client, prise au comptoir : une image JPEG ou PNG (vérifiée d’après son contenu), au plus 5 Mo, dans le champ `photo`. Remplace la photo précédente, qui est supprimée. Stockée en privé sur le serveur, jamais renvoyée dans le JSON. Seulement pour une quincaillerie vérifiée.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'Image JPEG ou PNG, au plus 5 Mo',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Photo enregistrée', type: AccountDetail })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou de compte invalide ; photo absente, de plus de 5 Mo, qui n’est pas une image JPEG ou PNG, ou envoyée avec d’autres champs (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Quincaillerie non vérifiée (`STORE_NOT_VERIFIED`)',
    type: ErrorResponse,
  })
  upload(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AccountDetail> {
    return this.photos.upload(store, actor, accountId, file);
  }

  /**
   * @description Read the customer's identity photo (the image itself)
   * @route GET /api/v1/stores/:storeId/accounts/:accountId/id-photo
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @returns 200 image/jpeg or image/png; 404 no photo for this account
   */
  @Get()
  // An identity document: never kept in a cache, never sniffed as another type.
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Voir la photo d’identité',
    description:
      'Renvoie l’image elle-même (JPEG ou PNG), jamais mise en cache. Seulement pour les comptes de cette quincaillerie.',
  })
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOkResponse({
    description: 'La photo',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
    },
  })
  async view(
    @CurrentStore() store: CurrentStoreContext,
    @Param('accountId', AccountIdPipe) accountId: string,
  ): Promise<StreamableFile> {
    const { stream, contentType } = await this.photos.view(
      store.storeId,
      accountId,
    );
    return new StreamableFile(stream, {
      type: contentType,
      disposition: 'inline',
    });
  }
}
