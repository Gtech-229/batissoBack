import { ApiProperty } from '@nestjs/swagger';
import { formatAmount } from '../../common/money.js';
import type {
  CashClosing,
  Prisma,
  User,
} from '../../generated/prisma/client.js';

const DATE_EXAMPLE = '2026-10-30T18:30:00.000Z';

/** What should be in the drawer now, before the manager counts. */
export class PendingCashView {
  @ApiProperty({
    description: 'Dépôts en espèces depuis la dernière clôture',
    example: '50000',
  })
  depositsTotal: string;

  @ApiProperty({
    description: 'Corrections de dépôts depuis la dernière clôture',
    example: '1500',
  })
  correctionsTotal: string;

  @ApiProperty({
    description:
      'Montant attendu en caisse : les dépôts moins les corrections (négatif si seule une correction a eu lieu)',
    example: '48500',
  })
  expectedTotal: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({
    description: 'Nombre d’opérations comptées',
    example: 12,
  })
  operationCount: number;

  @ApiProperty({
    description: 'Date de la dernière clôture, ou `null` pour la première',
    example: null,
    nullable: true,
    type: Date,
  })
  since: Date | null;
}

export class ClosingPersonView {
  @ApiProperty({ example: 'Awa' })
  firstName: string;

  @ApiProperty({ example: 'Diallo' })
  lastName: string;
}

/** A closing: never the idempotency key or the device. */
export class CashClosingView {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ description: 'Dépôts comptés', example: '50000' })
  depositsTotal: string;

  @ApiProperty({ description: 'Corrections comptées', example: '1500' })
  correctionsTotal: string;

  @ApiProperty({
    description: 'Montant attendu : les dépôts moins les corrections',
    example: '48500',
  })
  expectedTotal: string;

  @ApiProperty({ description: 'Montant compté', example: '48000' })
  countedTotal: string;

  @ApiProperty({
    description:
      'Écart : le compté moins l’attendu (négatif : il manque de l’argent)',
    example: '-500',
  })
  discrepancy: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({
    description: 'Justification de l’écart, ou `null`',
    example: 'Monnaie rendue en trop à un client',
    nullable: true,
    type: String,
  })
  justification: string | null;

  @ApiProperty({ description: 'Nombre d’opérations comptées', example: 12 })
  operationCount: number;

  @ApiProperty({ description: 'Clôturée par', type: ClosingPersonView })
  closedBy: ClosingPersonView;

  @ApiProperty({ description: 'Date de la clôture', example: DATE_EXAMPLE })
  createdAt: Date;
}

/** What `toCashClosingView` needs. */
export const CASH_CLOSING_INCLUDE = {
  manager: true,
  _count: { select: { operations: true } },
} satisfies Prisma.CashClosingInclude;

export function toCashClosingView(
  closing: CashClosing & {
    manager: User;
    _count: { operations: number };
  },
): CashClosingView {
  return {
    id: closing.id,
    depositsTotal: formatAmount(closing.depositsTotal),
    correctionsTotal: formatAmount(closing.correctionsTotal),
    expectedTotal: formatAmount(closing.expectedTotal),
    countedTotal: formatAmount(closing.countedTotal),
    discrepancy: formatAmount(closing.discrepancy),
    currencyCode: closing.currencyCode,
    justification: closing.justification,
    operationCount: closing._count.operations,
    closedBy: {
      firstName: closing.manager.firstName,
      lastName: closing.manager.lastName,
    },
    createdAt: closing.createdAt,
  };
}
