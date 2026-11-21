import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { countryInactive, invalidFields } from '../stores.errors.js';
import type { StoresService } from '../stores.service.js';
import { STORE_IMPORT_COLUMN_NAMES } from './store-import-columns.js';
import { rowErrorsOf, StoreImportService } from './store-import.service.js';

const VALID: Record<string, string> = {
  countryCode: 'ML',
  name: 'Quincaillerie du Carrefour',
  address: 'Rue 12',
  city: 'Bamako',
  phone: '20 22 00 00',
  tradeRegister: 'TR-1',
  'settings.maxBalance': '2000000',
  'settings.validationThreshold': '200000',
  'settings.minDeposit': '500',
  'manager.firstName': 'Awa',
  'manager.lastName': 'Diallo',
  'manager.phone': '76 00 00 00',
};

/** A CSV of valid rows whose trade registers are TR-1, TR-2, ... */
function csv(count: number) {
  const columns = STORE_IMPORT_COLUMN_NAMES.filter((name) => name in VALID);
  const rows = Array.from({ length: count }, (_, i) =>
    columns
      .map((name) => (name === 'tradeRegister' ? `TR-${i + 1}` : VALID[name]))
      .join(';'),
  );
  return {
    buffer: Buffer.from([columns.join(';'), ...rows].join('\n')),
    originalname: 'a.csv',
  };
}

function serviceWith(register: StoresService['register']) {
  const prisma = {
    country: { findMany: async () => [{ code: 'ML', active: true }] },
    // No registered store holds these trade registers.
    $queryRaw: async () => [],
  } as unknown as PrismaService;
  const stores = {
    registrationErrors: () => [],
    register,
  } as unknown as StoresService;
  return new StoreImportService(prisma, stores);
}

describe('StoreImportService.import (dryRun=false)', () => {
  it('creates each row on its own: a refused row leaves the others', async () => {
    const calls: string[] = [];
    const service = serviceWith(async (dto) => {
      calls.push(dto.tradeRegister);
      if (dto.tradeRegister === 'TR-2') {
        throw countryInactive('ML');
      }
      return { id: `store-${dto.tradeRegister}` } as never;
    });

    const result = await service.import(csv(3), false, 'admin-1');

    expect(calls).toEqual(['TR-1', 'TR-2', 'TR-3']);
    expect(result).toEqual({
      total: 3,
      created: 2,
      rejected: 1,
      rows: [
        { row: 2, status: 'created', storeId: 'store-TR-1', errors: [] },
        {
          row: 3,
          status: 'rejected',
          errors: [
            {
              field: 'countryCode',
              message:
                'Le pays ML n’est pas actif : activez-le avant d’y inscrire une quincaillerie',
            },
          ],
        },
        { row: 4, status: 'created', storeId: 'store-TR-3', errors: [] },
      ],
    });
  });

  it('lets an unexpected error fail the request', async () => {
    const service = serviceWith(async () => {
      throw new Error('connection lost');
    });

    await expect(service.import(csv(2), false, 'admin-1')).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('rowErrorsOf', () => {
  it('keeps field errors, one entry per message', () => {
    expect(
      rowErrorsOf(
        invalidFields([
          { field: 'manager.phone', errors: ['a', 'b'] },
          { field: 'phone', errors: ['c'] },
        ]),
      ),
    ).toEqual([
      { field: 'manager.phone', message: 'a' },
      { field: 'manager.phone', message: 'b' },
      { field: 'phone', message: 'c' },
    ]);
  });

  it('puts another refusal on no column', () => {
    expect(
      rowErrorsOf(
        new ConflictException({ message: 'Autre refus', error: 'X' }),
      ),
    ).toEqual([{ field: '', message: 'Autre refus' }]);
    expect(rowErrorsOf(new ForbiddenException('Interdit'))).toEqual([
      { field: '', message: 'Interdit' },
    ]);
  });
});
