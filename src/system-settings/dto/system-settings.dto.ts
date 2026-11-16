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
const REMINDER = LIMITS.inactivityReminderDays;
const REMINDER_MESSAGE = `Le délai de rappel d’inactivité doit être un nombre entier de jours entre ${REMINDER.min} et ${REMINDER.max}`;
const ESCALATION = LIMITS.cancellationEscalationHours;
const CODES_HOUR = LIMITS.maxCodesPerHour;
const CODES_HOUR_MESSAGE = `Le nombre de codes de connexion par heure doit être un entier entre ${CODES_HOUR.min} et ${CODES_HOUR.max}`;
const CODES_DAY = LIMITS.maxCodesPerDay;
const CODES_DAY_MESSAGE = `Le nombre de codes de connexion par jour doit être un entier entre ${CODES_DAY.min} et ${CODES_DAY.max}`;
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

  @ApiProperty({
    description:
      'Jours sans dépôt sur un compte au-delà desquels le client reçoit un rappel (une fois par période sans dépôt)',
    example: 30,
  })
  inactivityReminderDays: number;

  @ApiProperty({
    description:
      'Codes de connexion et d’inscription que toute la plateforme peut envoyer sur une heure glissante, en plus des limites par numéro ; au-delà, aucun code n’est envoyé et une alerte est créée pour les administrateurs',
    example: 50,
  })
  maxCodesPerHour: number;

  @ApiProperty({
    description:
      'Codes de connexion et d’inscription que toute la plateforme peut envoyer sur 24 heures glissantes, en plus des limites par numéro ; au-delà, aucun code n’est envoyé et une alerte est créée pour les administrateurs',
    example: 200,
  })
  maxCodesPerDay: number;
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

  @ApiPropertyOptional({
    description: `Entre ${REMINDER.min} et ${REMINDER.max} jours`,
    example: 30,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: REMINDER_MESSAGE })
  @Min(REMINDER.min, { message: REMINDER_MESSAGE })
  @Max(REMINDER.max, { message: REMINDER_MESSAGE })
  inactivityReminderDays?: number;

  @ApiPropertyOptional({
    description: `Entre ${CODES_HOUR.min} et ${CODES_HOUR.max} codes`,
    example: 50,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: CODES_HOUR_MESSAGE })
  @Min(CODES_HOUR.min, { message: CODES_HOUR_MESSAGE })
  @Max(CODES_HOUR.max, { message: CODES_HOUR_MESSAGE })
  maxCodesPerHour?: number;

  @ApiPropertyOptional({
    description: `Entre ${CODES_DAY.min} et ${CODES_DAY.max} codes`,
    example: 200,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt({ message: CODES_DAY_MESSAGE })
  @Min(CODES_DAY.min, { message: CODES_DAY_MESSAGE })
  @Max(CODES_DAY.max, { message: CODES_DAY_MESSAGE })
  maxCodesPerDay?: number;
}
