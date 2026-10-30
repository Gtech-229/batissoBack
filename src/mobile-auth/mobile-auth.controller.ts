import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../admin-auth/decorators/public.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { MobileRoute } from './decorators/mobile-route.decorator.js';
import {
  CODE_REQUESTED_MESSAGE,
  CodeRequestedResponse,
  VerificationResponse,
} from './dto/code-responses.js';
import {
  ChallengeDto,
  ChallengeResponse,
  MobileLoginDto,
} from './dto/login.dto.js';
import { MobileSession } from './dto/mobile-session.js';
import {
  RecoverAccessDto,
  RecoveryQuestionsDto,
  RecoveryQuestionsResponse,
} from './dto/recovery.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RequestCodeDto, VerifyCodeDto } from './dto/request-code.dto.js';
import { SetPinDto } from './dto/set-pin.dto.js';
import { MobileAuthService } from './mobile-auth.service.js';

@ApiTags('Mobile - Authentification')
@MobileRoute()
@Controller('auth')
export class MobileAuthController {
  constructor(private readonly auth: MobileAuthService) {}

  /**
   * @description Ask for a one-time code by SMS (first sign-in or new device)
   * @route POST /api/v1/auth/code
   * @access Public
   * @body RequestCodeDto (phone)
   * @returns 202 CodeRequestedResponse, the same for every phone
   */
  @Post('code')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Demander un code par SMS',
    description:
      'Envoie un code à 6 chiffres, valable 10 minutes, si le numéro appartient à un utilisateur. La réponse est toujours la même, pour ne pas révéler les comptes existants. Au plus un SMS par minute et 5 par heure pour un même numéro : au-delà, rien n’est envoyé.',
  })
  @ApiAcceptedResponse({
    description: 'Demande prise en compte',
    type: CodeRequestedResponse,
  })
  @ApiBadRequestResponse({
    description: 'Numéro invalide pour le pays actif (`details`)',
    type: ErrorResponse,
  })
  async requestCode(
    @Body() body: RequestCodeDto,
  ): Promise<CodeRequestedResponse> {
    await this.auth.requestCode(body.phone);
    return { message: CODE_REQUESTED_MESSAGE };
  }

  /**
   * @description Check the SMS code; returns a single-use token for the PIN step
   * @route POST /api/v1/auth/code/verify
   * @access Public
   * @body VerifyCodeDto (phone, code, deviceId)
   * @returns 200 VerificationResponse; 401 INVALID_CODE
   */
  @Post('code/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vérifier le code reçu par SMS',
    description:
      'Renvoie un jeton à usage unique, valable 10 minutes et lié à cet appareil, à présenter avec le PIN à `POST /auth/pin`. `pinSet` indique si l’utilisateur doit choisir son PIN (première connexion) ou saisir son PIN actuel. Après 5 codes faux, le code n’est plus utilisable.',
  })
  @ApiOkResponse({ description: 'Code correct', type: VerificationResponse })
  @ApiBadRequestResponse({
    description: 'Données invalides (`details`)',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description:
      'Code faux, expiré, déjà utilisé ou inexistant (`INVALID_CODE`)',
    type: ErrorResponse,
  })
  verifyCode(@Body() body: VerifyCodeDto): Promise<VerificationResponse> {
    return this.auth.verifyCode(body.phone, body.code, body.deviceId);
  }

  /**
   * @description PIN step after the SMS code: chooses the PIN (first sign-in) or checks it (new device), then opens a session on this device
   * @route POST /api/v1/auth/pin
   * @access Public (needs a verification token)
   * @body SetPinDto (verificationToken, pin, publicKey, deviceName?)
   * @returns 200 MobileSession; 401 INVALID_VERIFICATION or INVALID_CREDENTIALS; 403 PIN_LOCKED or SECURITY_ANSWERS_REQUIRED
   */
  @Post('pin')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Choisir ou saisir le PIN et ouvrir la session',
    description:
      'Avec le jeton de `POST /auth/code/verify`. Première connexion : le PIN envoyé devient celui de l’utilisateur. Sinon : il doit être son PIN actuel (les erreurs comptent pour le blocage). En cas de succès, l’appareil devient de confiance avec la clé publique envoyée (elle remplace l’ancienne si l’appareil est vérifié à nouveau) et une session s’ouvre ; le jeton ne sert qu’une fois. Après un PIN faux, le jeton reste valable jusqu’à son expiration.',
  })
  @ApiOkResponse({ description: 'Session ouverte', type: MobileSession })
  @ApiBadRequestResponse({
    description: 'Données invalides, dont un PIN trop simple (`details`)',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description:
      'Jeton faux, expiré ou déjà utilisé (`INVALID_VERIFICATION`) ; PIN incorrect (`INVALID_CREDENTIALS`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description:
      'Trop de PIN erronés, compte bloqué 15 minutes (`PIN_LOCKED`) ; après une réinitialisation, le PIN se choisit avec les questions de sécurité (`SECURITY_ANSWERS_REQUIRED`)',
    type: ErrorResponse,
  })
  completeWithPin(@Body() body: SetPinDto): Promise<MobileSession> {
    return this.auth.completeWithPin(
      body.verificationToken,
      body.pin,
      body.publicKey,
      body.deviceName,
    );
  }

  /**
   * @description The user's security questions, once their phone is proven by an SMS code
   * @route POST /api/v1/auth/recovery/questions
   * @access Public (needs a verification token)
   * @body RecoveryQuestionsDto (verificationToken)
   * @returns 200 RecoveryQuestionsResponse; 401 INVALID_VERIFICATION; 409 RECOVERY_NOT_CONFIGURED
   */
  @Post('recovery/questions')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lire mes questions de sécurité',
    description:
      'Avec le jeton de `POST /auth/code/verify`. Sans le téléphone, personne ne peut savoir si des questions existent.',
  })
  @ApiOkResponse({
    description: 'Les questions',
    type: RecoveryQuestionsResponse,
  })
  @ApiBadRequestResponse({
    description: 'Jeton absent (`details`)',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'Jeton faux, expiré ou déjà utilisé (`INVALID_VERIFICATION`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Aucune question définie (`RECOVERY_NOT_CONFIGURED`)',
    type: ErrorResponse,
  })
  recoveryQuestions(
    @Body() body: RecoveryQuestionsDto,
  ): Promise<RecoveryQuestionsResponse> {
    return this.auth.recoveryQuestions(body.verificationToken);
  }

  /**
   * @description Recover access with the three security answers: every old session and device loses access, the new PIN is set, a session opens here
   * @route POST /api/v1/auth/recovery
   * @access Public (needs a verification token)
   * @body RecoverAccessDto (verificationToken, answers, newPin, publicKey, deviceName?)
   * @returns 200 MobileSession; 401 INVALID_VERIFICATION or INVALID_RECOVERY_ANSWERS; 403 RECOVERY_LOCKED; 409 RECOVERY_NOT_CONFIGURED
   */
  @Post('recovery')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Récupérer mon accès avec mes questions de sécurité',
    description:
      'Avec le jeton de `POST /auth/code/verify` et les réponses aux 3 questions : toutes doivent être justes, et l’erreur ne dit jamais laquelle ne l’est pas. Toutes les sessions sont fermées, aucun ancien appareil n’est plus reconnu, le nouveau code PIN est enregistré et une session s’ouvre sur cet appareil. L’utilisateur est prévenu par SMS. Trois essais incorrects bloquent la récupération pendant 24 heures. Après un essai incorrect, le jeton reste valable jusqu’à son expiration.',
  })
  @ApiOkResponse({ description: 'Session ouverte', type: MobileSession })
  @ApiBadRequestResponse({
    description: 'Données invalides, dont un PIN trop simple (`details`)',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description:
      'Jeton faux, expiré ou déjà utilisé (`INVALID_VERIFICATION`) ; réponses incorrectes (`INVALID_RECOVERY_ANSWERS`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Trop d’essais incorrects (`RECOVERY_LOCKED`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Aucune question définie (`RECOVERY_NOT_CONFIGURED`)',
    type: ErrorResponse,
  })
  recover(@Body() body: RecoverAccessDto): Promise<MobileSession> {
    return this.auth.recover(
      body.verificationToken,
      body.answers,
      body.newPin,
      body.publicKey,
      body.deviceName,
    );
  }

  /**
   * @description Get a single-use challenge for the device to sign before signing in
   * @route POST /api/v1/auth/challenge
   * @access Public
   * @body ChallengeDto (phone, deviceId)
   * @returns 200 ChallengeResponse, for any phone and device
   */
  @Post('challenge')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtenir un défi à signer',
    description:
      'Renvoie une valeur aléatoire, à usage unique et valable 2 minutes, que l’appareil signe avec sa clé privée avant `POST /auth/login`. Toujours la même réponse, que le numéro soit connu ou non.',
  })
  @ApiOkResponse({ description: 'Défi à signer', type: ChallengeResponse })
  @ApiBadRequestResponse({
    description: 'Données invalides (`details`)',
    type: ErrorResponse,
  })
  createChallenge(@Body() body: ChallengeDto): Promise<ChallengeResponse> {
    return this.auth.createChallenge(body.phone, body.deviceId);
  }

  /**
   * @description Sign in with the PIN on a trusted device, proven by its signature of a challenge
   * @route POST /api/v1/auth/login
   * @access Public
   * @body MobileLoginDto (phone, pin, deviceId, challenge, signature)
   * @returns 200 MobileSession; 401 INVALID_CREDENTIALS; 403 DEVICE_VERIFICATION_REQUIRED or PIN_LOCKED
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Se connecter avec le PIN',
    description:
      'L’appareil prouve d’abord qu’il est de confiance : il signe le défi de `POST /auth/challenge` avec la clé privée enregistrée lors de sa vérification par SMS. Signature absente ou fausse, défi expiré ou déjà utilisé, appareil inconnu ou numéro inconnu : `DEVICE_VERIFICATION_REQUIRED`, sans vérifier le PIN (passer par `POST /auth/code`). Ensuite seulement le PIN : après trop de PIN faux (paramètre système `maxPinAttempts`), le compte est bloqué 15 minutes.',
  })
  @ApiOkResponse({ description: 'Session ouverte', type: MobileSession })
  @ApiBadRequestResponse({
    description: 'Données invalides (`details`)',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'PIN incorrect (`INVALID_CREDENTIALS`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description:
      'Appareil non prouvé, à vérifier par SMS (`DEVICE_VERIFICATION_REQUIRED`) ; compte bloqué (`PIN_LOCKED`)',
    type: ErrorResponse,
  })
  login(@Body() body: MobileLoginDto): Promise<MobileSession> {
    return this.auth.login(
      body.phone,
      body.pin,
      body.deviceId,
      body.challenge,
      body.signature,
    );
  }

  /**
   * @description Renew the session: rotates the refresh token
   * @route POST /api/v1/auth/refresh
   * @access Public (needs a valid refresh token)
   * @body RefreshDto (refreshToken)
   * @returns 200 MobileSession; 401 INVALID_REFRESH_TOKEN
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renouveler la session',
    description:
      'Renvoie un nouveau jeton d’accès et un nouveau jeton de renouvellement ; l’ancien ne fonctionne plus. Si la session est expirée ou fermée, l’utilisateur se reconnecte avec son PIN.',
  })
  @ApiOkResponse({ description: 'Session renouvelée', type: MobileSession })
  @ApiBadRequestResponse({
    description: 'Données invalides (`details`)',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description:
      'Jeton faux, déjà utilisé, ou session expirée ou fermée (`INVALID_REFRESH_TOKEN`)',
    type: ErrorResponse,
  })
  refresh(@Body() body: RefreshDto): Promise<MobileSession> {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * @description Logout: ends this session; the device stays trusted
   * @route POST /api/v1/auth/logout
   * @access Mobile session (Bearer)
   * @returns 204
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Se déconnecter',
    description:
      'Ferme la session de cet appareil : le jeton d’accès et le jeton de renouvellement cessent de fonctionner immédiatement. L’appareil reste de confiance (la prochaine connexion se fait par PIN, sans SMS).',
  })
  @ApiNoContentResponse({ description: 'Session fermée' })
  @ApiUnauthorizedResponse({
    description: 'Session absente, expirée ou fermée',
    type: ErrorResponse,
  })
  logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logout(user.sessionId);
  }
}
