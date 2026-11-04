/**
 * The French texts of the notifications. One message serves the in-app list,
 * the push, and the SMS. Texts never claim money is "sécurisé" or "garanti"
 * (project rule).
 */

export interface NotificationMessage {
  title: string;
  body: string;
}

/**
 * `20000` -> `20 000`. A plain space, not the French narrow no-break space:
 * SMS encodings count it as a basic character.
 */
export function groupThousands(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function depositMessage(deposit: {
  amount: bigint;
  currencyCode: string;
  storeName: string;
  accountNumber: string;
  balanceAfter: bigint;
  reference: string;
}): NotificationMessage {
  const money = (value: bigint) =>
    `${groupThousands(value)} ${deposit.currencyCode}`;
  return {
    title: 'Dépôt reçu',
    body: `Dépôt de ${money(deposit.amount)} reçu par ${deposit.storeName} sur votre compte ${deposit.accountNumber}. Nouveau solde : ${money(deposit.balanceAfter)}. Réf. ${deposit.reference}.`,
  };
}

export function goalReachedMessage(goal: {
  label: string;
  balance: bigint;
  targetAmount: bigint;
  currencyCode: string;
  accountNumber: string;
  storeName: string;
}): NotificationMessage {
  const money = (value: bigint) =>
    `${groupThousands(value)} ${goal.currencyCode}`;
  return {
    title: 'Objectif atteint',
    body: `Votre objectif « ${goal.label} » atteint ${money(goal.balance)} (objectif : ${money(goal.targetAmount)}) sur votre compte ${goal.accountNumber} chez ${goal.storeName}.`,
  };
}

/** To the store's managers: the customer refused an order (10b). */
export function orderRefusedByCustomerMessage(order: {
  reference: string;
  total: bigint;
  currencyCode: string;
  accountNumber: string;
  reason: string | null;
}): NotificationMessage {
  const reason = order.reason === null ? '' : ` Motif : « ${order.reason} ».`;
  return {
    title: 'Bon refusé par le client',
    body: `Le client du compte ${order.accountNumber} a refusé le bon ${order.reference} de ${groupThousands(order.total)} ${order.currencyCode}.${reason}`,
  };
}

/** To the customer: an order awaits their confirmation (10b). */
export function orderAwaitingCustomerMessage(order: {
  reference: string;
  total: bigint;
  currencyCode: string;
  storeName: string;
}): NotificationMessage {
  return {
    title: 'Bon à confirmer',
    body: `Le bon ${order.reference} de ${groupThousands(order.total)} ${order.currencyCode} chez ${order.storeName} attend votre confirmation. Rien n’est débité avant.`,
  };
}

/** To the customer: the debit of a confirmed order (10b). */
export function purchaseMessage(purchase: {
  total: bigint;
  currencyCode: string;
  orderReference: string;
  storeName: string;
  accountNumber: string;
  balanceAfter: bigint;
  reference: string;
}): NotificationMessage {
  const money = (value: bigint) =>
    `${groupThousands(value)} ${purchase.currencyCode}`;
  return {
    title: 'Achat enregistré',
    body: `Achat de ${money(purchase.total)} (bon ${purchase.orderReference}) chez ${purchase.storeName} sur votre compte ${purchase.accountNumber}. Nouveau solde : ${money(purchase.balanceAfter)}. Réf. ${purchase.reference}.`,
  };
}

/** To the customer: their confirmed order was handed over in full (10c). */
export function orderDeliveredMessage(order: {
  reference: string;
  total: bigint;
  currencyCode: string;
  storeName: string;
}): NotificationMessage {
  return {
    title: 'Bon livré',
    body: `Le bon ${order.reference} de ${groupThousands(order.total)} ${order.currencyCode} chez ${order.storeName} vous a été livré.`,
  };
}

/** To the customer: a manager took back part of a deposit (11a). */
export function correctionMessage(correction: {
  amount: bigint;
  currencyCode: string;
  storeName: string;
  accountNumber: string;
  depositReference: string;
  reason: string;
  balanceAfter: bigint;
  reference: string;
}): NotificationMessage {
  const money = (value: bigint) =>
    `${groupThousands(value)} ${correction.currencyCode}`;
  return {
    title: 'Correction de votre compte',
    body: `Correction de ${money(correction.amount)} retirée de votre compte ${correction.accountNumber} chez ${correction.storeName} (dépôt ${correction.depositReference}) : « ${correction.reason} ». Nouveau solde : ${money(correction.balanceAfter)}. Réf. ${correction.reference}.`,
  };
}

/** To the customer: the manager cancelled a paid order and re-credited it (11b). */
export function paidOrderCancelledMessage(cancellation: {
  orderReference: string;
  total: bigint;
  currencyCode: string;
  storeName: string;
  accountNumber: string;
  reason: string;
  balanceAfter: bigint;
  reference: string;
}): NotificationMessage {
  const money = (value: bigint) =>
    `${groupThousands(value)} ${cancellation.currencyCode}`;
  return {
    title: 'Bon annulé et remboursé',
    body: `Le bon ${cancellation.orderReference} chez ${cancellation.storeName} est annulé : « ${cancellation.reason} ». ${money(cancellation.total)} remis sur votre compte ${cancellation.accountNumber}. Nouveau solde : ${money(cancellation.balanceAfter)}. Réf. ${cancellation.reference}.`,
  };
}

/** To the store's managers: a customer asks to cancel an undelivered order (11c). */
export function cancellationRequestedMessage(order: {
  accountNumber: string;
  orderReference: string;
  total: bigint;
  currencyCode: string;
  reason: string | null;
}): NotificationMessage {
  const reason = order.reason === null ? '' : ` Motif : « ${order.reason} ».`;
  return {
    title: 'Demande d’annulation d’un bon',
    body: `Le client du compte ${order.accountNumber} demande l’annulation du bon ${order.orderReference} de ${groupThousands(order.total)} ${order.currencyCode}, toujours pas livré. Livrez-le ou annulez-le avec remboursement.${reason}`,
  };
}

/** At most 200 characters of a dispute message in a notification; the thread keeps it all. */
export function disputeExcerpt(message: string): string {
  // Counted in code points, so an emoji is kept or dropped whole, never split (F-18).
  const characters = Array.from(message);
  return characters.length <= 200
    ? message
    : `${characters.slice(0, 200).join('').trimEnd()}…`;
}

/** To the store's managers: a customer opened a dispute (12). */
export function disputeOpenedMessage(dispute: {
  operationReference: string;
  accountNumber: string;
  message: string;
}): NotificationMessage {
  return {
    title: 'Nouvelle contestation',
    body: `Contestation ouverte sur l’opération ${dispute.operationReference} du compte ${dispute.accountNumber} : « ${disputeExcerpt(dispute.message)} ».`,
  };
}

/** To the store's managers: the customer wrote again in their dispute (12). */
export function disputeCustomerMessage(dispute: {
  operationReference: string;
  accountNumber: string;
  message: string;
}): NotificationMessage {
  return {
    title: 'Contestation : nouveau message du client',
    body: `Le client du compte ${dispute.accountNumber} a écrit dans sa contestation sur l’opération ${dispute.operationReference} : « ${disputeExcerpt(dispute.message)} ».`,
  };
}

/** To the customer: the store replied in their dispute (12). */
export function disputeStoreReplyMessage(dispute: {
  storeName: string;
  operationReference: string;
  message: string;
}): NotificationMessage {
  return {
    title: 'Réponse à votre contestation',
    body: `Réponse de ${dispute.storeName} à votre contestation sur l’opération ${dispute.operationReference} : « ${disputeExcerpt(dispute.message)} ».`,
  };
}

/** To the user: a manager reset their access (14a). */
export function accessResetMessage(reset: {
  storeName: string;
}): NotificationMessage {
  return {
    title: 'Accès réinitialisé',
    body: `${reset.storeName} a réinitialisé votre accès à Bâtisso. Connectez-vous avec un code SMS et choisissez un nouveau code PIN. Si vous n’avez rien demandé, contactez cette quincaillerie.`,
  };
}

/**
 * To the customer: an admin suspended or reactivated one of their accounts
 * (16b). Never the reason: it is for staff and admins only.
 */
export function accountStatusMessage(change: {
  suspended: boolean;
  accountNumber: string;
  storeName: string;
}): NotificationMessage {
  return change.suspended
    ? {
        title: 'Compte suspendu',
        body: `Votre compte ${change.accountNumber} chez ${change.storeName} est suspendu : il ne reçoit plus de dépôts et vous ne pouvez plus déplacer d’argent entre vos objectifs. Vos achats de matériaux restent possibles. Renseignez-vous auprès de la quincaillerie.`,
      }
    : {
        title: 'Compte réactivé',
        body: `Votre compte ${change.accountNumber} chez ${change.storeName} est de nouveau actif : les dépôts et les mouvements entre vos objectifs reprennent.`,
      };
}

/** To the user: their security answers just reset their access (14b). */
export function accessRecoveredMessage(): NotificationMessage {
  return {
    title: 'Accès récupéré',
    body: 'Votre accès à Bâtisso a été récupéré avec vos questions de sécurité et votre code PIN a changé. Si ce n’est pas vous, voyez vite votre quincaillerie.',
  };
}

/** To the store's managers: the customer closed their dispute (12). */
export function disputeClosedMessage(dispute: {
  operationReference: string;
  accountNumber: string;
}): NotificationMessage {
  return {
    title: 'Contestation close',
    body: `Le client du compte ${dispute.accountNumber} a clos sa contestation sur l’opération ${dispute.operationReference}.`,
  };
}
