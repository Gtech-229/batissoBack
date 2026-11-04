import { ApiProperty } from '@nestjs/swagger';
import { materialEquivalence } from '../../catalogue/equivalence.js';
import { formatAmount } from '../../common/money.js';
import {
  AccountStatus,
  GoalStatus,
  type Account,
  type Article,
  type Goal,
  type Project,
  type Prisma,
  type User,
} from '../../generated/prisma/client.js';

const ID_EXAMPLE = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

export class AccountCustomerView {
  @ApiProperty({ description: 'Identifiant du client', example: ID_EXAMPLE })
  userId: string;

  @ApiProperty({ description: 'Prénom', example: 'Fanta' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Keita' })
  lastName: string;

  @ApiProperty({ description: 'Téléphone (E.164)', example: '+22376445566' })
  phone: string;
}

export class BeneficiaryView {
  @ApiProperty({ description: 'Nom complet', example: 'Ali Keita' })
  name: string;

  @ApiProperty({
    description: 'Téléphone (E.164), ou `null`',
    example: '+22376778899',
    nullable: true,
    type: String,
  })
  phone: string | null;
}

/** The article a goal saves for, at the price of the day. */
export class GoalArticleView {
  @ApiProperty({ description: 'Identifiant de l’article', example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Nom', example: 'Ciment CPA 45' })
  name: string;

  @ApiProperty({ description: 'Unité de vente', example: 'sac de 50 kg' })
  unit: string;

  @ApiProperty({
    description: 'Prix du jour, en unités de la devise, en texte',
    example: '5000',
  })
  unitPrice: string;

  @ApiProperty({
    description:
      'En vente ; un article retiré de la vente reste lié aux objectifs qui l’avaient choisi',
    example: true,
  })
  available: boolean;
}

/** A goal's balance shown as material (feature 9). */
export class GoalEquivalence {
  @ApiProperty({ description: 'Article de l’objectif', type: GoalArticleView })
  article: GoalArticleView;

  @ApiProperty({
    description:
      'Unités entières que le solde de l’objectif achète au prix du jour, en texte',
    example: '6',
  })
  quantity: string;

  @ApiProperty({
    description:
      'Unités entières que le montant visé achète au prix du jour, en texte',
    example: '30',
    nullable: true,
    type: String,
  })
  targetQuantity: string | null;
}

export class GoalView {
  @ApiProperty({
    description: 'Identifiant de l’objectif',
    example: ID_EXAMPLE,
  })
  id: string;

  @ApiProperty({ description: 'Libellé', example: 'Non affecté' })
  label: string;

  @ApiProperty({
    description:
      '`true` pour l’objectif « Non affecté », créé à l’ouverture, jamais renommé ni supprimé',
    example: true,
  })
  isSystem: boolean;

  @ApiProperty({
    description:
      'Montant visé, en unités de la devise, en texte ; `null` pour « Non affecté »',
    example: null,
    nullable: true,
    type: String,
  })
  targetAmount: string | null;

  @ApiProperty({
    description: 'État',
    enum: GoalStatus,
    example: GoalStatus.IN_PROGRESS,
  })
  status: GoalStatus;

  @ApiProperty({
    description:
      'Solde de l’objectif, en unités de la devise, en texte ; les objectifs d’un compte totalisent son solde',
    example: '20000',
  })
  balance: string;

  @ApiProperty({
    description: 'Projet de l’objectif, ou `null` (objectif hors projet)',
    example: null,
    nullable: true,
    type: String,
  })
  projectId: string | null;

  @ApiProperty({
    description:
      'Date à laquelle le solde a atteint le montant visé (état `REACHED`), ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  reachedAt: Date | null;

  @ApiProperty({
    description:
      'Équivalence en matériaux, ou `null` si l’objectif n’est lié à aucun article',
    nullable: true,
    type: GoalEquivalence,
  })
  equivalence: GoalEquivalence | null;
}

/** A construction project of the account, grouping goals. */
export class ProjectView {
  @ApiProperty({ description: 'Identifiant du projet', example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Nom du projet', example: 'Ma maison' })
  name: string;

  @ApiProperty({ example: '2026-10-22T10:00:00.000Z' })
  createdAt: Date;
}

export class AccountOpenerView {
  @ApiProperty({
    description: 'Identifiant du membre de l’équipe',
    example: ID_EXAMPLE,
  })
  userId: string;

  @ApiProperty({ description: 'Prénom', example: 'Moussa' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Traoré' })
  lastName: string;
}

export class AccountDetail {
  @ApiProperty({ description: 'Identifiant du compte', example: ID_EXAMPLE })
  id: string;

  @ApiProperty({
    description: 'Numéro du compte, pour l’affichage et la recherche',
    example: 'C-000123',
  })
  number: string;

  @ApiProperty({
    description: 'État',
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
  })
  status: AccountStatus;

  @ApiProperty({
    description: 'Solde, en unités de la devise, en texte',
    example: '0',
  })
  balance: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ description: 'Titulaire', type: AccountCustomerView })
  customer: AccountCustomerView;

  @ApiProperty({
    description: 'Bénéficiaire, ou `null`',
    type: BeneficiaryView,
    nullable: true,
  })
  beneficiary: BeneficiaryView | null;

  @ApiProperty({
    description: 'Date d’acceptation des conditions de la quincaillerie',
    example: '2026-10-14T10:00:00.000Z',
  })
  termsAcceptedAt: Date;

  @ApiProperty({
    description: 'Objectifs, « Non affecté » en premier',
    type: [GoalView],
  })
  goals: GoalView[];

  @ApiProperty({
    description:
      'Projets du compte (les objectifs y renvoient par `projectId`)',
    type: [ProjectView],
  })
  projects: ProjectView[];

  @ApiProperty({
    description: 'Membre de l’équipe qui a ouvert le compte',
    type: AccountOpenerView,
  })
  openedBy: AccountOpenerView;

  @ApiProperty({
    description:
      '`true` quand une photo d’identité est enregistrée (à lire sur la route de la photo)',
    example: false,
  })
  hasIdPhoto: boolean;

  @ApiProperty({
    description:
      'Motif de la suspension par un administrateur, null si le compte est actif. Pour le personnel : le client ne le voit jamais.',
    type: String,
    nullable: true,
    example: null,
  })
  statusReason: string | null;

  @ApiProperty({
    description: 'Date d’ouverture',
    example: '2026-10-14T10:00:00.000Z',
  })
  createdAt: Date;
}

/** An account with what its detail shows. */
export type AccountWithDetail = Account & {
  customer: User;
  openedBy: User;
  goals: GoalWithArticle[];
  projects: Project[];
};

/** A goal with the article it saves for, if any: what `toGoalView` needs. */
export type GoalWithArticle = Goal & { article: Article | null };

/** Prisma include for `GoalWithArticle`. */
export const GOAL_INCLUDE = { article: true } satisfies Prisma.GoalInclude;

/** Goals in display order (the system goal first, then by age), with their article. */
export const GOALS_ORDER = {
  include: GOAL_INCLUDE,
  orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
} satisfies Prisma.Account$goalsArgs;

/** Projects by age. */
export const PROJECTS_ORDER = {
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
} satisfies Prisma.Account$projectsArgs;

/** Prisma include for `AccountWithDetail`. */
export const ACCOUNT_DETAIL_INCLUDE = {
  customer: true,
  openedBy: true,
  goals: GOALS_ORDER,
  projects: PROJECTS_ORDER,
} satisfies Prisma.AccountInclude;

export function toGoalView(goal: GoalWithArticle): GoalView {
  return {
    id: goal.id,
    label: goal.label,
    isSystem: goal.isSystem,
    targetAmount:
      goal.targetAmount === null ? null : formatAmount(goal.targetAmount),
    status: goal.status,
    balance: formatAmount(goal.balance),
    projectId: goal.projectId,
    reachedAt: goal.reachedAt,
    equivalence:
      goal.article === null ? null : toGoalEquivalence(goal, goal.article),
  };
}

function toGoalEquivalence(goal: Goal, article: Article): GoalEquivalence {
  const { quantity, targetQuantity } = materialEquivalence(
    goal.balance,
    goal.targetAmount,
    article.currentPrice,
  );
  return {
    article: {
      id: article.id,
      name: article.name,
      unit: article.unit,
      unitPrice: formatAmount(article.currentPrice),
      available: article.available,
    },
    quantity: quantity.toString(),
    targetQuantity: targetQuantity === null ? null : targetQuantity.toString(),
  };
}

export function toProjectView(project: Project): ProjectView {
  return { id: project.id, name: project.name, createdAt: project.createdAt };
}

/**
 * Public fields only: amounts as strings; never a PIN hash, lockout state, or
 * internal foreign keys.
 */
/**
 * The suspension reason for a staff reader, never for the account's own
 * customer, even when they work in the store (F-43).
 */
export function reasonFor(
  account: Pick<Account, 'customerId' | 'statusReason'>,
  viewerId: string,
): string | null {
  return account.customerId === viewerId ? null : account.statusReason;
}

/** `viewerId`: the session user, so their own account never shows the reason. */
export function toAccountDetail(
  account: AccountWithDetail,
  viewerId: string,
): AccountDetail {
  return {
    ...toAccountFields(account),
    openedBy: {
      userId: account.openedBy.id,
      firstName: account.openedBy.firstName,
      lastName: account.openedBy.lastName,
    },
    // Whether there is a photo, never where it is.
    hasIdPhoto: account.idPhotoPath !== null,
    statusReason: reasonFor(account, viewerId),
  };
}

/** The detail without the staff-only fields: shared by the staff and customer views. */
export function toAccountFields(
  account: Account & {
    customer: User;
    goals: GoalWithArticle[];
    projects: Project[];
  },
): Omit<AccountDetail, 'openedBy' | 'hasIdPhoto' | 'statusReason'> {
  return {
    id: account.id,
    number: account.number,
    status: account.status,
    balance: formatAmount(account.balance),
    currencyCode: account.currencyCode,
    customer: {
      userId: account.customer.id,
      firstName: account.customer.firstName,
      lastName: account.customer.lastName,
      phone: account.customer.phone,
    },
    beneficiary:
      account.beneficiaryName === null
        ? null
        : { name: account.beneficiaryName, phone: account.beneficiaryPhone },
    termsAcceptedAt: account.termsAcceptedAt,
    goals: account.goals.map(toGoalView),
    projects: account.projects.map(toProjectView),
    createdAt: account.createdAt,
  };
}
