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
}
