import { Module } from '@nestjs/common';
import { CountriesService } from './countries.service.js';
import { CountriesController } from './countries.controller.js';

@Module({
  controllers: [CountriesController],
  providers: [CountriesService],
})
export class CountriesModule {}
