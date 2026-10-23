import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

export function categoryNotFound(): NotFoundException {
  return new NotFoundException('Catégorie introuvable');
}

export function invalidCategoryId(): BadRequestException {
  return new BadRequestException('Identifiant de catégorie invalide');
}

export function articleNotFound(): NotFoundException {
  return new NotFoundException('Article introuvable');
}

/** Only an article on sale can be chosen for a goal. */
export function articleUnavailable(): ConflictException {
  return new ConflictException({
    message: 'Cet article n’est plus en vente',
    error: 'ARTICLE_UNAVAILABLE',
  });
}

export function invalidArticleId(): BadRequestException {
  return new BadRequestException('Identifiant d’article invalide');
}

/** The store already has an article with this name, ignoring case. */
export function articleExists(): ConflictException {
  return new ConflictException({
    message: 'Cette quincaillerie a déjà un article de ce nom',
    error: 'ARTICLE_EXISTS',
  });
}

/** A price change must change the price: the history records real changes only. */
export function priceUnchanged(
  price: string,
  currencyCode: string,
): ConflictException {
  return new ConflictException({
    message: `Le prix du jour est déjà ${price} ${currencyCode}`,
    error: 'PRICE_UNCHANGED',
  });
}

export function nothingToUpdate(): BadRequestException {
  return new BadRequestException(
    'Indiquez au moins un champ à modifier : nom, catégorie, unité ou disponibilité',
  );
}

/** The store already has a category with this name, ignoring case. */
export function categoryExists(): ConflictException {
  return new ConflictException({
    message: 'Cette quincaillerie a déjà une catégorie de ce nom',
    error: 'CATEGORY_EXISTS',
  });
}
