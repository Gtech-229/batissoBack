import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../admin-auth/decorators/public.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { CountriesService } from './countries.service.js';
import { PublicCountry } from './dto/public-country.js';

@ApiTags('Mobile - Pays')
@MobileRoute()
@Controller('countries')
export class CountriesPublicController {
  constructor(private readonly countries: CountriesService) {}

  /**
   * @description List the active countries, for the app's country picker (before sign-in)
   * @route GET /api/v1/countries
   * @access Public
   * @returns 200 PublicCountry[] (active countries only, by name)
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Lister les pays ouverts',
    description:
      'Les pays actifs, par nom : le code à envoyer avec chaque numéro de téléphone (countryCode), le nom et l’indicatif. Sans connexion, pour l’écran de choix du pays.',
  })
  @ApiOkResponse({ description: 'Pays ouverts', type: [PublicCountry] })
  listActive(): Promise<PublicCountry[]> {
    return this.countries.listActive();
  }
}
