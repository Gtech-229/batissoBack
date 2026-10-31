import {
  Controller,
  Get,
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
import { ProofView } from './dto/proof-view.js';
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
  'Photo de votre reçu ou de votre contrat signé : une image JPEG ou PNG (vérifiée d’après son contenu), au plus 5 Mo, dans le champ `photo`. Cinq preuves au plus. Visible par vous et par la quincaillerie. Ne change jamais l’opération ni le bon.';

@ApiTags('Mobile - Preuves')
@ApiBearerAuth()
@ApiParam({ name: 'accountId', description: 'Identifiant de mon compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description: 'Compte, opération, bon ou preuve introuvable',
  type: ErrorResponse,
})
@ApiBadRequestResponse({
  description: 'Identifiant invalide',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/accounts/:accountId')
export class MyProofsController {
  constructor(private readonly proofs: TransactionProofsService) {}

  /**
   * @description Attach a proof to a deposit of my account
   * @route POST /api/v1/me/accounts/:accountId/operations/:operationId/proofs
   * @access Mobile session (Bearer), the account's holder
   * @param accountId my account
   * @param operationId the deposit
   * @body multipart/form-data, one file in the field `photo`
   * @returns 201 ProofView; 409 PROOF_LIMIT_REACHED, PROOF_TARGET_NOT_ALLOWED or STORE_CLOSED
   */
  @Post('operations/:operationId/proofs')
  @UseInterceptors(IdPhotoUploadInterceptor)
  @ApiOperation({
    summary: 'Joindre une preuve à mon dépôt',
    description: ATTACH_DESCRIPTION,
  })
  @ApiParam({ name: 'operationId', description: 'Identifiant du dépôt' })
  @ApiProofUpload()
  @ApiCreatedResponse({ description: 'Preuve jointe', type: ProofView })
  @ApiConflictResponse({
    description:
      'Cinq preuves déjà jointes (`PROOF_LIMIT_REACHED`) ; opération qui n’est pas un dépôt (`PROOF_TARGET_NOT_ALLOWED`) ; quincaillerie fermée',
    type: ErrorResponse,
  })
  async attachToOperation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('operationId', OperationIdPipe) operationId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProofView> {
    return this.proofs.attach(
      await this.proofs.customerScope(actor.userId, accountId),
      actor,
      { kind: 'operation', id: operationId },
      file,
    );
  }

  /**
   * @description Attach a proof to a material order of my account
   * @route POST /api/v1/me/accounts/:accountId/orders/:orderId/proofs
   * @access Mobile session (Bearer), the account's holder
   * @param accountId my account
   * @param orderId the order
   * @body multipart/form-data, one file in the field `photo`
   * @returns 201 ProofView; 409 PROOF_LIMIT_REACHED or STORE_CLOSED
   */
  @Post('orders/:orderId/proofs')
  @UseInterceptors(IdPhotoUploadInterceptor)
  @ApiOperation({
    summary: 'Joindre une preuve à mon bon',
    description: ATTACH_DESCRIPTION,
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiProofUpload()
  @ApiCreatedResponse({ description: 'Preuve jointe', type: ProofView })
  @ApiConflictResponse({
    description:
      'Cinq preuves déjà jointes (`PROOF_LIMIT_REACHED`) ; quincaillerie fermée',
    type: ErrorResponse,
  })
  async attachToOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('orderId', OrderIdPipe) orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ProofView> {
    return this.proofs.attach(
      await this.proofs.customerScope(actor.userId, accountId),
      actor,
      { kind: 'order', id: orderId },
      file,
    );
  }

  /**
   * @description List the proofs of a deposit of my account
   * @route GET /api/v1/me/accounts/:accountId/operations/:operationId/proofs
   * @access Mobile session (Bearer), the account's holder
   * @param accountId my account
   * @param operationId the deposit
   * @returns 200 ProofView[]
   */
  @Get('operations/:operationId/proofs')
  @ApiOperation({ summary: 'Preuves de mon dépôt' })
  @ApiParam({ name: 'operationId', description: 'Identifiant du dépôt' })
  @ApiOkResponse({ description: 'Preuves', type: [ProofView] })
  async listForOperation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('operationId', OperationIdPipe) operationId: string,
  ): Promise<ProofView[]> {
    return this.proofs.list(
      await this.proofs.customerScope(actor.userId, accountId),
      { kind: 'operation', id: operationId },
    );
  }

  /**
   * @description List the proofs of a material order of my account
   * @route GET /api/v1/me/accounts/:accountId/orders/:orderId/proofs
   * @access Mobile session (Bearer), the account's holder
   * @param accountId my account
   * @param orderId the order
   * @returns 200 ProofView[]
   */
  @Get('orders/:orderId/proofs')
  @ApiOperation({ summary: 'Preuves de mon bon' })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Preuves', type: [ProofView] })
  async listForOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('orderId', OrderIdPipe) orderId: string,
  ): Promise<ProofView[]> {
    return this.proofs.list(
      await this.proofs.customerScope(actor.userId, accountId),
      { kind: 'order', id: orderId },
    );
  }

  /**
   * @description Read a proof of my account (the image itself)
   * @route GET /api/v1/me/accounts/:accountId/proofs/:proofId/file
   * @access Mobile session (Bearer), the account's holder
   * @param accountId my account
   * @param proofId the proof
   * @returns 200 image/jpeg or image/png; 404 no such live proof
   */
  @Get('proofs/:proofId/file')
  @ProofFileResponse()
  @ApiOperation({
    summary: 'Voir une preuve de mon compte',
    description:
      'Renvoie l’image elle-même (JPEG ou PNG), jamais mise en cache.',
  })
  @ApiParam({ name: 'proofId', description: 'Identifiant de la preuve' })
  async file(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('proofId', ProofIdPipe) proofId: string,
  ): Promise<StreamableFile> {
    return toProofFile(
      await this.proofs.file(
        await this.proofs.customerScope(actor.userId, accountId),
        proofId,
      ),
    );
  }
}
