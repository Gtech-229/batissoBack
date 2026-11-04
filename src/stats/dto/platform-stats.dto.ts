import { ApiProperty } from '@nestjs/swagger';

export class StoreStatusCounts {
  @ApiProperty({ example: 2 }) PENDING: number;
  @ApiProperty({ example: 14 }) VERIFIED: number;
  @ApiProperty({ example: 1 }) SUSPENDED: number;
  @ApiProperty({ example: 0 }) CLOSED: number;
}

export class SubscriptionStateCounts {
  @ApiProperty({ example: 12 }) ACTIVE: number;
  @ApiProperty({ example: 1 }) UPCOMING: number;
  @ApiProperty({ example: 2 }) EXPIRED: number;
  @ApiProperty({ example: 2 }) NONE: number;
}

export class StoreFigures {
  @ApiProperty({
    description: 'Quincailleries par statut, à la date de la demande',
    type: StoreStatusCounts,
  })
  byStatus: StoreStatusCounts;

  @ApiProperty({
    description:
      'Quincailleries par état d’abonnement du jour (UTC), comme dans la liste des quincailleries',
    type: SubscriptionStateCounts,
  })
  bySubscription: SubscriptionStateCounts;

  @ApiProperty({
    description: 'Quincailleries inscrites pendant la période',
    example: 3,
  })
  registered: number;
}

export class AccountFigures {
  @ApiProperty({
    description: 'Comptes clients, à la date de la demande',
    example: 420,
  })
  total: number;

  @ApiProperty({
    description: 'Comptes suspendus, à la date de la demande',
    example: 2,
  })
  suspended: number;

  @ApiProperty({
    description: 'Comptes ouverts pendant la période',
    example: 35,
  })
  opened: number;

  @ApiProperty({
    description:
      'Comptes ayant reçu au moins un dépôt confirmé pendant la période',
    example: 210,
  })
  active: number;
}

/** Signals of trust in the register, as the plan's pilot indicators name them. */
export class TrustFigures {
  @ApiProperty({
    description: 'Contestations ouvertes pendant la période',
    example: 4,
  })
  disputesOpened: number;

  @ApiProperty({
    description:
      'Contestations en cours (OPEN ou ANSWERED), à la date de la demande',
    example: 2,
  })
  disputesUnresolved: number;

  @ApiProperty({
    description: 'Corrections confirmées pendant la période',
    example: 3,
  })
  corrections: number;

  @ApiProperty({
    description:
      'Bons refusés pendant la période, par le gérant ou par le client',
    example: 5,
  })
  ordersRefused: number;

  @ApiProperty({
    description: 'Clôtures de caisse de la période avec un écart non nul',
    example: 1,
  })
  closingsWithDiscrepancy: number;
}

/** One block of counts, for the platform or one country. Counts only, never amounts. */
export class Figures {
  @ApiProperty({ type: StoreFigures })
  stores: StoreFigures;

  @ApiProperty({ type: AccountFigures })
  accounts: AccountFigures;

  @ApiProperty({ type: TrustFigures })
  trust: TrustFigures;
}

export class CountryFigures extends Figures {
  @ApiProperty({ example: 'ML' })
  countryCode: string;

  @ApiProperty({ example: 'Mali' })
  name: string;
}

export class StatsPeriod {
  @ApiProperty({ example: '2026-11-01' })
  from: string;

  @ApiProperty({ example: '2026-11-30' })
  to: string;
}

export class PlatformStats {
  @ApiProperty({
    description: 'La période demandée, jours UTC inclus',
    type: StatsPeriod,
  })
  period: StatsPeriod;

  @ApiProperty({
    description: 'Les chiffres de toute la plateforme : la somme des pays',
    type: Figures,
  })
  platform: Figures;

  @ApiProperty({
    description:
      'Les chiffres de chaque pays qui a au moins une quincaillerie, par code',
    type: [CountryFigures],
  })
  countries: CountryFigures[];
}
