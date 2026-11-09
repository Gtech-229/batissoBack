import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { invalidAccountId } from '../accounts/accounts.errors.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { IdPhotoUploadInterceptor } from '../id-photos/id-photo-upload.interceptor.js';
import { invalidOperationId } from '../ledger/ledger.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { invalidOrderId } from '../orders/orders.errors.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { ProofView } from './dto/proof-view.js';
import { RemoveProofDto } from './dto/remove-proof.dto.js';
import { invalidProofId } from './transaction-proofs.errors.js';
import { TransactionProofsService } from './transaction-proofs.service.js';
import {
  ApiProofUpload,
  ProofFileResponse,
  toProofFile,
} from './transaction-proofs.swagger.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const OperationIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidOperationId,
});
const OrderIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidOrderId });
const ProofIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidProofId });

const ATTACH_DESCRIPTION =
  'Photo du reçu ou du contrat signé à la main : une image JPEG ou PNG (vérifiée d’après son contenu), au plus 5 Mo, dans le champ `photo`. Cinq preuves au plus. Stockée en privé, visible par la quincaillerie et par le client. Ne change jamais l’opération ni le bon.';

const ATTACH_400 =
  'Identifiant invalide ; photo absente, de plus de 5 Mo, qui n’est pas une image JPEG ou PNG, ou envoyée avec d’autres champs (`details`)';

@ApiTags('Mobile - Preuves')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
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
    'Quincaillerie introuvable : vous n’en êtes pas membre actif ; ou opération, bon ou preuve introuvable dans cette quincaillerie',
  type: ErrorResponse,
})
@ApiBadRequestResponse({
  description: 'Identifiant invalide',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER', 'SELLER'])
@Controller('stores/:storeId')
export class StoreProofsController {
  constructor(private readonly proofs: TransactionProofsService) {}

  /**
   * @description Attach a proof to a deposit of this store
   * @route POST /api/v1/stores/:storeId/accounts/:accountId/operations/:operationId/proofs
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @param operationId the deposit
   * @body multipart/form-data, one file in the field `photo`
   * @returns 201 ProofView; 409 PROOF_LIMIT_REACHED, PROOF_TARGET_NOT_ALLOWED or STORE_CLOSED
   */
  @Post('accounts/:accountId/operations/:operationId/proofs')
  @UseInterceptors(IdPhotoUploadInterceptor)
  @ApiOperation({
    summary: 'Joindre une preuve à un dépôt',
    description: ATTACH_DESCRIPTION,
  })
  @ApiParam({ name: 'accountId', description: 'Identifiant du compte' })
  @ApiParam({ name: 'operationId', description: 'Identifiant du dépôt' })
  @ApiProofUpload()
  @ApiCreatedResponse({ description: 'Preuve jointe', type: ProofView })
  @ApiBadRequestResponse({ description: ATTACH_400, type: ErrorResponse })
  @ApiConflictResponse({
    description:
      'Cinq preuves déjà jointes (`PROOF_LIMIT_REACHED`) ; opération qui n’est pas un dépôt (`PROOF_TARGET_NOT_ALLOWED`) ; quincaillerie fermée',
    type: ErrorResponse,
  })
  attachToOperation(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('operationId', OperationIdPipe) operationId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProofView> {
    return this.proofs.attach(
      { storeId: store.storeId, accountId },
      actor,
      { kind: 'operation', id: operationId },
      file,
    );
  }

  /**
   * @description Attach a proof to a material order of this store
   * @route POST /api/v1/stores/:storeId/orders/:orderId/proofs
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param orderId the order
   * @body multipart/form-data, one file in the field `photo`
   * @returns 201 ProofView; 409 PROOF_LIMIT_REACHED or STORE_CLOSED
   */
  @Post('orders/:orderId/proofs')
  @UseInterceptors(IdPhotoUploadInterceptor)
  @ApiOperation({
    summary: 'Joindre une preuve à un bon',
    description: ATTACH_DESCRIPTION,
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiProofUpload()
  @ApiCreatedResponse({ description: 'Preuve jointe', type: ProofView })
  @ApiBadRequestResponse({ description: ATTACH_400, type: ErrorResponse })
  @ApiConflictResponse({
    description:
      'Cinq preuves déjà jointes (`PROOF_LIMIT_REACHED`) ; quincaillerie fermée',
    type: ErrorResponse,
  })
  attachToOrder(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', OrderIdPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProofView> {
    return this.proofs.attach(
      { storeId: store.storeId },
      actor,
      { kind: 'order', id: orderId },
      file,
    );
  }

  /**
   * @description List the proofs of a deposit of this store
   * @route GET /api/v1/stores/:storeId/accounts/:accountId/operations/:operationId/proofs
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @param operationId the deposit
   * @returns 200 ProofView[]
   */
  @Get('accounts/:accountId/operations/:operationId/proofs')
  @ApiOperation({ summary: 'Preuves d’un dépôt' })
  @ApiParam({ name: 'accountId', description: 'Identifiant du compte' })
  @ApiParam({ name: 'operationId', description: 'Identifiant du dépôt' })
  @ApiOkResponse({ description: 'Preuves', type: [ProofView] })
  listForOperation(
    @CurrentStore() store: CurrentStoreContext,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('operationId', OperationIdPipe) operationId: string,
  ): Promise<ProofView[]> {
    return this.proofs.list(
      { storeId: store.storeId, accountId },
      { kind: 'operation', id: operationId },
    );
  }

  /**
   * @description List the proofs of a material order of this store
   * @route GET /api/v1/stores/:storeId/orders/:orderId/proofs
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param orderId the order
   * @returns 200 ProofView[]
   */
  @Get('orders/:orderId/proofs')
  @ApiOperation({ summary: 'Preuves d’un bon' })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Preuves', type: [ProofView] })
  listForOrder(
    @CurrentStore() store: CurrentStoreContext,
    @Param('orderId', OrderIdPipe) orderId: string,
  ): Promise<ProofView[]> {
    return this.proofs.list(
      { storeId: store.storeId },
      { kind: 'order', id: orderId },
    );
  }

  /**
   * @description Read a proof of this store (the image itself)
   * @route GET /api/v1/stores/:storeId/proofs/:proofId/file
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param proofId the proof
   * @returns 200 image/jpeg or image/png; 404 no such live proof
   */
  @Get('proofs/:proofId/file')
  @ProofFileResponse()
  @ApiOperation({
    summary: 'Voir une preuve',
    description:
      'Renvoie l’image elle-même (JPEG ou PNG), jamais mise en cache.',
  })
  @ApiParam({ name: 'proofId', description: 'Identifiant de la preuve' })
  async file(
    @CurrentStore() store: CurrentStoreContext,
    @Param('proofId', ProofIdPipe) proofId: string,
  ): Promise<StreamableFile> {
    return toProofFile(
      await this.proofs.file({ storeId: store.storeId }, proofId),
    );
  }

  /**
   * @description Remove a proof of this store, with a reason: the file is deleted, the record stays
   * @route DELETE /api/v1/stores/:storeId/proofs/:proofId
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param proofId the proof
   * @body RemoveProofDto (reason)
   * @returns 204 no content; 404 no such live proof
   */
  @Delete('proofs/:proofId')
  @StoreRoles(['MANAGER'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Retirer une preuve',
    description:
      'Pour une photo erronée, par exemple le papier d’un autre client. Le gérant donne un motif. Le fichier est supprimé ; la trace, l’auteur et le motif restent dans le journal. La preuve disparaît pour tous et libère une place. Possible quel que soit le statut de la quincaillerie.',
  })
  @ApiParam({ name: 'proofId', description: 'Identifiant de la preuve' })
  @ApiNoContentResponse({ description: 'Preuve retirée' })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide ; motif absent ou invalide (`details`)',
    type: ErrorResponse,
  })
  // Manager only: replaces the class-level 403, which lets sellers in (F-24).
  @ApiForbiddenResponse({
    description:
      'Membre de la quincaillerie qui n’en est pas le gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  remove(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('proofId', ProofIdPipe) proofId: string,
    @Body() body: RemoveProofDto,
  ): Promise<void> {
    return this.proofs.remove(store.storeId, actor, proofId, body.reason);
  }
}
