import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import { escapeLike } from '../common/like.js';
import { formatAmount, parseAmount } from '../common/money.js';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../common/pagination.js';
import { ActivityAction, Prisma } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { goalNotFound } from '../goals/goals.errors.js';
import { lockStoreNotClosed } from '../store-access/verified-store.js';
import {
  articleExists,
  articleNotFound,
  categoryExists,
  categoryNotFound,
  nothingToUpdate,
  priceUnchanged,
} from './catalogue.errors.js';
import {
  ARTICLE_INCLUDE,
  ARTICLES_ORDER,
  toArticleView,
  type ArticleView,
  type CreateArticleDto,
  type ListArticlesQueryDto,
  type UpdateArticleDto,
} from './dto/article.js';
import {
  toPriceHistoryEntry,
  type ChangePriceDto,
  type PriceHistoryEntry,
} from './dto/price.js';
import {
  CATEGORIES_ORDER,
  toArticleCategoryView,
  type ArticleCategoryView,
  type CategoryNameDto,
} from './dto/article-category.js';
import {
  toCatalogueArticle,
  type CatalogueArticle,
  type ListMyArticlesQueryDto,
} from './dto/catalogue-article.js';

type Tx = Prisma.TransactionClient;

/**
 * A store's catalogue. Staff routes take the store from the guard's context
 * (the URL's store, checked against the caller's membership), never from a
 * body; customer routes take it from their own account. Every change refuses
 * a CLOSED store and writes its activity log row in the same transaction.
 */
@Injectable()
export class CatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  /** The store's categories, by name. */
  async categories(storeId: string): Promise<ArticleCategoryView[]> {
    const categories = await this.prisma.articleCategory.findMany({
      where: { storeId },
      orderBy: [...CATEGORIES_ORDER],
    });
    return categories.map(toArticleCategoryView);
  }

  /** The categories of the store of one of the customer's accounts. */
  async myCategories(
    userId: string,
    accountId: string,
  ): Promise<ArticleCategoryView[]> {
    const { storeId } = await this.ownAccount(userId, accountId);
    return this.categories(storeId);
  }

  /**
   * The articles on sale in the store of one of the customer's accounts, each
   * with the units the account balance buys at the price of the day (the
   * equivalence calculator, user decision 2026-10-23). With `goalId`, the
   * units come from that goal's balance instead.
   */
  async myArticles(
    userId: string,
    accountId: string,
    query: ListMyArticlesQueryDto,
  ): Promise<Paginated<CatalogueArticle>> {
    const account = await this.ownAccount(userId, accountId);
    let balance = account.balance;
    if (query.goalId !== undefined) {
      const goal = await this.prisma.goal.findFirst({
        where: { id: query.goalId, accountId },
        select: { balance: true },
      });
      if (!goal) {
        throw goalNotFound();
      }
      balance = goal.balance;
    }
    const where: Prisma.ArticleWhereInput = {
      storeId: account.storeId,
      available: true,
      categoryId: query.categoryId,
      ...(query.q && {
        name: { contains: escapeLike(query.q), mode: 'insensitive' },
      }),
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [articles, total] = await this.prisma.$transaction(
      [
        this.prisma.article.findMany({
          where,
          include: ARTICLE_INCLUDE,
          orderBy: [...ARTICLES_ORDER],
          ...toSkipTake(query),
        }),
        this.prisma.article.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(
      articles.map((article) => toCatalogueArticle(article, balance)),
      total,
      query,
    );
  }

  async createCategory(
    storeId: string,
    actor: AuthenticatedUser,
    dto: CategoryNameDto,
  ): Promise<ArticleCategoryView> {
    return this.unique(categoryExists, () =>
      this.prisma.$transaction(async (tx) => {
        await lockStoreNotClosed(tx, storeId);
        const category = await tx.articleCategory.create({
          data: { storeId, name: dto.name },
        });
        await this.log(tx, storeId, actor, {
          action: ActivityAction.ARTICLE_CATEGORY_CREATED,
          newValue: { categoryId: category.id, name: category.name },
        });
        return toArticleCategoryView(category);
      }),
    );
  }

  async renameCategory(
    storeId: string,
    actor: AuthenticatedUser,
    categoryId: string,
    dto: CategoryNameDto,
  ): Promise<ArticleCategoryView> {
    return this.unique(categoryExists, () =>
      this.prisma.$transaction(async (tx) => {
        await lockStoreNotClosed(tx, storeId);
        const current = await this.lockCategory(tx, storeId, categoryId);
        // The same name changes nothing: no write, so no log row (F-06).
        if (current.name === dto.name) {
          return toArticleCategoryView(current);
        }
        const category = await tx.articleCategory.update({
          where: { id: current.id },
          data: { name: dto.name },
        });
        // current.id, not the URL's spelling: ids are logged in lowercase.
        await this.log(tx, storeId, actor, {
          action: ActivityAction.ARTICLE_CATEGORY_RENAMED,
          oldValue: { categoryId: current.id, name: current.name },
          newValue: { categoryId: current.id, name: category.name },
        });
        return toArticleCategoryView(category);
      }),
    );
  }

  /** The store's articles by name, filtered by category, availability, or name. */
  async articles(
    storeId: string,
    query: ListArticlesQueryDto,
  ): Promise<Paginated<ArticleView>> {
    const where: Prisma.ArticleWhereInput = {
      storeId,
      categoryId: query.categoryId,
      available:
        query.available === undefined ? undefined : query.available === 'true',
      ...(query.q && {
        name: { contains: escapeLike(query.q), mode: 'insensitive' },
      }),
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [articles, total] = await this.prisma.$transaction(
      [
        this.prisma.article.findMany({
          where,
          include: ARTICLE_INCLUDE,
          orderBy: [...ARTICLES_ORDER],
          ...toSkipTake(query),
        }),
        this.prisma.article.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(articles.map(toArticleView), total, query);
  }

  /** One article of this store; another store's article is a 404. */
  async article(storeId: string, articleId: string): Promise<ArticleView> {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, storeId },
      include: ARTICLE_INCLUDE,
    });
    if (!article) {
      throw articleNotFound();
    }
    return toArticleView(article);
  }

  /** Creates an article with its first price history row, in one transaction. */
  async createArticle(
    storeId: string,
    actor: AuthenticatedUser,
    dto: CreateArticleDto,
  ): Promise<ArticleView> {
    return this.unique(articleExists, () =>
      this.prisma.$transaction(async (tx) => {
        await lockStoreNotClosed(tx, storeId);
        await this.storeCategory(tx, storeId, dto.categoryId);
        const price = parseAmount(dto.price);
        const article = await tx.article.create({
          data: {
            storeId,
            categoryId: dto.categoryId,
            name: dto.name,
            unit: dto.unit,
            currentPrice: price,
            available: dto.available ?? true,
            // The API clock, as for every later price change (F-04): the
            // history order never mixes the database and API clocks.
            prices: { create: { price, startsAt: new Date() } },
          },
          include: ARTICLE_INCLUDE,
        });
        await this.log(tx, storeId, actor, {
          action: ActivityAction.ARTICLE_CREATED,
          newValue: {
            articleId: article.id,
            name: article.name,
            categoryId: article.categoryId,
            unit: article.unit,
            price: formatAmount(price),
            available: article.available,
          },
        });
        return toArticleView(article);
      }),
    );
  }

  /**
   * Changes the name, category, unit, or availability; the log keeps the old
   * and new values of what changed. The article row is locked first, so two
   * simultaneous changes log what each really replaced.
   */
  async updateArticle(
    storeId: string,
    actor: AuthenticatedUser,
    articleId: string,
    dto: UpdateArticleDto,
  ): Promise<ArticleView> {
    const changes = {
      name: dto.name,
      categoryId: dto.categoryId,
      unit: dto.unit,
      available: dto.available,
    };
    if (Object.values(changes).every((value) => value === undefined)) {
      throw nothingToUpdate();
    }
    return this.unique(articleExists, () =>
      this.prisma.$transaction(async (tx) => {
        await lockStoreNotClosed(tx, storeId);
        const current = await this.lockArticle(tx, storeId, articleId);
        if (dto.categoryId !== undefined) {
          await this.storeCategory(tx, storeId, dto.categoryId);
        }
        // Only the fields whose value really changes are written and logged.
        const oldValue: Record<string, string | boolean> = {};
        const newValue: Record<string, string | boolean> = {};
        for (const field of [
          'name',
          'categoryId',
          'unit',
          'available',
        ] as const) {
          const value = changes[field];
          if (value !== undefined && value !== current[field]) {
            oldValue[field] = current[field];
            newValue[field] = value;
          }
        }
        // Nothing changes: no write, so no log row (F-06).
        if (Object.keys(newValue).length === 0) {
          return toArticleView(current);
        }
        const article = await tx.article.update({
          where: { id: articleId },
          data: newValue,
          include: ARTICLE_INCLUDE,
        });
        await this.log(tx, storeId, actor, {
          action: ActivityAction.ARTICLE_UPDATED,
          // current.id, not the URL's spelling: ids are logged in lowercase.
          oldValue: { articleId: current.id, ...oldValue },
          newValue: { articleId: current.id, ...newValue },
        });
        return toArticleView(article);
      }),
    );
  }

  /**
   * Changes the price of the day, at once (user decision, 2026-10-23): the new
   * `currentPrice` and its price history row land together, under the article
   * lock, so the newest history row is always the current price.
   */
  async changePrice(
    storeId: string,
    actor: AuthenticatedUser,
    articleId: string,
    dto: ChangePriceDto,
  ): Promise<ArticleView> {
    const price = parseAmount(dto.price);
    return this.prisma.$transaction(async (tx) => {
      await lockStoreNotClosed(tx, storeId);
      const current = await this.lockArticle(tx, storeId, articleId);
      if (current.currentPrice === price) {
        throw priceUnchanged(
          formatAmount(price),
          current.store.country.currencyCode,
        );
      }
      const article = await tx.article.update({
        where: { id: articleId },
        data: { currentPrice: price },
        include: ARTICLE_INCLUDE,
      });
      // Taken after the lock, not the database's now() (the transaction's
      // start): a change that waited for another one starts after it.
      await tx.priceHistory.create({
        data: { articleId, price, startsAt: new Date() },
      });
      await this.log(tx, storeId, actor, {
        action: ActivityAction.ARTICLE_PRICE_CHANGED,
        oldValue: {
          articleId: current.id,
          price: formatAmount(current.currentPrice),
        },
        newValue: { articleId: current.id, price: formatAmount(price) },
      });
      return toArticleView(article);
    });
  }

  /** The prices an article of this store has had, newest first. */
  async priceHistory(
    storeId: string,
    articleId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<PriceHistoryEntry>> {
    const where = { articleId, article: { storeId } };
    // REPEATABLE READ: the article check, the page and the total come from
    // the same snapshot.
    const [article, prices, total] = await this.prisma.$transaction(
      [
        this.prisma.article.findFirst({
          where: { id: articleId, storeId },
          select: { id: true },
        }),
        this.prisma.priceHistory.findMany({
          where,
          orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.priceHistory.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    if (!article) {
      throw articleNotFound();
    }
    return paginated(prices.map(toPriceHistoryEntry), total, query);
  }

  /**
   * Locks one article of this store `FOR UPDATE` and returns it; another
   * store's article is a 404.
   */
  private async lockArticle(tx: Tx, storeId: string, articleId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "articles"
      WHERE "id" = ${articleId}::uuid AND "storeId" = ${storeId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw articleNotFound();
    }
    return tx.article.findUniqueOrThrow({
      where: { id: articleId },
      include: ARTICLE_INCLUDE,
    });
  }

  /**
   * Locks one category of this store `FOR UPDATE` and returns it; another
   * store's category is a 404. A second rename waits, then reads the name the
   * first one wrote, so each log row records what it really replaced (F-08).
   */
  private async lockCategory(tx: Tx, storeId: string, categoryId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "article_categories"
      WHERE "id" = ${categoryId}::uuid AND "storeId" = ${storeId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) {
      throw categoryNotFound();
    }
    return tx.articleCategory.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  /** A category must belong to this store: another store's is a 404. */
  private async storeCategory(tx: Tx, storeId: string, categoryId: string) {
    const category = await tx.articleCategory.findFirst({
      where: { id: categoryId, storeId },
      select: { id: true },
    });
    if (!category) {
      throw categoryNotFound();
    }
  }

  /**
   * One of the customer's accounts (its store and balance): the account is
   * looked up with the session user as its customer, anything else is a 404.
   */
  private async ownAccount(
    userId: string,
    accountId: string,
  ): Promise<{ storeId: string; balance: bigint }> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: userId },
      select: { storeId: true, balance: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    return account;
  }

  /**
   * Runs a change and turns a unique violation (P2002, a name already used in
   * the store) into its 409. Caught rather than checked first, so two
   * simultaneous changes cannot both pass; outside the transaction, which the
   * violation has already aborted.
   */
  private async unique<T>(
    conflict: () => Error,
    change: () => Promise<T>,
  ): Promise<T> {
    try {
      return await change();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw conflict();
      }
      throw error;
    }
  }

  private log(
    tx: Tx,
    storeId: string,
    actor: AuthenticatedUser,
    entry: {
      action: ActivityAction;
      oldValue?: Prisma.InputJsonValue;
      newValue?: Prisma.InputJsonValue;
    },
  ) {
    return tx.activityLog.create({
      data: {
        storeId,
        userId: actor.userId,
        action: entry.action,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        device: actor.deviceId,
      },
    });
  }
}
