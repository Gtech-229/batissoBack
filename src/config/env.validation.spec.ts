import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { Environment, validate } from './env.validation.js';

const VALID_URL = 'postgresql://batisso:batisso@localhost:5432/batisso';
const SECRET = 'x'.repeat(32);
const PEPPER = 'p'.repeat(32);
/** The smallest valid environment. */
const BASE = {
  DATABASE_URL: VALID_URL,
  JWT_ACCESS_SECRET: SECRET,
  PIN_PEPPER: PEPPER,
  ADMIN_WEB_URL: 'http://localhost:5173',
};

describe('validate (environment variables)', () => {
  it('accepts a valid environment and converts PORT to a number', () => {
    const env = validate({ ...BASE, PORT: '4000', NODE_ENV: 'test' });

    expect(env.DATABASE_URL).toBe(VALID_URL);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe(Environment.Test);
  });

  it('applies defaults when optional variables are missing', () => {
    const env = validate(BASE);

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe(Environment.Development);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.SUPER_ADMIN_EMAIL).toBeUndefined();
    expect(env.SUPER_ADMIN_PASSWORD).toBeUndefined();
  });

  it('accepts the short postgres:// scheme', () => {
    expect(() =>
      validate({ ...BASE, DATABASE_URL: 'postgres://u:p@localhost:5432/db' }),
    ).not.toThrow();
  });

  it('rejects a missing DATABASE_URL and names the variable', () => {
    expect(() => validate({ JWT_ACCESS_SECRET: SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it.each([
    ['an http URL', 'http://localhost:5432/batisso'],
    ['plain text', 'not-a-url'],
    ['an empty string', ''],
  ])('rejects DATABASE_URL as %s', (_label, value) => {
    expect(() => validate({ ...BASE, DATABASE_URL: value })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a non-numeric PORT and names the variable', () => {
    expect(() => validate({ ...BASE, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validate({ ...BASE, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  describe('CORS_ORIGINS', () => {
    it('splits a comma-separated list and trims spaces', () => {
      const env = validate({
        ...BASE,
        CORS_ORIGINS: 'http://localhost:5173, https://admin.batisso.com ,',
      });

      expect(env.CORS_ORIGINS).toEqual([
        'http://localhost:5173',
        'https://admin.batisso.com',
      ]);
    });

    it.each([
      ['a bare host', 'admin.batisso.com'],
      ['another protocol', 'ftp://admin.batisso.com'],
      ['one bad entry in the list', 'http://localhost:5173,not a url'],
    ])('rejects %s', (_label, value) => {
      expect(() => validate({ ...BASE, CORS_ORIGINS: value })).toThrow(
        /CORS_ORIGINS/,
      );
    });
  });

  describe('ADMIN_WEB_URL', () => {
    it('is required', () => {
      const { ADMIN_WEB_URL: _omitted, ...withoutUrl } = BASE;

      expect(() => validate(withoutUrl)).toThrow(/ADMIN_WEB_URL/);
    });

    it('drops trailing slashes', () => {
      expect(
        validate({ ...BASE, ADMIN_WEB_URL: 'https://admin.batisso.com//' })
          .ADMIN_WEB_URL,
      ).toBe('https://admin.batisso.com');
    });

    it.each([
      ['a bare host', 'admin.batisso.com'],
      ['another protocol', 'ftp://admin.batisso.com'],
      ['an empty string', ''],
    ])('rejects %s', (_label, value) => {
      expect(() => validate({ ...BASE, ADMIN_WEB_URL: value })).toThrow(
        /ADMIN_WEB_URL/,
      );
    });
  });

  describe('JWT_ACCESS_SECRET', () => {
    it('is required', () => {
      expect(() => validate({ DATABASE_URL: VALID_URL })).toThrow(
        /JWT_ACCESS_SECRET/,
      );
    });

    it('rejects a secret shorter than 32 characters', () => {
      expect(() =>
        validate({ ...BASE, JWT_ACCESS_SECRET: 'x'.repeat(31) }),
      ).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('refuses the .env.example placeholder, so an unedited copy cannot start (F-03)', () => {
      const example = parseEnv(readFileSync('.env.example', 'utf8'));

      expect(example.JWT_ACCESS_SECRET).toBeDefined();
      expect(() => validate({ ...example })).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('never puts the secret value in the error message', () => {
      const tooShort = 'short-secret-value';

      expect(() => validate({ ...BASE, JWT_ACCESS_SECRET: tooShort })).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(tooShort) as string,
        }),
      );
    });
  });

  describe('ID_PHOTO_DIR', () => {
    it('defaults to storage/id-photos', () => {
      expect(validate(BASE).ID_PHOTO_DIR).toBe('storage/id-photos');
    });

    it('keeps a configured directory', () => {
      expect(
        validate({ ...BASE, ID_PHOTO_DIR: '/var/batisso/id-photos' })
          .ID_PHOTO_DIR,
      ).toBe('/var/batisso/id-photos');
    });

    it('refuses an empty value', () => {
      expect(() => validate({ ...BASE, ID_PHOTO_DIR: '' })).toThrow(
        /ID_PHOTO_DIR/,
      );
    });
  });

  describe('STORE_DOCUMENT_DIR', () => {
    it('defaults to storage/store-documents', () => {
      expect(validate(BASE).STORE_DOCUMENT_DIR).toBe('storage/store-documents');
    });

    it('refuses an empty value', () => {
      expect(() => validate({ ...BASE, STORE_DOCUMENT_DIR: '' })).toThrow(
        /STORE_DOCUMENT_DIR/,
      );
    });
  });

  describe('PIN_PEPPER', () => {
    it('is required', () => {
      const { PIN_PEPPER: _omitted, ...withoutPepper } = BASE;

      expect(() => validate(withoutPepper)).toThrow(/PIN_PEPPER/);
    });

    it('rejects a pepper shorter than 32 characters', () => {
      expect(() => validate({ ...BASE, PIN_PEPPER: 'p'.repeat(31) })).toThrow(
        /PIN_PEPPER/,
      );
    });

    it('refuses the .env.example placeholder, so an unedited copy cannot start', () => {
      const example = parseEnv(readFileSync('.env.example', 'utf8'));

      expect(example.PIN_PEPPER).toBeDefined();
      expect(() =>
        validate({ ...BASE, PIN_PEPPER: example.PIN_PEPPER }),
      ).toThrow(/PIN_PEPPER/);
    });

    it('never puts the pepper value in the error message', () => {
      const tooShort = 'short-pepper-value';

      expect(() => validate({ ...BASE, PIN_PEPPER: tooShort })).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(tooShort) as string,
        }),
      );
    });
  });

  describe('super admin variables', () => {
    it('normalizes SUPER_ADMIN_EMAIL to trimmed lowercase', () => {
      const env = validate({
        ...BASE,
        SUPER_ADMIN_EMAIL: '  Admin@Batisso.COM ',
      });

      expect(env.SUPER_ADMIN_EMAIL).toBe('admin@batisso.com');
    });

    it('rejects an invalid SUPER_ADMIN_EMAIL', () => {
      expect(() =>
        validate({ ...BASE, SUPER_ADMIN_EMAIL: 'not-an-email' }),
      ).toThrow(/SUPER_ADMIN_EMAIL/);
    });

    it('accepts a SUPER_ADMIN_PASSWORD that follows the rule', () => {
      expect(
        validate({ ...BASE, SUPER_ADMIN_PASSWORD: 'Batisso#2026' })
          .SUPER_ADMIN_PASSWORD,
      ).toBe('Batisso#2026');
    });

    it('refuses the .env.example placeholder, so a published password never creates the super admin (F-04)', () => {
      const example = parseEnv(readFileSync('.env.example', 'utf8'));
      const placeholder = example.SUPER_ADMIN_PASSWORD ?? '';
      const withPlaceholder = () =>
        validate({ ...BASE, SUPER_ADMIN_PASSWORD: placeholder });

      expect(placeholder).not.toBe('');
      expect(withPlaceholder).toThrow(/SUPER_ADMIN_PASSWORD/);
      expect(withPlaceholder).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(placeholder) as string,
        }),
      );
    });

    it('rejects a weak SUPER_ADMIN_PASSWORD without echoing it', () => {
      expect(() =>
        validate({ ...BASE, SUPER_ADMIN_PASSWORD: 'weakpassword' }),
      ).toThrow(
        expect.objectContaining({
          message: expect.stringMatching(
            /^(?=.*SUPER_ADMIN_PASSWORD)(?!.*weakpassword)/s,
          ) as string,
        }),
      );
    });
  });
});
