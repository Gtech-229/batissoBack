import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsUrl, Max, Min, validateSync } from 'class-validator';
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
