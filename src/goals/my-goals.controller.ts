import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { invalidAccountId } from '../accounts/accounts.errors.js';
import { GoalView, ProjectView } from '../accounts/dto/account-detail.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import {
  CreateGoalDto,
  CreateProjectDto,
  UpdateGoalDto,
} from './dto/goal-inputs.dto.js';
import { invalidGoalId } from './goals.errors.js';
import { GoalsService } from './goals.service.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const GoalIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidGoalId });

@ApiTags('Mobile - Mes objectifs')
@ApiBearerAuth()
@ApiParam({ name: 'accountId', description: 'Identifiant de mon compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Compte introuvable parmi les vôtres, ou projet ou objectif introuvable sur ce compte',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/accounts/:accountId')
export class MyGoalsController {
  constructor(private readonly goals: GoalsService) {}

  /**
   * @description Create a construction project on one of the user's accounts
   * @route POST /api/v1/me/accounts/:accountId/projects
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @body CreateProjectDto (name)
   * @returns 201 ProjectView
   */
  @Post('projects')
  @ApiOperation({
    summary: 'Créer un projet',
    description:
      'Un projet de construction (« Ma maison ») qui regroupe des objectifs.',
  })
  @ApiCreatedResponse({ description: 'Projet créé', type: ProjectView })
  @ApiBadRequestResponse({
    description: 'Identifiant de compte invalide ; nom invalide (`details`)',
    type: ErrorResponse,
  })
  createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Body() body: CreateProjectDto,
  ): Promise<ProjectView> {
    return this.goals.createProject(user.userId, accountId, body);
  }

  /**
   * @description Create a goal with a target on one of the user's accounts
   * @route POST /api/v1/me/accounts/:accountId/goals
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @body CreateGoalDto (label, targetAmount, projectId?)
   * @returns 201 GoalView; 404 project not on this account
   */
  @Post('goals')
  @ApiOperation({
    summary: 'Créer un objectif',
    description:
      'Un objectif d’épargne (« Ciment ») avec son montant visé, éventuellement dans un projet du compte. Il commence vide ; on l’alimente par un dépôt ou un mouvement.',
  })
  @ApiCreatedResponse({ description: 'Objectif créé', type: GoalView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de compte invalide ; libellé, montant ou projet invalide (`details`)',
    type: ErrorResponse,
  })
  createGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Body() body: CreateGoalDto,
  ): Promise<GoalView> {
    return this.goals.createGoal(user.userId, accountId, body);
  }

  /**
   * @description Rename a goal or change its target (the status follows, without a notification)
   * @route PATCH /api/v1/me/accounts/:accountId/goals/:goalId
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param goalId the goal
   * @body UpdateGoalDto (label?, targetAmount?)
   * @returns 200 GoalView; 409 SYSTEM_GOAL or GOAL_CLOSED
   */
  @Patch('goals/:goalId')
  @ApiOperation({
    summary: 'Modifier un objectif',
    description:
      'Nouveau libellé et/ou nouveau montant visé. L’état suit le montant visé (`REACHED` si le solde l’atteint), sans notification. Impossible pour « Non affecté » ou un objectif fermé.',
  })
  @ApiParam({ name: 'goalId', description: 'Identifiant de l’objectif' })
  @ApiOkResponse({ description: 'Objectif modifié', type: GoalView })
  @ApiBadRequestResponse({
    description:
      'Identifiant invalide ; rien à modifier ; libellé ou montant invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Objectif « Non affecté » (`SYSTEM_GOAL`) ; objectif fermé (`GOAL_CLOSED`)',
    type: ErrorResponse,
  })
  updateGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('goalId', GoalIdPipe) goalId: string,
    @Body() body: UpdateGoalDto,
  ): Promise<GoalView> {
    return this.goals.updateGoal(user.userId, accountId, goalId, body);
  }

  /**
   * @description Close a goal: what it holds goes back to the Unassigned goal
   * @route POST /api/v1/me/accounts/:accountId/goals/:goalId/close
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param goalId the goal
   * @returns 200 GoalView (CLOSED, balance 0); 409 SYSTEM_GOAL, GOAL_CLOSED or
   * ACCOUNT_SUSPENDED
   */
  @Post('goals/:goalId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fermer un objectif',
    description:
      'Le solde de l’objectif retourne dans « Non affecté » (mouvement enregistré) ; le solde du compte ne change pas. L’objectif fermé reste visible avec son historique.',
  })
  @ApiParam({ name: 'goalId', description: 'Identifiant de l’objectif' })
  @ApiOkResponse({ description: 'Objectif fermé', type: GoalView })
  @ApiBadRequestResponse({
    description: 'Identifiant de compte ou d’objectif invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Objectif « Non affecté » (`SYSTEM_GOAL`) ; objectif déjà fermé (`GOAL_CLOSED`) ; compte suspendu (`ACCOUNT_SUSPENDED`)',
    type: ErrorResponse,
  })
  closeGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('goalId', GoalIdPipe) goalId: string,
  ): Promise<GoalView> {
    return this.goals.closeGoal(user, accountId, goalId);
  }
}
