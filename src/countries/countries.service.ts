import { Injectable } from '@nestjs/common';
import { definedOnly } from '../common/defined-only.js';
import { getPhonePrefix, isPhoneCountry } from '../common/phone.js';
import { Prisma, StoreStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  anotherCountryActive,
  countryAlreadyExists,
  countryInUse,
  countryNotFound,
  unsupportedCountryCode,
} from './countries.errors.js';
import { CountrySummary, toCountrySummary } from './dto/country-summary.js';
import type { CreateCountryDto } from './dto/create-country.dto.js';
import type { UpdateCountryDto } from './dto/update-country.dto.js';

@Injectable()
export class CountriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** New countries start inactive; the phone prefix comes from the ISO code. */
  async create(dto: CreateCountryDto): Promise<CountrySummary> {
    if (!isPhoneCountry(dto.code)) {
      throw unsupportedCountryCode(dto.code);
    }
    try {
      const country = await this.prisma.country.create({
        data: {
          code: dto.code,
          name: dto.name,
          phonePrefix: getPhonePrefix(dto.code),
          currencyCode: dto.currencyCode,
          currencySymbol: dto.currencySymbol,
          decimals: dto.decimals,
          language: dto.language,
        },
      });
      return toCountrySummary(country);
    } catch (error) {
      // P2002: the code already exists. Caught rather than checked first, so
      // two simultaneous creations cannot both pass.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw countryAlreadyExists();
      }
      throw error;
    }
  }

  async findAll(): Promise<CountrySummary[]> {
    const countries = await this.prisma.country.findMany({
      orderBy: { code: 'asc' },
    });
    return countries.map(toCountrySummary);
  }

  async findOne(code: string): Promise<CountrySummary> {
    const country = await this.prisma.country.findUnique({ where: { code } });
    if (!country) {
      throw countryNotFound();
    }
    return toCountrySummary(country);
  }

  /**
   * Partial update. The currency and its decimals are frozen once the country
   * has a store: every amount stored there is expressed in that currency.
   */
  async update(code: string, dto: UpdateCountryDto): Promise<CountrySummary> {
    const changes = definedOnly(dto);

    return this.prisma.$transaction(async (tx) => {
      // Locked like deactivate, so a store registration cannot slip in between
      // the store count and the currency change.
      const [current] = await tx.$queryRaw<
        { currencyCode: string; decimals: number }[]
      >`SELECT "currencyCode", "decimals" FROM "countries" WHERE "code" = ${code} FOR UPDATE`;
      if (!current) {
        throw countryNotFound();
      }

      const currencyChanges =
        (changes.currencyCode !== undefined &&
          changes.currencyCode !== current.currencyCode) ||
        (changes.decimals !== undefined &&
          changes.decimals !== current.decimals);
      if (currencyChanges) {
        // Closed stores count too: their history is still in this currency.
        const stores = await tx.hardwareStore.count({
          where: { countryCode: code },
        });
        if (stores > 0) {
          throw countryInUse(
            'La devise d’un pays qui a des quincailleries ne peut plus changer',
          );
        }
      }

      const updated = await tx.country.update({
        where: { code },
        data: changes,
      });
      return toCountrySummary(updated);
    });
  }

  /**
   * Makes this country the active one. V1 allows a single active country, so
   * activating while another is active is refused instead of switching.
   */
  async activate(code: string): Promise<CountrySummary> {
    return this.prisma.$transaction(async (tx) => {
      // Two activations of different countries could both see "none active".
      // This transaction-scoped lock makes them run one after the other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('countries:activation'))`;

      const country = await tx.country.findUnique({ where: { code } });
      if (!country) {
        throw countryNotFound();
      }
      if (country.active) {
        return toCountrySummary(country);
      }
      const otherActive = await tx.country.findFirst({
        where: { active: true },
        select: { code: true },
      });
      if (otherActive) {
        throw anotherCountryActive(otherActive.code);
      }
      const updated = await tx.country.update({
        where: { code },
        data: { active: true },
      });
      return toCountrySummary(updated);
    });
  }

  /** Refused while the country still has a store that is not closed. */
  async deactivate(code: string): Promise<CountrySummary> {
    return this.prisma.$transaction(async (tx) => {
      // Locks the row so a store registration (which reads it) cannot slip in
      // between the check below and the update.
      const [locked] = await tx.$queryRaw<{ active: boolean }[]>`
        SELECT "active" FROM "countries" WHERE "code" = ${code} FOR UPDATE`;
      if (!locked) {
        throw countryNotFound();
      }
      if (locked.active) {
        const openStores = await tx.hardwareStore.count({
          where: { countryCode: code, status: { not: StoreStatus.CLOSED } },
        });
        if (openStores > 0) {
          throw countryInUse(
            `Ce pays a encore ${openStores} quincaillerie(s) non fermée(s)`,
          );
        }
      }
      const updated = await tx.country.update({
        where: { code },
        data: { active: false },
      });
      return toCountrySummary(updated);
    });
  }
}
