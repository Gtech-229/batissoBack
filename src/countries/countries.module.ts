import { Module } from '@nestjs/common';
import { CountriesService } from './countries.service.js';
import { CountriesController } from './countries.controller.js';
import { CountriesPublicController } from './countries-public.controller.js';

@Module({
  controllers: [CountriesController, CountriesPublicController],
  providers: [CountriesService],
})
export class CountriesModule {}
