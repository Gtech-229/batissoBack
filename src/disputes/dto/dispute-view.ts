import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import {
  DisputeAuthor,
  DisputeStatus,
  OperationDirection,
  OperationType,
  type Account,
  type Dispute,
  type DisputeMessage,
  type HardwareStore,
  type Operation,
  type Prisma,
} from '../../generated/prisma/client.js';

const ID_EXAMPLE = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
const DATE_EXAMPLE = '2026-10-29T10:00:00.000Z';

/** The operation a dispute is about, as its receipt names it. */
export class DisputedOperationView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Référence de l’opération', example: 'D-00482' })
  reference: string;

  @ApiProperty({ enum: OperationType, example: OperationType.DEPOSIT })
  type: OperationType;

  @ApiProperty({ enum: OperationDirection, example: OperationDirection.CREDIT })
  direction: OperationDirection;

  @ApiProperty({
    description: 'Montant, en unités de la devise, en texte',
    example: '5000',
  })
  amount: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ description: 'Date de l’opération', example: DATE_EXAMPLE })
  createdAt: Date;
}

export class DisputeAccountView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ description: 'Numéro du compte', example: 'C-000123' })
  number: string;
}

export class DisputeStoreView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;
}

/** One message of the thread, as the customer sees it: never who in the store. */
export class MyDisputeMessageView {
  @ApiProperty({
    description: '`CUSTOMER` : vous ; `STORE` : la quincaillerie',
    enum: DisputeAuthor,
    example: DisputeAuthor.CUSTOMER,
  })
  author: DisputeAuthor;

  @ApiProperty({
    description: 'Le message, en texte simple',
    example: 'Je n’ai versé que 500 F ce jour-là.',
  })
  body: string;

  @ApiProperty({ example: DATE_EXAMPLE })
  createdAt: Date;
}

/** What both views share. */
export class DisputeFields {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({
    description:
      '`OPEN` : en attente de la quincaillerie ; `ANSWERED` : en attente du client ; `CLOSED` : close par le client',
    enum: DisputeStatus,
    example: DisputeStatus.OPEN,
  })
  status: DisputeStatus;

  @ApiProperty({ type: DisputedOperationView })
  operation: DisputedOperationView;

  @ApiProperty({ type: DisputeAccountView })
  account: DisputeAccountView;

  @ApiProperty({ type: DisputeStoreView })
  store: DisputeStoreView;

  @ApiProperty({ description: 'Date d’ouverture', example: DATE_EXAMPLE })
  createdAt: Date;

  @ApiProperty({
    description: 'Date du dernier changement',
    example: DATE_EXAMPLE,
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Date de clôture, ou `null`',
    example: null,
    nullable: true,
    type: Date,
  })
  closedAt: Date | null;
}

/** The customer's view of their dispute: the thread, the store, no staff identity. */
export class MyDisputeView extends DisputeFields {
  @ApiProperty({
    description: 'Les messages, du plus ancien au plus récent',
    type: [MyDisputeMessageView],
  })
  messages: MyDisputeMessageView[];
}

/** Messages oldest first (uuid v7 ids break ties within one millisecond). */
export const DISPUTE_MESSAGES_ORDER = {
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
} satisfies Prisma.Dispute$messagesArgs;

/** What `toMyDisputeView` needs: never the staff who wrote. */
export const MY_DISPUTE_INCLUDE = {
  operation: true,
  account: { select: { id: true, number: true } },
  store: { select: { id: true, name: true } },
  messages: DISPUTE_MESSAGES_ORDER,
} satisfies Prisma.DisputeInclude;

export type DisputeWithFields = Dispute & {
  operation: Operation;
  account: Pick<Account, 'id' | 'number'>;
  store: Pick<HardwareStore, 'id' | 'name'>;
};

/** Money as a string; ids of people never leave. */
export function toDisputeFields(
  dispute: DisputeWithFields,
): Omit<MyDisputeView, 'messages'> {
  return {
    id: dispute.id,
    status: dispute.status,
    operation: {
      id: dispute.operation.id,
      reference: dispute.operation.reference,
      type: dispute.operation.type,
      direction: dispute.operation.direction,
      amount: formatAmount(dispute.operation.amount),
      currencyCode: dispute.operation.currencyCode,
      createdAt: dispute.operation.createdAt,
    },
    account: { id: dispute.account.id, number: dispute.account.number },
    store: { id: dispute.store.id, name: dispute.store.name },
    createdAt: dispute.createdAt,
    updatedAt: dispute.updatedAt,
    closedAt: dispute.closedAt,
  };
}

export function toMyDisputeView(
  dispute: DisputeWithFields & { messages: DisputeMessage[] },
): MyDisputeView {
  return {
    ...toDisputeFields(dispute),
    messages: dispute.messages.map((message) => ({
      author: message.author,
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}

/** A person named in the staff view: names only, never a phone or an id. */
export class DisputePersonView {
  @ApiProperty({ example: 'Fanta' })
  firstName: string;

  @ApiProperty({ example: 'Keita' })
  lastName: string;
}

/** One message of the thread, as the store sees it: who in the store wrote it. */
export class DisputeMessageView extends MyDisputeMessageView {
  @ApiProperty({
    description:
      'Qui l’a écrit : le client, ou le membre de l’équipe pour `STORE`',
    type: DisputePersonView,
  })
  authorName: DisputePersonView;
}

/** The store's view of a dispute: the customer, and who in the team wrote. */
export class DisputeView extends DisputeFields {
  @ApiProperty({ description: 'Titulaire du compte', type: DisputePersonView })
  customer: DisputePersonView;

  @ApiProperty({
    description: 'Les messages, du plus ancien au plus récent',
    type: [DisputeMessageView],
  })
  messages: DisputeMessageView[];
}

/** What `toDisputeView` needs. */
export const DISPUTE_INCLUDE = {
  operation: true,
  account: {
    select: {
      id: true,
      number: true,
      customer: { select: { firstName: true, lastName: true } },
    },
  },
  store: { select: { id: true, name: true } },
  messages: {
    ...DISPUTE_MESSAGES_ORDER,
    include: { authorUser: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.DisputeInclude;

type Person = { firstName: string; lastName: string };

export function toDisputeView(
  dispute: DisputeWithFields & {
    account: { customer: Person };
    messages: (DisputeMessage & { authorUser: Person })[];
  },
): DisputeView {
  const person = ({ firstName, lastName }: Person) => ({ firstName, lastName });
  return {
    ...toDisputeFields(dispute),
    customer: person(dispute.account.customer),
    messages: dispute.messages.map((message) => ({
      author: message.author,
      authorName: person(message.authorUser),
      body: message.body,
      createdAt: message.createdAt,
    })),
  };
}
