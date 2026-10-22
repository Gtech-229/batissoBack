import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { GoalsService } from './goals.service.js';
import { MyGoalMovementsController } from './my-goal-movements.controller.js';
import { MyGoalsController } from './my-goals.controller.js';

/** The customer's projects, goals, and moves between goals. */
@Module({
  imports: [NotificationsModule],
  controllers: [MyGoalsController, MyGoalMovementsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
