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
