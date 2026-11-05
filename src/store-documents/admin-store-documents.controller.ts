import {
  applyDecorators,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { invalidStoreId } from '../stores/stores.errors.js';
import type { StoreDocumentKind } from './store-documents.errors.js';
import { StoreDocumentsService } from './store-documents.service.js';

const StoreIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidStoreId });

/** What both read routes share: an identity document, never cached. */
function DocumentRead(summary: string) {
  return applyDecorators(
    RequirePermission('stores.read'),
    Header('Cache-Control', 'no-store'),
    Header('X-Content-Type-Options', 'nosniff'),
    ApiOperation({
      summary,
      description:
        'Renvoie l’image elle-même (JPEG ou PNG), envoyée par le gérant à l’inscription depuis l’application. Jamais mise en cache.',
    }),
    ApiProduces('image/jpeg', 'image/png'),
    ApiOkResponse({
      description: 'La photo',
      content: {
        'image/jpeg': { schema: { type: 'string', format: 'binary' } },
        'image/png': { schema: { type: 'string', format: 'binary' } },
      },
    }),
  );
}

@ApiTags('Administration - Quincailleries')
@ApiCookieAuth()
@ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiBadRequestResponse({
  description: 'Identifiant invalide',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description: 'Quincaillerie introuvable, ou document non envoyé',
  type: ErrorResponse,
})
@Controller('admin/stores/:id/documents')
export class AdminStoreDocumentsController {
  constructor(private readonly documents: StoreDocumentsService) {}

  /**
   * @description Read the manager's identity photo sent with a self-registration
   * @route GET /api/v1/admin/stores/:id/documents/identity
   * @access Admin with stores.read
   * @param id (UUID) store id
   * @returns 200 image/jpeg or image/png; 404 not sent
   */
  @Get('identity')
  @DocumentRead('Voir la pièce d’identité du gérant')
  identity(@Param('id', StoreIdPipe) id: string): Promise<StreamableFile> {
    return this.send(id, 'identity');
  }

  /**
   * @description Read the trade register photo sent with a self-registration
   * @route GET /api/v1/admin/stores/:id/documents/trade-register
   * @access Admin with stores.read
   * @param id (UUID) store id
   * @returns 200 image/jpeg or image/png; 404 not sent
   */
  @Get('trade-register')
  @DocumentRead('Voir le registre du commerce')
  tradeRegister(@Param('id', StoreIdPipe) id: string): Promise<StreamableFile> {
    return this.send(id, 'trade-register');
  }

  private async send(
    id: string,
    kind: StoreDocumentKind,
  ): Promise<StreamableFile> {
    const { content, contentType } = await this.documents.view(id, kind);
    // Bytes already in memory: nothing can fail once the answer has started.
    return new StreamableFile(content, {
      type: contentType,
      disposition: 'inline',
    });
  }
}
