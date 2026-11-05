import {
  applyDecorators,
  Controller,
  Put,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import { IdPhotoUploadInterceptor } from '../id-photos/id-photo-upload.interceptor.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { StoreDocuments } from '../stores/dto/store-documents.js';
import { StoreDocumentsService } from './store-documents.service.js';

/** What both upload routes share: the multipart body and its answers. */
function DocumentUpload(summary: string, document: string) {
  return applyDecorators(
    UseInterceptors(IdPhotoUploadInterceptor),
    ApiOperation({
      summary,
      description: `Photo ${document} : une image JPEG ou PNG (vérifiée d’après son contenu), au plus 5 Mo, dans le champ \`photo\`. Remplace la photo précédente, qui est supprimée. Stockée en privé sur le serveur et lue seulement par les administrateurs. Seulement tant que la quincaillerie attend sa vérification.`,
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
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
    }),
    ApiOkResponse({
      description: 'Photo enregistrée : les documents présents',
      type: StoreDocuments,
    }),
    ApiBadRequestResponse({
      description:
        'Identifiant de quincaillerie invalide ; photo absente, de plus de 5 Mo, qui n’est pas une image JPEG ou PNG, ou envoyée avec d’autres champs (`details`)',
      type: ErrorResponse,
    }),
    ApiConflictResponse({
      description:
        'Quincaillerie déjà vérifiée, suspendue ou fermée (`STORE_NOT_PENDING`)',
      type: ErrorResponse,
    }),
  );
}

@ApiTags('Mobile - Inscription de quincaillerie')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Membre de la quincaillerie qui n’en est pas le gérant (`STORE_ROLE_REQUIRED`)',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description: 'Quincaillerie introuvable : vous n’en êtes pas membre actif',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER'])
@Controller('stores/:storeId/documents')
export class StoreDocumentsController {
  constructor(private readonly documents: StoreDocumentsService) {}

  /**
   * @description Upload or replace the manager's identity photo of a store waiting for verification
   * @route PUT /api/v1/stores/:storeId/documents/identity
   * @access Store manager (mobile session)
   * @param storeId the store
   * @body multipart/form-data, one file in the field `photo`
   * @returns 200 StoreDocuments; 409 STORE_NOT_PENDING
   */
  @Put('identity')
  @DocumentUpload(
    'Envoyer ma pièce d’identité',
    'de la pièce d’identité du gérant',
  )
  uploadIdentity(
    @CurrentStore() store: CurrentStoreContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoreDocuments> {
    return this.documents.upload(store.storeId, 'identity', file);
  }

  /**
   * @description Upload or replace the trade register photo of a store waiting for verification
   * @route PUT /api/v1/stores/:storeId/documents/trade-register
   * @access Store manager (mobile session)
   * @param storeId the store
   * @body multipart/form-data, one file in the field `photo`
   * @returns 200 StoreDocuments; 409 STORE_NOT_PENDING
   */
  @Put('trade-register')
  @DocumentUpload(
    'Envoyer le registre du commerce',
    'du registre du commerce de la quincaillerie',
  )
  uploadTradeRegister(
    @CurrentStore() store: CurrentStoreContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoreDocuments> {
    return this.documents.upload(store.storeId, 'trade-register', file);
  }
}
