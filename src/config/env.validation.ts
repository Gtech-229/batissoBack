import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { IsPassword } from '../common/validation/password.js';
import { TrimLowerCase } from '../common/validation/trim.js';

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
}

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
  return validatedConfig;
}
