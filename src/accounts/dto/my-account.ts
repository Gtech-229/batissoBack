import { ApiProperty, OmitType } from '@nestjs/swagger';
import type {
  Account,
  Goal,
  HardwareStore,
  Project,
  User,
} from '../../generated/prisma/client.js';
import { AccountDetail, toAccountFields } from './account-detail.js';

export class MyAccountStore {
  @ApiProperty({
    description: 'Identifiant de la quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({
    description: 'Nom de la quincaillerie',
    example: 'Quincaillerie du Carrefour',
  })
  name: string;
}

/** One of the signed-in customer's accounts: the detail, with its store, without who opened it. */
export class MyAccount extends OmitType(AccountDetail, [
  'openedBy',
  'hasIdPhoto',
] as const) {
  @ApiProperty({
    description: 'Quincaillerie du compte',
    type: MyAccountStore,
  })
  store: MyAccountStore;
}

export function toMyAccount(
  account: Account & {
    customer: User;
    goals: Goal[];
    projects: Project[];
    store: Pick<HardwareStore, 'id' | 'name'>;
  },
): MyAccount {
  return {
    ...toAccountFields(account),
    store: { id: account.store.id, name: account.store.name },
  };
}
