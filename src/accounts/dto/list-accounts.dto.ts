import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { formatAmount } from '../../common/money.js';
import { PaginationQueryDto } from '../../common/pagination.js';
import { Trim } from '../../common/validation/trim.js';
import {
  AccountStatus,
  type Account,
  type User,
} from '../../generated/prisma/client.js';
import { AccountCustomerView } from './account-detail.js';

/** `GET /stores/:storeId/accounts?page=1&pageSize=20&q=keita` */
export class ListAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Recherche dans le numéro de compte, le téléphone du client (format local ou international) ou ses nom et prénom, sans tenir compte des majuscules',
    example: 'keita',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La recherche doit être un texte' })
  @Length(1, 100, { message: 'La recherche doit contenir 1 à 100 caractères' })
  q?: string;
}

/** One line of the staff account list (the detail route gives the rest). */
export class AccountSummary {
  @ApiProperty({
    description: 'Identifiant du compte',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({ description: 'Numéro du compte', example: 'C-000123' })
  number: string;

  @ApiProperty({
    description: 'État',
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
  })
  status: AccountStatus;

  @ApiProperty({
    description: 'Solde, en unités de la devise, en texte',
    example: '0',
  })
  balance: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ description: 'Titulaire', type: AccountCustomerView })
  customer: AccountCustomerView;

  @ApiProperty({
    description: 'Date d’ouverture',
    example: '2026-10-14T10:00:00.000Z',
  })
  createdAt: Date;
}

export function toAccountSummary(
  account: Account & { customer: User },
): AccountSummary {
  return {
    id: account.id,
    number: account.number,
    status: account.status,
    balance: formatAmount(account.balance),
    currencyCode: account.currencyCode,
    customer: {
      userId: account.customer.id,
      firstName: account.customer.firstName,
      lastName: account.customer.lastName,
      phone: account.customer.phone,
    },
    createdAt: account.createdAt,
  };
}
