import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { formatAmount } from '../../common/money.js';
import {
  AdminAlertType,
  type Account,
  type Admin,
  type AdminAlert,
  type Goal,
  type HardwareStore,
  type MaterialOrder,
} from '../../generated/prisma/client.js';

export const ALERT_STATUSES = ['open', 'resolved', 'all'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export class AdminAlertsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'open (à traiter, par défaut), resolved (traitées) ou all (toutes)',
    enum: ALERT_STATUSES,
    default: 'open',
  })
  @IsOptional()
  @IsIn(ALERT_STATUSES, {
    message: 'Le statut doit être open, resolved ou all',
  })
  status?: AlertStatus;

  @ApiPropertyOptional({ enum: AdminAlertType })
  @IsOptional()
  @IsEnum(AdminAlertType, { message: 'Type d’alerte inconnu' })
  type?: AdminAlertType;
}

export class AdminAlertStore {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;
}

export class AdminAlertAccount {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'C-000123' })
  number: string;
}

export class AdminAlertGoal {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Ciment' })
  label: string;
}

export class AdminAlertOrder {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'B-00042' })
  reference: string;
}

export class AdminAlertResolver {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Awa' })
  firstName: string;

  @ApiProperty({ example: 'Diallo' })
  lastName: string;
}

/** An alert as admins read it: never a balance, only the gap. */
export class AdminAlertView {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({
    description:
      'ACCOUNT_BALANCE_GAP (le solde du compte ne correspond pas à ses opérations), GOAL_BALANCE_GAP (le solde d’un objectif ne correspond pas à ses opérations et mouvements), GOAL_SUM_GAP (les objectifs ne totalisent pas le solde du compte), ORDER_CANCELLATION_UNANSWERED (une demande d’annulation d’un client est restée sans réponse du gérant)',
    enum: AdminAlertType,
  })
  type: AdminAlertType;

  @ApiProperty({ type: AdminAlertStore })
  store: AdminAlertStore;

  @ApiProperty({ type: AdminAlertAccount })
  account: AdminAlertAccount;

  @ApiProperty({
    description: 'L’objectif, pour GOAL_BALANCE_GAP',
    type: AdminAlertGoal,
    nullable: true,
  })
  goal: AdminAlertGoal | null;

  @ApiProperty({
    description: 'Le bon, pour ORDER_CANCELLATION_UNANSWERED',
    type: AdminAlertOrder,
    nullable: true,
  })
  order: AdminAlertOrder | null;

  @ApiProperty({
    description:
      'Écart des alertes de solde : solde enregistré moins solde recalculé, en plus petite unité de la devise (peut être négatif) ; null pour les autres',
    type: String,
    nullable: true,
    example: '300',
  })
  difference: string | null;

  @ApiProperty({ example: '2026-11-06T02:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  resolvedAt: string | null;

  @ApiProperty({ type: AdminAlertResolver, nullable: true })
  resolvedBy: AdminAlertResolver | null;
}

export const ADMIN_ALERT_INCLUDE = {
  store: { select: { id: true, name: true } },
  account: { select: { id: true, number: true } },
  goal: { select: { id: true, label: true } },
  order: { select: { id: true, reference: true } },
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

type AlertWithRelations = AdminAlert & {
  store: Pick<HardwareStore, 'id' | 'name'>;
  account: Pick<Account, 'id' | 'number'>;
  goal: Pick<Goal, 'id' | 'label'> | null;
  order: Pick<MaterialOrder, 'id' | 'reference'> | null;
  resolvedBy: Pick<Admin, 'id' | 'firstName' | 'lastName'> | null;
};

export function toAdminAlertView(alert: AlertWithRelations): AdminAlertView {
  return {
    id: alert.id,
    type: alert.type,
    store: { id: alert.store.id, name: alert.store.name },
    account: { id: alert.account.id, number: alert.account.number },
    goal: alert.goal ? { id: alert.goal.id, label: alert.goal.label } : null,
    order: alert.order
      ? { id: alert.order.id, reference: alert.order.reference }
      : null,
    difference:
      alert.difference === null ? null : formatAmount(alert.difference),
    createdAt: alert.createdAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    resolvedBy: alert.resolvedBy
      ? {
          id: alert.resolvedBy.id,
          firstName: alert.resolvedBy.firstName,
          lastName: alert.resolvedBy.lastName,
        }
      : null,
  };
}
