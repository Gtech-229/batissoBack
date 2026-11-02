import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationMeta, PaginationQueryDto } from '../../common/pagination.js';
import { StoreMemberRole } from '../../generated/prisma/client.js';

/** A number of operations and their sum, in the smallest unit of the currency. */
export class ReportCount {
  @ApiProperty({ description: 'Nombre', example: 12 })
  count: number;

  @ApiProperty({ description: 'Montant total', example: '185000' })
  total: string;
}

export class TotalsReport {
  @ApiProperty({ description: 'Premier jour, inclus', example: '2026-10-01' })
  from: string;

  @ApiProperty({ description: 'Dernier jour, inclus', example: '2026-10-31' })
  to: string;

  @ApiProperty({ description: 'Devise', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ description: 'Dépôts', type: ReportCount })
  deposits: ReportCount;

  @ApiProperty({
    description: 'Corrections de dépôts (débits)',
    type: ReportCount,
  })
  corrections: ReportCount;

  @ApiProperty({ description: 'Achats de matériaux', type: ReportCount })
  purchases: ReportCount;

  @ApiProperty({
    description: 'Recrédits après annulation d’un bon payé',
    type: ReportCount,
  })
  recredits: ReportCount;

  @ApiProperty({
    description:
      'Espèces reçues : les dépôts en espèces moins leurs corrections, comme une clôture de caisse. Peut être négatif.',
    example: '170000',
  })
  netCash: string;
}

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export class CustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Seulement les clients actifs, ou inactifs',
    enum: CUSTOMER_STATUSES,
  })
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES, {
    message: 'Le statut doit être ACTIVE ou INACTIVE',
  })
  status?: CustomerStatus;
}

export class CustomerReportRow {
  @ApiProperty({
    description: 'Identifiant du compte',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  accountId: string;

  @ApiProperty({ description: 'Numéro du compte', example: 'C-000042' })
  accountNumber: string;

  @ApiProperty({ description: 'Prénom', example: 'Fanta' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Coulibaly' })
  lastName: string;

  @ApiProperty({ description: 'Solde', example: '85000' })
  balance: string;

  @ApiProperty({
    description: 'Date du dernier dépôt ; null s’il n’y en a aucun',
    example: '2026-10-28T09:30:00.000Z',
    nullable: true,
    type: String,
  })
  lastDepositAt: Date | null;

  @ApiProperty({
    description:
      'Actif : un dépôt depuis moins de 30 jours (ou un compte ouvert depuis moins de 30 jours)',
    enum: CUSTOMER_STATUSES,
    example: 'ACTIVE',
  })
  status: CustomerStatus;
}

export class CustomersReport extends PaginationMeta {
  @ApiProperty({ description: 'La page', type: [CustomerReportRow] })
  items: CustomerReportRow[];

  @ApiProperty({
    description: 'Clients actifs, quel que soit le filtre',
    example: 34,
  })
  activeCount: number;

  @ApiProperty({
    description: 'Clients inactifs, quel que soit le filtre',
    example: 8,
  })
  inactiveCount: number;
}

export class SellerReportRow {
  @ApiProperty({
    description: 'Identifiant de l’utilisateur',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  userId: string;

  @ApiProperty({ description: 'Prénom', example: 'Moussa' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Traoré' })
  lastName: string;

  @ApiProperty({
    description: 'Rôle dans la quincaillerie',
    enum: StoreMemberRole,
    example: StoreMemberRole.SELLER,
  })
  role: StoreMemberRole;

  @ApiProperty({
    description: 'Membre actif ; faux pour un ancien membre',
    example: true,
  })
  active: boolean;

  @ApiProperty({ description: 'Dépôts enregistrés', type: ReportCount })
  deposits: ReportCount;

  @ApiProperty({
    description: 'Bons préparés, quel qu’en soit le sort',
    example: 7,
  })
  ordersPrepared: number;

  @ApiProperty({
    description: 'Parmi les bons préparés, ceux qui ont été payés',
    type: ReportCount,
  })
  ordersPaid: ReportCount;

  @ApiProperty({
    description: 'Corrections faites sur ses dépôts pendant la période',
    example: 1,
  })
  correctionsOnDeposits: number;
}

export class SellersReport {
  @ApiProperty({ description: 'Premier jour, inclus', example: '2026-10-01' })
  from: string;

  @ApiProperty({ description: 'Dernier jour, inclus', example: '2026-10-31' })
  to: string;

  @ApiProperty({ description: 'Devise', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({
    description:
      'Les membres actifs, et les anciens membres actifs pendant la période',
    type: [SellerReportRow],
  })
  staff: SellerReportRow[];
}
