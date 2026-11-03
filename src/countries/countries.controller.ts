import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import { CountriesService } from './countries.service.js';
import { CountrySummary } from './dto/country-summary.js';
import { CreateCountryDto } from './dto/create-country.dto.js';
import { UpdateCountryDto } from './dto/update-country.dto.js';

@ApiTags('Administration - Pays')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@Controller('admin/countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  /**
   * @description Create a new country (inactive, phone prefix derived from the code)
   * @route POST /api/v1/admin/countries
   * @access Admin
   * @body CreateCountryDto (code, name, currencyCode, currencySymbol, decimals, language?)
   * @returns 201 CountrySummary; 409 COUNTRY_ALREADY_EXISTS
   */
  @Post()
  @RequirePermission('countries.manage')
  @ApiOperation({
    summary: 'Créer un pays',
    description:
      'Le pays est créé inactif. L’indicatif téléphonique est déduit du code ISO.',
  })
  @ApiCreatedResponse({ description: 'Pays créé', type: CountrySummary })
  @ApiBadRequestResponse({
    description:
      'Champs invalides, ou code ISO sans indicatif téléphonique (`details` par champ)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Ce code pays existe déjà (`COUNTRY_ALREADY_EXISTS`)',
    type: ErrorResponse,
  })
  create(@Body() createCountryDto: CreateCountryDto): Promise<CountrySummary> {
    return this.countriesService.create(createCountryDto);
  }

  /**
   * @description Get the full list of countries
   * @route GET /api/v1/admin/countries
   * @access Admin
   * @returns 200 CountrySummary[]
   */
  @Get()
  @RequirePermission('countries.read')
  @ApiOperation({
    summary: 'Lister les pays',
    description: 'Tous les pays, actifs ou non, triés par code ISO.',
  })
  @ApiOkResponse({ description: 'Liste des pays', type: [CountrySummary] })
  list(): Promise<CountrySummary[]> {
    return this.countriesService.findAll();
  }

  /**
   * @description Get a country's details
   * @route GET /api/v1/admin/countries/:code
   * @access Admin
   * @param code (ISO 3166-1 alpha-2) country code, any case
   * @returns 200 CountrySummary; 404 if unknown
   */
  @Get(':code')
  @RequirePermission('countries.read')
  @ApiOperation({ summary: 'Consulter un pays' })
  @ApiParam({ name: 'code', description: 'Code ISO du pays (ex. ML)' })
  @ApiOkResponse({ description: 'Le pays', type: CountrySummary })
  @ApiNotFoundResponse({ description: 'Pays introuvable', type: ErrorResponse })
  findOne(@Param('code') code: string): Promise<CountrySummary> {
    return this.countriesService.findOne(code.toUpperCase());
  }

  /**
   * @description Update a country's general details
   * @route PATCH /api/v1/admin/countries/:code
   * @access Admin
   * @param code (ISO 3166-1 alpha-2) country code, any case
   * @body UpdateCountryDto (name?, currencyCode?, currencySymbol?, decimals?, language?)
   * @returns 200 CountrySummary; 409 COUNTRY_IN_USE when changing the currency of a country with stores
   */
  @Patch(':code')
  @RequirePermission('countries.manage')
  @ApiOperation({
    summary: 'Modifier un pays',
    description:
      'Seuls les champs envoyés changent ; `null` est refusé. La devise (`currencyCode`, `decimals`) ne peut plus changer dès que le pays a une quincaillerie, même fermée.',
  })
  @ApiParam({ name: 'code', description: 'Code ISO du pays (ex. ML)' })
  @ApiOkResponse({ description: 'Pays modifié', type: CountrySummary })
  @ApiBadRequestResponse({
    description: 'Champs invalides (`details` par champ)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({ description: 'Pays introuvable', type: ErrorResponse })
  @ApiConflictResponse({
    description:
      'Changement de devise d’un pays qui a des quincailleries (`COUNTRY_IN_USE`)',
    type: ErrorResponse,
  })
  update(
    @Param('code') code: string,
    @Body() updateCountryDto: UpdateCountryDto,
  ): Promise<CountrySummary> {
    return this.countriesService.update(code.toUpperCase(), updateCountryDto);
  }

  /**
   * @description Make this country the active one (a single active country in V1)
   * @route PATCH /api/v1/admin/countries/:code/activate
   * @access Admin
   * @param code (ISO 3166-1 alpha-2) country code, any case
   * @returns 200 CountrySummary; 409 ANOTHER_COUNTRY_ACTIVE if another country is active
   */
  @Patch(':code/activate')
  @RequirePermission('countries.manage')
  @ApiOperation({
    summary: 'Activer un pays',
    description:
      'Un seul pays peut être actif en V1 : si un autre pays est actif, désactivez-le d’abord. Sans effet si le pays est déjà actif.',
  })
  @ApiParam({ name: 'code', description: 'Code ISO du pays (ex. ML)' })
  @ApiOkResponse({ description: 'Pays actif', type: CountrySummary })
  @ApiNotFoundResponse({ description: 'Pays introuvable', type: ErrorResponse })
  @ApiConflictResponse({
    description: 'Un autre pays est déjà actif (`ANOTHER_COUNTRY_ACTIVE`)',
    type: ErrorResponse,
  })
  activate(@Param('code') code: string): Promise<CountrySummary> {
    return this.countriesService.activate(code.toUpperCase());
  }

  /**
   * @description Deactivate a country; refused while it has stores that are not closed
   * @route PATCH /api/v1/admin/countries/:code/deactivate
   * @access Admin
   * @param code (ISO 3166-1 alpha-2) country code, any case
   * @returns 200 CountrySummary; 409 COUNTRY_IN_USE if a store is not closed
   */
  @Patch(':code/deactivate')
  @RequirePermission('countries.manage')
  @ApiOperation({
    summary: 'Désactiver un pays',
    description:
      'Impossible tant qu’une quincaillerie de ce pays n’est pas fermée. Sans effet si le pays est déjà inactif.',
  })
  @ApiParam({ name: 'code', description: 'Code ISO du pays (ex. ML)' })
  @ApiOkResponse({ description: 'Pays inactif', type: CountrySummary })
  @ApiNotFoundResponse({ description: 'Pays introuvable', type: ErrorResponse })
  @ApiConflictResponse({
    description: 'Le pays a des quincailleries non fermées (`COUNTRY_IN_USE`)',
    type: ErrorResponse,
  })
  deactivate(@Param('code') code: string): Promise<CountrySummary> {
    return this.countriesService.deactivate(code.toUpperCase());
  }
}
