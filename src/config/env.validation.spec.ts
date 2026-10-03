import 'reflect-metadata';
import { Environment, validate } from './env.validation.js';

const VALID_URL = 'postgresql://batisso:batisso@localhost:5432/batisso';

describe('validate (environment variables)', () => {
  it('accepts a valid environment and converts PORT to a number', () => {
    const env = validate({
      DATABASE_URL: VALID_URL,
      PORT: '4000',
      NODE_ENV: 'test',
    });

    expect(env.DATABASE_URL).toBe(VALID_URL);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe(Environment.Test);
  });

  it('applies defaults when PORT and NODE_ENV are missing', () => {
    const env = validate({ DATABASE_URL: VALID_URL });

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe(Environment.Development);
  });

  it('accepts the short postgres:// scheme', () => {
    expect(() =>
      validate({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' }),
    ).not.toThrow();
  });

  it('rejects a missing DATABASE_URL and names the variable', () => {
    expect(() => validate({ PORT: '3000' })).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['an http URL', 'http://localhost:5432/batisso'],
    ['plain text', 'not-a-url'],
    ['an empty string', ''],
  ])('rejects DATABASE_URL as %s', (_label, value) => {
    expect(() => validate({ DATABASE_URL: value })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric PORT and names the variable', () => {
    expect(() => validate({ DATABASE_URL: VALID_URL, PORT: 'abc' })).toThrow(
      /PORT/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() =>
      validate({ DATABASE_URL: VALID_URL, NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV/);
  });
});
