import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { paginated, PaginationQueryDto, toSkipTake } from './pagination.js';

/** What the global ValidationPipe does with a query string. */
function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(PaginationQueryDto, query);
  const errors = validateSync(dto).map((e) => e.property);
  return { dto, errors };
}

describe('PaginationQueryDto', () => {
  it('defaults to page 1 of 20 when nothing is sent', () => {
    const { dto, errors } = parse({});

    expect(errors).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
  });

  it('converts query strings to numbers', () => {
    const { dto, errors } = parse({ page: '3', pageSize: '50' });

    expect(errors).toEqual([]);
    expect(dto.page).toBe(3);
    expect(dto.pageSize).toBe(50);
  });

  it('accepts the largest page size and the last allowed page', () => {
    expect(parse({ pageSize: '100', page: '100000' }).errors).toEqual([]);
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '-1' }, 'page'],
    [{ page: '1.5' }, 'page'],
    [{ page: 'abc' }, 'page'],
    [{ page: '' }, 'page'],
    [{ page: '100001' }, 'page'],
    [{ page: '100000000000000000000' }, 'page'],
    [{ pageSize: '0' }, 'pageSize'],
    [{ pageSize: '101' }, 'pageSize'],
    [{ pageSize: '2.5' }, 'pageSize'],
  ])('rejects %o', (query, field) => {
    expect(parse(query).errors).toEqual([field]);
  });
});

describe('toSkipTake', () => {
  it.each([
    [1, 20, { skip: 0, take: 20 }],
    [2, 20, { skip: 20, take: 20 }],
    [5, 10, { skip: 40, take: 10 }],
  ])('page %i of %i', (page, pageSize, expected) => {
    expect(toSkipTake({ page, pageSize })).toEqual(expected);
  });
});

describe('paginated', () => {
  it('wraps items with the total and the requested page', () => {
    expect(paginated(['a', 'b'], 42, { page: 2, pageSize: 2 })).toEqual({
      items: ['a', 'b'],
      total: 42,
      page: 2,
      pageSize: 2,
    });
  });

  it('keeps the real total on a page past the end', () => {
    expect(paginated([], 3, { page: 9, pageSize: 20 }).total).toBe(3);
  });
});
