import { Module } from '@nestjs/common';
import { AdminStoreDocumentsController } from './admin-store-documents.controller.js';
import { StoreDocumentStorage } from './store-document-storage.js';
import { StoreDocumentsController } from './store-documents.controller.js';
import { StoreDocumentsService } from './store-documents.service.js';

/**
 * Documents of self-registered stores (21b): sent by the manager, read by
 * admins, kept in the private `STORE_DOCUMENT_DIR` directory.
 */
@Module({
  controllers: [StoreDocumentsController, AdminStoreDocumentsController],
  providers: [StoreDocumentStorage, StoreDocumentsService],
})
export class StoreDocumentsModule {}
