import { PartialType, PickType } from '@nestjs/swagger';
import { RegisterStoreDto, StoreSettingsInput } from './register-store.dto.js';

/**
 * Store information an admin can correct. The country, status, settings, and
 * managers have their own rules and routes.
 *
 * `skipNullProperties: false`: an omitted field is optional, but `null` still
 * runs the validators, so it is refused with a 400 instead of reaching Prisma.
 */
export class UpdateStoreDto extends PartialType(
  PickType(RegisterStoreDto, [
    'name',
    'address',
    'city',
    'phone',
    'tradeRegister',
  ] as const),
  { skipNullProperties: false },
) {}

/**
 * Partial settings update. `null` is refused on the amounts (see above), but
 * `"terms": null` clears the terms: `terms` keeps its own `@IsOptional()` from
 * `StoreSettingsInput`, and `definedOnly` keeps the null.
 */
export class UpdateStoreSettingsDto extends PartialType(StoreSettingsInput, {
  skipNullProperties: false,
}) {}
