import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { Trim } from '../../common/validation/trim.js';
import {
  AccountStatus,
  type Account,
  type HardwareStore,
  type User,
} from '../../generated/prisma/client.js';

/** `GET /admin/accounts?q=keita&storeId=...&status=SUSPENDED&page=1` */
export class AdminAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Recherche dans le numéro de compte, les nom et prénom du client (sans tenir compte des majuscules) ou les chiffres de son téléphone',
    example: 'keita',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La recherche doit être un texte' })
  @Length(1, 100, { message: 'La recherche doit contenir 1 à 100 caractères' })
  q?: string;

  @ApiPropertyOptional({
    description: 'Seulement les comptes de cette quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'Identifiant de quincaillerie invalide' })
  storeId?: string;

  @ApiPropertyOptional({ enum: AccountStatus, description: 'Filtrer par état' })
  @IsOptional()
  @IsEnum(AccountStatus, { message: 'L’état doit être ACTIVE ou SUSPENDED' })
  status?: AccountStatus;
}

export class AdminAccountStore {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;
}

export class AdminAccountCustomer {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0e' })
  id: string;

  @ApiProperty({ example: 'Moussa' })
  firstName: string;

  @ApiProperty({ example: 'Keita' })
  lastName: string;

  @ApiProperty({ description: 'Format E.164', example: '+22376000000' })
  phone: string;
}

/**
 * An account as an admin sees it: enough to find it and decide on a
 * suspension. Never its balance, operations, photo or beneficiary.
 */
export class AdminAccountSummary {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0f' })
  id: string;

  @ApiProperty({ description: 'Numéro du compte', example: 'C-000123' })
  number: string;

  @ApiProperty({ type: AdminAccountStore })
  store: AdminAccountStore;

  @ApiProperty({ type: AdminAccountCustomer })
  customer: AdminAccountCustomer;

  @ApiProperty({
    description:
      'ACTIVE, ou SUSPENDED : plus de dépôts ni de mouvements entre objectifs, les achats restent possibles',
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
  })
  status: AccountStatus;

  @ApiProperty({
    description: 'Motif de la suspension en cours, null sinon',
    type: String,
    nullable: true,
    example: null,
  })
  statusReason: string | null;

  @ApiProperty({
    description: 'Date du dernier changement d’état (ISO 8601, UTC)',
    type: String,
    nullable: true,
    example: null,
  })
  statusChangedAt: string | null;

  @ApiProperty({ example: '2026-10-06T09:00:00.000Z' })
  createdAt: string;
}

export type AccountWithOwner = Account & {
  store: Pick<HardwareStore, 'id' | 'name'>;
  customer: Pick<User, 'id' | 'firstName' | 'lastName' | 'phone'>;
};

export const ADMIN_ACCOUNT_INCLUDE = {
  store: { select: { id: true, name: true } },
  customer: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
} as const;

export function toAdminAccountSummary(
  account: AccountWithOwner,
): AdminAccountSummary {
  return {
    id: account.id,
    number: account.number,
    store: { id: account.store.id, name: account.store.name },
    customer: {
      id: account.customer.id,
      firstName: account.customer.firstName,
      lastName: account.customer.lastName,
      phone: account.customer.phone,
    },
    status: account.status,
    statusReason: account.statusReason,
    statusChangedAt: account.statusChangedAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}
