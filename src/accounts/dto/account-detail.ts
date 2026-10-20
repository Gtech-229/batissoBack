import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import {
  AccountStatus,
  GoalStatus,
  type Account,
  type Goal,
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
    description: 'Date d’ouverture',
    example: '2026-10-14T10:00:00.000Z',
  })
  createdAt: Date;
}

/** An account with what its detail shows. */
export type AccountWithDetail = Account & {
  customer: User;
  openedBy: User;
  goals: Goal[];
};

/** Prisma include for `AccountWithDetail`: the system goal first, then by age. */
export const ACCOUNT_DETAIL_INCLUDE = {
  customer: true,
  openedBy: true,
  goals: { orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }] },
} satisfies Prisma.AccountInclude;

export function toGoalView(goal: Goal): GoalView {
  return {
    id: goal.id,
    label: goal.label,
    isSystem: goal.isSystem,
    targetAmount:
      goal.targetAmount === null ? null : formatAmount(goal.targetAmount),
    status: goal.status,
    balance: formatAmount(goal.balance),
  };
}

/**
 * Public fields only: amounts as strings; never a PIN hash, lockout state, or
 * internal foreign keys.
 */
export function toAccountDetail(account: AccountWithDetail): AccountDetail {
  return {
    ...toAccountFields(account),
    openedBy: {
      userId: account.openedBy.id,
      firstName: account.openedBy.firstName,
      lastName: account.openedBy.lastName,
    },
    // Whether there is a photo, never where it is.
    hasIdPhoto: account.idPhotoPath !== null,
  };
}

/** The detail without the staff-only fields: shared by the staff and customer views. */
export function toAccountFields(
  account: Account & { customer: User; goals: Goal[] },
): Omit<AccountDetail, 'openedBy' | 'hasIdPhoto'> {
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
    createdAt: account.createdAt,
  };
}
