import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import {
  OperationChannel,
  OperationDirection,
  OperationStatus,
  OperationType,
  type Account,
  type Goal,
  type HardwareStore,
  type Operation,
  type Prisma,
  type User,
} from '../../generated/prisma/client.js';

const ID_EXAMPLE = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

export class ReceiptGoalView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Libellé de l’objectif', example: 'Non affecté' })
  label: string;
}

export class ReceiptAccountView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Numéro du compte', example: 'C-000123' })
  number: string;
}

export class ReceiptPersonView {
  @ApiProperty({ description: 'Prénom', example: 'Fanta' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Keita' })
  lastName: string;
}

export class ReceiptStoreView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;

  @ApiProperty({ example: 'Rue 12, Hippodrome' })
  address: string;

  @ApiProperty({ example: 'Bamako' })
  city: string;

  @ApiProperty({ description: 'Téléphone (E.164)', example: '+22320220000' })
  phone: string;
}

/** What the customer and the staff see of one operation: its receipt. */
export class OperationReceipt {
  @ApiProperty({
    description: 'Identifiant de l’opération',
    example: ID_EXAMPLE,
  })
  id: string;

  @ApiProperty({ description: 'Référence à communiquer', example: 'D-00482' })
  reference: string;

  @ApiProperty({ enum: OperationType, example: OperationType.DEPOSIT })
  type: OperationType;

  @ApiProperty({
    description: '`CREDIT` : ajoute au solde ; `DEBIT` : retire du solde',
    enum: OperationDirection,
    example: OperationDirection.CREDIT,
  })
  direction: OperationDirection;

  @ApiProperty({ enum: OperationStatus, example: OperationStatus.CONFIRMED })
  status: OperationStatus;

  @ApiProperty({ enum: OperationChannel, example: OperationChannel.CASH })
  channel: OperationChannel;

  @ApiProperty({
    description: 'Montant, en unités de la devise, en texte',
    example: '5000',
  })
  amount: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ description: 'Solde avant l’opération', example: '15000' })
  balanceBefore: string;

  @ApiProperty({ description: 'Solde après l’opération', example: '20000' })
  balanceAfter: string;

  @ApiProperty({ type: ReceiptGoalView })
  goal: ReceiptGoalView;

  @ApiProperty({ type: ReceiptAccountView })
  account: ReceiptAccountView;

  @ApiProperty({ description: 'Titulaire du compte', type: ReceiptPersonView })
  customer: ReceiptPersonView;

  @ApiProperty({ type: ReceiptStoreView })
  store: ReceiptStoreView;

  @ApiProperty({
    description: 'Membre de l’équipe qui a enregistré l’opération',
    type: ReceiptPersonView,
  })
  recordedBy: ReceiptPersonView;

  @ApiProperty({
    description: 'Date et heure du serveur',
    example: '2026-10-20T10:00:00.000Z',
  })
  createdAt: Date;
}

/** Prisma include for `toOperationReceipt`. */
export const RECEIPT_INCLUDE = {
  goal: true,
  account: { include: { customer: true } },
  store: true,
  author: true,
} satisfies Prisma.OperationInclude;

export type OperationWithReceipt = Operation & {
  goal: Goal;
  account: Account & { customer: User };
  store: HardwareStore;
  author: User;
};

/**
 * Public fields only: money as strings; never the idempotency key, the device,
 * or a person's id, phone, or PIN data.
 */
export function toOperationReceipt(
  operation: OperationWithReceipt,
): OperationReceipt {
  return {
    id: operation.id,
    reference: operation.reference,
    type: operation.type,
    direction: operation.direction,
    status: operation.status,
    channel: operation.channel,
    amount: formatAmount(operation.amount),
    currencyCode: operation.currencyCode,
    balanceBefore: formatAmount(operation.balanceBefore),
    balanceAfter: formatAmount(operation.balanceAfter),
    goal: { id: operation.goal.id, label: operation.goal.label },
    account: { id: operation.account.id, number: operation.account.number },
    customer: {
      firstName: operation.account.customer.firstName,
      lastName: operation.account.customer.lastName,
    },
    store: {
      id: operation.store.id,
      name: operation.store.name,
      address: operation.store.address,
      city: operation.store.city,
      phone: operation.store.phone,
    },
    recordedBy: {
      firstName: operation.author.firstName,
      lastName: operation.author.lastName,
    },
    createdAt: operation.createdAt,
  };
}
