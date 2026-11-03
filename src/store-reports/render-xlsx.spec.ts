import { readSheet } from 'read-excel-file/node';
import { renderXlsx } from './render-xlsx.js';
import type { ReportTable } from './report-table.js';

const table = (rows: ReportTable['rows']): ReportTable => ({
  title: 'Titre',
  subtitle: 'Sous-titre',
  columns: [
    { label: 'Nom', kind: 'text' },
    { label: 'Montant', kind: 'amount' },
  ],
  rows,
});

const rowsOf = async (rows: ReportTable['rows']) =>
  (await readSheet(await renderXlsx(table(rows)))).slice(4);

describe('renderXlsx', () => {
  it('writes amounts as numbers, to add up in Excel', async () => {
    expect(await rowsOf([['Dépôts', 25000n]])).toEqual([['Dépôts', 25000]]);
  });

  it('keeps a value past the safe integers as text, with every digit', async () => {
    expect(await rowsOf([['Dépôts', 9007199254740993n]])).toEqual([
      ['Dépôts', '9007199254740993'],
    ]);
  });

  it('keeps a negative amount', async () => {
    expect(await rowsOf([['Espèces', -400n]])).toEqual([['Espèces', -400]]);
  });

  it('writes a formula-like name as text, never as a formula', async () => {
    // A formula has no cached value here: reading the text back proves it is text.
    const buffer = await renderXlsx(table([['=1+1', 1n]]));

    expect((await readSheet(buffer)).slice(4)).toEqual([['=1+1', 1]]);
  });

  it('keeps French accents', async () => {
    expect(await rowsOf([['Émile Traoré', 1n]])).toEqual([['Émile Traoré', 1]]);
  });
});
