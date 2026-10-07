import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCountryDto } from './create-country.dto.js';

/**
 * Every field optional, validators and Swagger docs inherited. The code is the
 * primary key and cannot change. `skipNullProperties: false`: an omitted field
 * is optional, but `null` still runs the validators and is refused with a 400.
 */
export class UpdateCountryDto extends PartialType(
  OmitType(CreateCountryDto, ['code'] as const),
  { skipNullProperties: false },
) {}
