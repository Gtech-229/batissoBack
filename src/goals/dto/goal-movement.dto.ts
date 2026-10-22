import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { formatAmount, IsAmount } from '../../common/money.js';
import {
  GoalMovementReason,
  type Goal,
  type GoalMovement,
} from '../../generated/prisma/client.js';

const ID_EXAMPLE = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

export class MoveBetweenGoalsDto {
  @ApiProperty({
    description: 'Objectif d’où part l’argent',
    example: ID_EXAMPLE,
  })
  @IsUUID('all', { message: 'Identifiant d’objectif invalide' })
  sourceGoalId: string;

  @ApiProperty({
    description: 'Objectif qui reçoit l’argent',
    example: ID_EXAMPLE,
  })
  @IsUUID('all', { message: 'Identifiant d’objectif invalide' })
  targetGoalId: string;

  // What the source holds is checked in the service, under the account lock.
  @ApiProperty({
    description: 'Montant déplacé, en unités de la devise, en texte',
    example: '20000',
  })
  @IsAmount()
  amount: string;
}

export class MovementGoalView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ example: 'Ciment' })
  label: string;
}

/** One movement between two goals of an account. */
export class GoalMovementView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({ type: MovementGoalView })
  sourceGoal: MovementGoalView;

  @ApiProperty({ type: MovementGoalView })
  targetGoal: MovementGoalView;

  @ApiProperty({ description: 'Montant déplacé, en texte', example: '20000' })
  amount: string;

  @ApiProperty({
    description:
      '`MOVE` : déplacé par le client ; `GOAL_CLOSED` : retourné dans « Non affecté » à la fermeture d’un objectif',
    enum: GoalMovementReason,
    example: GoalMovementReason.MOVE,
  })
  reason: GoalMovementReason;

  @ApiProperty({ example: '2026-10-22T10:00:00.000Z' })
  createdAt: Date;
}

/** Prisma include for `toGoalMovementView`. */
export const MOVEMENT_INCLUDE = {
  sourceGoal: { select: { id: true, label: true } },
  targetGoal: { select: { id: true, label: true } },
} as const;

/** Never the idempotency key, the device, or the author's id. */
export function toGoalMovementView(
  movement: GoalMovement & {
    sourceGoal: Pick<Goal, 'id' | 'label'>;
    targetGoal: Pick<Goal, 'id' | 'label'>;
  },
): GoalMovementView {
  return {
    id: movement.id,
    sourceGoal: {
      id: movement.sourceGoal.id,
      label: movement.sourceGoal.label,
    },
    targetGoal: {
      id: movement.targetGoal.id,
      label: movement.targetGoal.label,
    },
    amount: formatAmount(movement.amount),
    reason: movement.reason,
    createdAt: movement.createdAt,
  };
}
