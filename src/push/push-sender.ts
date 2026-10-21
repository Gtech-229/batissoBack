/** What a push shows on the phone. */
export interface PushMessage {
  title: string;
  body: string;
}

/**
 * Sends a push message to one app installation. The only implementation in V1
 * is the console fake; Firebase Cloud Messaging will implement this same
 * interface once its project exists.
 */
export interface PushSender {
  /** `token` is the installation's registration token (`UserDevice.pushToken`). */
  send(token: string, message: PushMessage): Promise<void>;
}

/** Injection token: `@Inject(PUSH_SENDER) push: PushSender`. */
export const PUSH_SENDER = Symbol('PUSH_SENDER');
