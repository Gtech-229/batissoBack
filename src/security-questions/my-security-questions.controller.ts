import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import {
  MySecurityQuestions,
  SetSecurityAnswersDto,
} from './dto/security-answers.dto.js';
import { SecurityAnswersService } from './security-answers.service.js';

@ApiTags('Mobile - Mon compte')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/security-questions')
export class MySecurityQuestionsController {
  constructor(private readonly answers: SecurityAnswersService) {}

  /**
   * @description The signed-in user's security questions, and those on offer
   * @route GET /api/v1/me/security-questions
   * @access Mobile session (Bearer)
   * @returns 200 MySecurityQuestions
   */
  @Get()
  @ApiOperation({
    summary: 'Mes questions de sécurité',
    description:
      'Mes questions, si elles sont définies, et les questions proposées. Les réponses ne sont jamais renvoyées.',
  })
  @ApiOkResponse({ description: 'Questions', type: MySecurityQuestions })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<MySecurityQuestions> {
    return this.answers.mine(user.userId);
  }

  /**
   * @description Set the signed-in user's security answers (3 to 5), replacing any before
   * @route PUT /api/v1/me/security-questions
   * @access Mobile session (Bearer)
   * @body SetSecurityAnswersDto (currentPin, answers: questionId, answer)
   * @returns 204 no content; 400 INVALID_PIN, SECURITY_ANSWERS_NOT_DISTINCT or SECURITY_QUESTION_UNAVAILABLE; 403 PIN_LOCKED
   */
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Définir mes questions de sécurité',
    description:
      'De 3 à 5 questions différentes parmi celles proposées, avec le code PIN actuel. Remplace les réponses précédentes. Elles permettent de récupérer l’accès sans le gérant, avec un code SMS ; elles sont aussi demandées après une réinitialisation par le gérant.',
  })
  @ApiNoContentResponse({ description: 'Réponses enregistrées' })
  @ApiBadRequestResponse({
    description:
      'Code PIN incorrect (`INVALID_PIN`) ; questions ou réponses identiques (`SECURITY_ANSWERS_NOT_DISTINCT`) ; question inconnue ou désactivée (`SECURITY_QUESTION_UNAVAILABLE`) ; champs invalides (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Trop d’essais incorrects (`PIN_LOCKED`)',
    type: ErrorResponse,
  })
  set(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SetSecurityAnswersDto,
  ): Promise<void> {
    return this.answers.set(user, body.currentPin, body.answers);
  }
}
