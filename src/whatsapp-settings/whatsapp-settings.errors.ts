import { BadGatewayException, ConflictException } from '@nestjs/common';

export function whatsappNotConfigured(): ConflictException {
  return new ConflictException({
    // Also when WhatsApp is already on and its token became unreadable (a
    // changed key): it can neither be turned on nor stay on that way (F-94).
    message:
      'WhatsApp ne peut pas être activé, ni rester activé, sans identifiant d’instance et jeton lisible : saisissez le jeton à nouveau, ou désactivez WhatsApp',
    error: 'WHATSAPP_NOT_CONFIGURED',
  });
}

export function encryptionKeyMissing(): ConflictException {
  return new ConflictException({
    message:
      'Le jeton ne peut pas être enregistré : la clé de chiffrement du serveur (SETTINGS_ENCRYPTION_KEY) n’est pas configurée',
    error: 'ENCRYPTION_KEY_MISSING',
  });
}

/** Green API refused or did not answer; `reason` holds no secret (HTTP 401, timeout...). */
export function whatsappSendFailed(reason: string): BadGatewayException {
  return new BadGatewayException({
    message: `Le message WhatsApp n’a pas pu être envoyé (${reason}) : vérifiez l’instance Green API, le jeton et que le numéro a WhatsApp`,
    error: 'WHATSAPP_SEND_FAILED',
  });
}
