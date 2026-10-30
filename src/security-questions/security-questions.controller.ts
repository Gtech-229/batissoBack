import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
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
import {
  CreateSecurityQuestionDto,
  SecurityQuestionView,
  UpdateSecurityQuestionDto,
} from './dto/security-question.dto.js';
import { invalidQuestionId } from './security-questions.errors.js';
import { SecurityQuestionsService } from './security-questions.service.js';

const QuestionIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidQuestionId,
});

@ApiTags('Administration - Questions de sécurité')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@Controller('admin/security-questions')
export class SecurityQuestionsController {
  constructor(private readonly questions: SecurityQuestionsService) {}

  /**
   * @description Add a security question to the list offered to users
   * @route POST /api/v1/admin/security-questions
   * @access Admin
   * @body CreateSecurityQuestionDto (text)
   * @returns 201 SecurityQuestionView; 409 SECURITY_QUESTION_EXISTS
   */
  @Post()
  @ApiOperation({
    summary: 'Ajouter une question de sécurité',
    description:
      'La question est proposée aux utilisateurs dès sa création. Son texte ne pourra plus changer.',
  })
  @ApiCreatedResponse({
    description: 'Question créée',
    type: SecurityQuestionView,
  })
  @ApiBadRequestResponse({
    description: 'Texte invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Cette question existe déjà (`SECURITY_QUESTION_EXISTS`)',
    type: ErrorResponse,
  })
  create(
    @Body() body: CreateSecurityQuestionDto,
  ): Promise<SecurityQuestionView> {
    return this.questions.create(body.text);
  }

  /**
   * @description List every security question, active or not, oldest first
   * @route GET /api/v1/admin/security-questions
   * @access Admin
   * @returns 200 SecurityQuestionView[]
   */
  @Get()
  @ApiOperation({
    summary: 'Lister les questions de sécurité',
    description: 'Toutes les questions, actives ou non.',
  })
  @ApiOkResponse({
    description: 'Liste des questions',
    type: [SecurityQuestionView],
  })
  list(): Promise<SecurityQuestionView[]> {
    return this.questions.list();
  }

  /**
   * @description Activate or deactivate a security question
   * @route PATCH /api/v1/admin/security-questions/:questionId
   * @access Admin
   * @param questionId the question
   * @body UpdateSecurityQuestionDto (active)
   * @returns 200 SecurityQuestionView; 404 if unknown; 409 TOO_FEW_SECURITY_QUESTIONS
   */
  @Patch(':questionId')
  @ApiOperation({
    summary: 'Activer ou désactiver une question de sécurité',
    description:
      'Une question désactivée n’est plus proposée ; les utilisateurs qui l’ont choisie la gardent. Il reste toujours au moins 3 questions actives.',
  })
  @ApiParam({ name: 'questionId', description: 'Identifiant de la question' })
  @ApiOkResponse({
    description: 'Question modifiée',
    type: SecurityQuestionView,
  })
  @ApiBadRequestResponse({
    description: 'Identifiant ou champ invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Question introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Il resterait moins de 3 questions actives (`TOO_FEW_SECURITY_QUESTIONS`)',
    type: ErrorResponse,
  })
  setActive(
    @Param('questionId', QuestionIdPipe) questionId: string,
    @Body() body: UpdateSecurityQuestionDto,
  ): Promise<SecurityQuestionView> {
    return this.questions.setActive(questionId, body.active);
  }
}
