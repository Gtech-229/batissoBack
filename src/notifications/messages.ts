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
