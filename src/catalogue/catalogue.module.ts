import { Module } from '@nestjs/common';
import { ArticleCategoriesController } from './article-categories.controller.js';
import { ArticlesController } from './articles.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { MyCatalogueController } from './my-catalogue.controller.js';

/** A store's catalogue: categories, articles and their prices. */
@Module({
  controllers: [
    ArticleCategoriesController,
    ArticlesController,
    MyCatalogueController,
  ],
  providers: [CatalogueService],
})
export class CatalogueModule {}
