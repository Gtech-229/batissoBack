import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

/** The platform's figures for admins (16d). */
@Module({
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
