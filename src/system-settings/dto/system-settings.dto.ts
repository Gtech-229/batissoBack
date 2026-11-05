import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { SYSTEM_SETTINGS_LIMITS as LIMITS } from '../system-settings.service.js';

const ATTEMPTS = LIMITS.maxLoginAttempts;
const SESSIONS = LIMITS.maxAdminSessions;
const ATTEMPTS_MESSAGE = `Le nombre de tentatives doit être un entier entre ${ATTEMPTS.min} et ${ATTEMPTS.max}`;
const PIN = LIMITS.maxPinAttempts;
// 0 (no limit) or a value of the range: a short list, so @IsIn says it exactly.
const PIN_ATTEMPT_VALUES = [
  0,
  ...Array.from({ length: PIN.max - PIN.min + 1 }, (_, i) => PIN.min + i),
];
const PIN_MESSAGE = `Le nombre de tentatives de PIN doit être 0 (sans limite) ou un entier entre ${PIN.min} et ${PIN.max}`;
const SESSIONS_MESSAGE = `Le nombre de sessions doit être un entier entre ${SESSIONS.min} et ${SESSIONS.max}`;
const ALERT_DAYS = LIMITS.deliveryAlertDays;
const ALERT_DAYS_MESSAGE = `Le délai d’alerte de livraison doit être un nombre entier de jours entre ${ALERT_DAYS.min} et ${ALERT_DAYS.max}`;
const ESCALATION = LIMITS.cancellationEscalationHours;
const ESCALATION_MESSAGE = `Le délai de réponse à une demande d’annulation doit être un nombre entier d’heures entre ${ESCALATION.min} et ${ESCALATION.max}`;

export class SystemSettingsResponse {
  @ApiProperty({
    description:
      'Échecs de connexion consécutifs avant le blocage du compte pendant 15 minutes',
    example: 5,
  })
  maxLoginAttempts: number;

  @ApiProperty({
    description:
      'Sessions ouvertes en même temps par administrateur ; au-delà, les plus anciennes sont fermées',
    example: 3,
  })
  maxAdminSessions: number;

  @ApiProperty({
    description:
      'Codes PIN erronés avant le blocage d’un utilisateur mobile pendant 15 minutes ; 0 = sans limite',
    example: 5,
  })
  maxPinAttempts: number;

  @ApiProperty({
    description:
      'Jours après la confirmation d’un bon payé au-delà desquels, s’il n’est pas livré, les gérants de la quincaillerie sont alertés (une fois)',
    example: 7,
  })
  deliveryAlertDays: number;

  @ApiProperty({
    description:
      'Heures laissées au gérant pour répondre à une demande d’annulation d’un client (livrer ou annuler) ; au-delà, une alerte est créée pour les administrateurs',
    example: 48,
  })
  cancellationEscalationHours: number;
}

/**
 * Partial update: omitted settings keep their current value. `ValidateIf`
 * rather than `@IsOptional()`: only an omitted value skips validation, so
 * `null` is refused with a 400 instead of reaching a non-null column.
 */
export class UpdateSystemSettingsDto {
  @ApiPropertyOptional({
    description: `Entre ${ATTEMPTS.min} et ${ATTEMPTS.max}`,
    example: 5,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: ATTEMPTS_MESSAGE })
  @Min(ATTEMPTS.min, { message: ATTEMPTS_MESSAGE })
  @Max(ATTEMPTS.max, { message: ATTEMPTS_MESSAGE })
  maxLoginAttempts?: number;

  @ApiPropertyOptional({
    description: `Entre ${SESSIONS.min} et ${SESSIONS.max}`,
    example: 3,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: SESSIONS_MESSAGE })
  @Min(SESSIONS.min, { message: SESSIONS_MESSAGE })
  @Max(SESSIONS.max, { message: SESSIONS_MESSAGE })
  maxAdminSessions?: number;

  @ApiPropertyOptional({
    description: `0 (sans limite) ou entre ${PIN.min} et ${PIN.max}`,
    example: 5,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(PIN_ATTEMPT_VALUES, { message: PIN_MESSAGE })
  maxPinAttempts?: number;

  @ApiPropertyOptional({
    description: `Entre ${ALERT_DAYS.min} et ${ALERT_DAYS.max} jours`,
    example: 7,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: ALERT_DAYS_MESSAGE })
  @Min(ALERT_DAYS.min, { message: ALERT_DAYS_MESSAGE })
  @Max(ALERT_DAYS.max, { message: ALERT_DAYS_MESSAGE })
  deliveryAlertDays?: number;

  @ApiPropertyOptional({
    description: `Entre ${ESCALATION.min} et ${ESCALATION.max} heures`,
    example: 48,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: ESCALATION_MESSAGE })
  @Min(ESCALATION.min, { message: ESCALATION_MESSAGE })
  @Max(ESCALATION.max, { message: ESCALATION_MESSAGE })
  cancellationEscalationHours?: number;
}
