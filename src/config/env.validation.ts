import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { IsPassword } from '../common/validation/password.js';
import { TrimLowerCase } from '../common/validation/trim.js';

/**
 * EMAIL_FROM: `Name <address>` or a bare `address`. No line break, so the
 * value cannot add a header.
 */
const EMAIL_FROM_PATTERN =
  /^(?:[^<>@\r\n]+ <[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/;

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsUrl({
    protocols: ['postgresql', 'postgres'],
    require_tld: false,
    require_protocol: true,
  })
  DATABASE_URL: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  /** Web admin origins allowed to call the API with cookies, comma-separated. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      : value,
  )
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_tld: false,
      require_protocol: true,
    },
    { each: true },
  )
  CORS_ORIGINS: string[] = [];

  /**
   * The web admin's address, put in the password links emailed to admins
   * (`<ADMIN_WEB_URL>/password?...`). Trailing slashes are dropped.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\/+$/, '') : value,
  )
  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  ADMIN_WEB_URL: string;

  /** Signs the admin access tokens. Never logged. */
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  /**
   * Mixed into every PIN hash (HMAC before scrypt) and never stored in the
   * database, so a leaked database alone cannot be brute-forced over the million
   * 6-digit PINs. Changing it invalidates every PIN. Never logged.
   */
  @IsString()
  @MinLength(32)
  PIN_PEPPER: string;

  /**
   * Private directory of the customers' identity photos, relative to the working
   * directory or absolute. Never served statically: only the API reads it.
   */
  @IsString()
  @MinLength(1)
  ID_PHOTO_DIR: string = 'storage/id-photos';

  /** Private directory of the proofs of transactions; never served statically. */
  @IsString()
  @MinLength(1)
  PROOF_DIR: string = 'storage/proofs';

  /**
   * Private directory of the documents of self-registered stores (21b): the
   * manager's identity photo and the trade register; never served statically.
   */
  @IsString()
  @MinLength(1)
  STORE_DOCUMENT_DIR: string = 'storage/store-documents';

  /** Used once, to create the super admin when none exists. */
  @IsOptional()
  @TrimLowerCase()
  @IsEmail()
  SUPER_ADMIN_EMAIL?: string;

  @IsOptional()
  @IsPassword()
  SUPER_ADMIN_PASSWORD?: string;

  /**
   * With SWAGGER_PASSWORD, turns the API docs on in production, behind HTTP
   * Basic auth (src/swagger.ts). Both or neither; an empty value counts as
   * unset. No `:`, which Basic auth forbids in the user name.
   */
  @EmptyAsUnset()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/^[^:]+$/, { message: 'SWAGGER_USER must not contain ":"' })
  SWAGGER_USER?: string;

  /** The docs password, 16+ characters. Never logged. */
  @EmptyAsUnset()
  @IsOptional()
  @IsString()
  @MinLength(16)
  SWAGGER_PASSWORD?: string;

  /**
   * The outgoing mail server (src/email/smtp-email-sender.ts). SMTP_HOST,
   * SMTP_PORT, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM go together: all set,
   * admins' emails go out over SMTP; none, the console fake. Empty counts as
   * unset.
   */
  @EmptyAsUnset()
  @IsOptional()
  @Matches(/^[A-Za-z0-9.-]+$/, {
    message: 'SMTP_HOST must be a host name or an IPv4 address',
  })
  SMTP_HOST?: string;

  /** 465: TLS from the first byte; any other port: STARTTLS required. */
  @EmptyAsUnset()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @EmptyAsUnset()
  @IsOptional()
  @IsString()
  @MinLength(1)
  SMTP_USER?: string;

  /** Never logged nor put in an error message. */
  @EmptyAsUnset()
  @IsOptional()
  @IsString()
  @MinLength(1)
  SMTP_PASSWORD?: string;

  /** The sender admins see: `Name <address>` or a bare `address`. */
  @EmptyAsUnset()
  @IsOptional()
  @Matches(EMAIL_FROM_PATTERN, {
    message: 'EMAIL_FROM must be "Name <address>" or an address',
  })
  EMAIL_FROM?: string;
}

/** An empty variable (`NAME=`) reads as unset, before any conversion. */
function EmptyAsUnset(): PropertyDecorator {
  return Transform(
    ({
      obj,
      key,
      value,
    }: {
      obj: Record<string, unknown>;
      key: string;
      value: unknown;
    }) => (obj[key] === '' ? undefined : value),
  );
}

/** The SMTP settings that must be set together. */
export const SMTP_VARIABLES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'EMAIL_FROM',
] as const;

export function validate(
  configuration: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, configuration, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  // The docs credentials go together: one alone is a half-done setup.
  if (
    (validatedConfig.SWAGGER_USER === undefined) !==
    (validatedConfig.SWAGGER_PASSWORD === undefined)
  ) {
    throw new Error(
      'SWAGGER_USER and SWAGGER_PASSWORD must be set together, or both left unset',
    );
  }
  // The mail settings too: some without the others cannot send.
  const smtpSet = SMTP_VARIABLES.filter(
    (name) => validatedConfig[name] !== undefined,
  ).length;
  if (smtpSet !== 0 && smtpSet !== SMTP_VARIABLES.length) {
    throw new Error(
      `${SMTP_VARIABLES.join(', ')} must be set together, or all left unset`,
    );
  }
  return validatedConfig;
}
