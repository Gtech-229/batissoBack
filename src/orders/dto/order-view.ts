import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import {
  MaterialOrderStatus,
  OrderConfirmationChannel,
  type Account,
  type Goal,
  type MaterialOrder,
  type MaterialOrderLine,
  type Prisma,
  type User,
} from '../../generated/prisma/client.js';

const ID_EXAMPLE = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
const DATE_EXAMPLE = '2026-10-26T10:00:00.000Z';

export class OrderLineView {
  @ApiProperty({ description: 'Article', example: ID_EXAMPLE })
  articleId: string;

  @ApiProperty({
    description: 'Nom de l’article à la préparation',
    example: 'Ciment CPA 45',
  })
  articleName: string;

  @ApiProperty({
    description: 'Unité à la préparation',
    example: 'sac de 50 kg',
  })
  unit: string;

  @ApiProperty({ description: 'Nombre d’unités', example: 10 })
  quantity: number;

  @ApiProperty({
    description: 'Prix unitaire figé à la préparation, en texte',
    example: '5000',
  })
  unitPrice: string;

  @ApiProperty({
    description: 'Quantité × prix unitaire, en texte',
    example: '50000',
  })
  lineTotal: string;
}

export class OrderGoalView {
  @ApiProperty({ description: 'Objectif payé en premier', example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Libellé', example: 'Ciment' })
  label: string;
}

/** The fields the staff and the customer views share. */
export class OrderFields {
  @ApiProperty({ description: 'Identifiant du bon', example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Numéro du bon', example: 'B-00042' })
  reference: string;

  @ApiProperty({
    description: 'État',
    enum: MaterialOrderStatus,
    example: MaterialOrderStatus.AWAITING_CUSTOMER,
  })
  status: MaterialOrderStatus;

  @ApiProperty({ description: 'Compte', example: ID_EXAMPLE })
  accountId: string;

  @ApiProperty({ description: 'Numéro du compte', example: 'C-000123' })
  accountNumber: string;

  @ApiProperty({ description: 'Objectif payé en premier', type: OrderGoalView })
  goal: OrderGoalView;

  @ApiProperty({
    description: 'Total du bon, en unités de la devise, en texte',
    example: '50000',
  })
  total: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ description: 'Lignes du bon', type: [OrderLineView] })
  lines: OrderLineView[];

  @ApiProperty({
    description: 'Date de validation par le gérant, ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  validatedAt: Date | null;

  @ApiProperty({
    description:
      'Motif du refus du gérant, ou `null` ; le client le voit aussi dans ses bons',
    example: null,
    nullable: true,
    type: String,
  })
  refusalReason: string | null;

  @ApiProperty({
    description: 'Date du refus, ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  refusedAt: Date | null;

  @ApiProperty({
    description: 'Motif de l’annulation, ou `null`',
    example: null,
    nullable: true,
    type: String,
  })
  cancellationReason: string | null;

  @ApiProperty({
    description: 'Date de l’annulation, ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  cancelledAt: Date | null;

  @ApiProperty({
    description: 'Date de la confirmation du client, ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  confirmedAt: Date | null;

  @ApiProperty({
    description:
      'Comment le client a confirmé : code PIN dans l’application ou code reçu par SMS ; `null` avant la confirmation',
    enum: OrderConfirmationChannel,
    example: null,
    nullable: true,
  })
  confirmedVia: OrderConfirmationChannel | null;

  @ApiProperty({
    description:
      'Référence du débit écrit à la confirmation (A-00001), ou `null`',
    example: null,
    nullable: true,
    type: String,
  })
  debitReference: string | null;

  @ApiProperty({
    description: 'Date du refus du client, ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  customerRefusedAt: Date | null;

  @ApiProperty({
    description: 'Motif du refus du client, ou `null`',
    example: null,
    nullable: true,
    type: String,
  })
  customerRefusalReason: string | null;

  @ApiProperty({
    description: 'Date de la livraison (toujours complète), ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  deliveredAt: Date | null;

  @ApiProperty({
    description:
      'Référence de la correction qui a recrédité le montant quand le gérant a annulé le bon après débit (R-00001), ou `null`',
    example: null,
    nullable: true,
    type: String,
  })
  recreditReference: string | null;

  @ApiProperty({
    description:
      'Date à laquelle le client a demandé l’annulation du bon payé non livré, ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  cancellationRequestedAt: Date | null;

  @ApiProperty({
    description: 'Motif de la demande d’annulation du client, ou `null`',
    example: null,
    nullable: true,
    type: String,
  })
  cancellationRequestReason: string | null;

  @ApiProperty({ description: 'Date de préparation', example: DATE_EXAMPLE })
  createdAt: Date;
}

/** A member of the store's team who did one step of the order. */
export class OrderStaffView {
  @ApiProperty({ description: 'Identifiant', example: ID_EXAMPLE })
  userId: string;

  @ApiProperty({ description: 'Prénom', example: 'Moussa' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Traoré' })
  lastName: string;
}

/** The staff-only fields of the order view. */
type OrderStaffSteps = Pick<
  OrderView,
  'createdBy' | 'validatedBy' | 'refusedBy' | 'cancelledBy' | 'deliveredBy'
>;

/**
 * The staff view: who prepared, validated, refused, cancelled, or delivered
 * the order.
 */
export class OrderView extends OrderFields {
  @ApiProperty({ description: 'Préparé par', type: OrderStaffView })
  createdBy: OrderStaffView;

  @ApiProperty({
    description: 'Validé par (le gérant), ou `null`',
    nullable: true,
    type: OrderStaffView,
  })
  validatedBy: OrderStaffView | null;

  @ApiProperty({
    description: 'Refusé par (le gérant), ou `null`',
    nullable: true,
    type: OrderStaffView,
  })
  refusedBy: OrderStaffView | null;

  @ApiProperty({
    description: 'Annulé par, ou `null`',
    nullable: true,
    type: OrderStaffView,
  })
  cancelledBy: OrderStaffView | null;

  @ApiProperty({
    description: 'Livré par, ou `null`',
    nullable: true,
    type: OrderStaffView,
  })
  deliveredBy: OrderStaffView | null;
}

/** Lines in the order they were sent (uuid v7 ids are time-ordered). */
export const ORDER_LINES_ORDER = {
  orderBy: { id: 'asc' },
} satisfies Prisma.MaterialOrder$linesArgs;

/** What `toOrderView` needs. */
export const ORDER_INCLUDE = {
  account: { select: { number: true, currencyCode: true } },
  goal: { select: { id: true, label: true } },
  lines: ORDER_LINES_ORDER,
  operation: { select: { reference: true } },
  recreditOperation: { select: { reference: true } },
  createdBy: true,
  validatedBy: true,
  refusedBy: true,
  cancelledBy: true,
  deliveredBy: true,
} satisfies Prisma.MaterialOrderInclude;

export type OrderWithFields = MaterialOrder & {
  account: Pick<Account, 'number' | 'currencyCode'>;
  goal: Pick<Goal, 'id' | 'label'>;
  lines: MaterialOrderLine[];
  operation: { reference: string } | null;
  recreditOperation: { reference: string } | null;
};

export type OrderWithStaff = OrderWithFields & {
  createdBy: User;
  validatedBy: User | null;
  refusedBy: User | null;
  cancelledBy: User | null;
  deliveredBy: User | null;
};

function toLineView(line: MaterialOrderLine): OrderLineView {
  return {
    articleId: line.articleId,
    articleName: line.articleName,
    unit: line.unit,
    quantity: line.quantity,
    unitPrice: formatAmount(line.unitPrice),
    lineTotal: formatAmount(BigInt(line.quantity) * line.unitPrice),
  };
}

/** Money as strings; no staff identity (shared with the customer view). */
export function toOrderFields(
  order: OrderWithFields,
): Omit<OrderView, keyof OrderStaffSteps> {
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    accountId: order.accountId,
    accountNumber: order.account.number,
    goal: { id: order.goal.id, label: order.goal.label },
    total: formatAmount(order.total),
    currencyCode: order.account.currencyCode,
    lines: order.lines.map(toLineView),
    validatedAt: order.validatedAt,
    refusalReason: order.refusalReason,
    refusedAt: order.refusedAt,
    cancellationReason: order.cancellationReason,
    cancelledAt: order.cancelledAt,
    confirmedAt: order.confirmedAt,
    confirmedVia: order.confirmedVia,
    debitReference: order.operation?.reference ?? null,
    customerRefusedAt: order.customerRefusedAt,
    customerRefusalReason: order.customerRefusalReason,
    deliveredAt: order.deliveredAt,
    recreditReference: order.recreditOperation?.reference ?? null,
    cancellationRequestedAt: order.cancellationRequestedAt,
    cancellationRequestReason: order.cancellationRequestReason,
    createdAt: order.createdAt,
  };
}

/** Names only: never a phone, a PIN, or other account data of the staff. */
function toStaffView(user: User): OrderStaffView;
function toStaffView(user: User | null): OrderStaffView | null;
function toStaffView(user: User | null): OrderStaffView | null {
  return user === null
    ? null
    : { userId: user.id, firstName: user.firstName, lastName: user.lastName };
}

export function toOrderView(order: OrderWithStaff): OrderView {
  return {
    ...toOrderFields(order),
    createdBy: toStaffView(order.createdBy),
    validatedBy: toStaffView(order.validatedBy),
    refusedBy: toStaffView(order.refusedBy),
    cancelledBy: toStaffView(order.cancelledBy),
    deliveredBy: toStaffView(order.deliveredBy),
  };
}
