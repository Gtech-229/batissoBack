import { Module } from '@nestjs/common';
import { MobileAuthModule } from '../mobile-auth/mobile-auth.module.js';
import { MySecurityQuestionsController } from './my-security-questions.controller.js';
import { SecurityAnswersService } from './security-answers.service.js';
import { SecurityQuestionsController } from './security-questions.controller.js';
import { SecurityQuestionsService } from './security-questions.service.js';

/** The security questions of account recovery (14b). */
@Module({
  imports: [MobileAuthModule],
  controllers: [SecurityQuestionsController, MySecurityQuestionsController],
  providers: [SecurityQuestionsService, SecurityAnswersService],
})
export class SecurityQuestionsModule {}
