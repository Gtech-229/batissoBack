import { ApiProperty } from '@nestjs/swagger';
import type { Country } from '../../generated/prisma/client.js';

/** An open country as the mobile app sees it before sign-in (27). */
export class PublicCountry {
  @ApiProperty({ description: 'Code ISO 3166-1 du pays', example: 'ML' })
  code: string;

  @ApiProperty({ description: 'Nom du pays', example: 'Mali' })
  name: string;

  @ApiProperty({ description: 'Indicatif téléphonique', example: '+223' })
  phonePrefix: string;
}

export function toPublicCountry(
  country: Pick<Country, 'code' | 'name' | 'phonePrefix'>,
): PublicCountry {
  return {
    code: country.code,
    name: country.name,
    phonePrefix: country.phonePrefix,
  };
}
