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

  describe('SWAGGER_USER and SWAGGER_PASSWORD (docs in production)', () => {
    const DOCS_PASSWORD = 'docs-password-0123456789';

    it('are unset by default', () => {
      const env = validate(BASE);

      expect(env.SWAGGER_USER).toBeUndefined();
      expect(env.SWAGGER_PASSWORD).toBeUndefined();
    });

    it('accept both together', () => {
      const env = validate({
        ...BASE,
        SWAGGER_USER: 'frontdev',
        SWAGGER_PASSWORD: DOCS_PASSWORD,
      });

      expect(env.SWAGGER_USER).toBe('frontdev');
      expect(env.SWAGGER_PASSWORD).toBe(DOCS_PASSWORD);
    });

    it('read empty values as unset', () => {
      const env = validate({ ...BASE, SWAGGER_USER: '', SWAGGER_PASSWORD: '' });

      expect(env.SWAGGER_USER).toBeUndefined();
      expect(env.SWAGGER_PASSWORD).toBeUndefined();
    });

    it.each([
      ['only the user', { SWAGGER_USER: 'frontdev' }],
      ['only the password', { SWAGGER_PASSWORD: DOCS_PASSWORD }],
      [
        'the user and an empty password',
        { SWAGGER_USER: 'frontdev', SWAGGER_PASSWORD: '' },
      ],
    ])('reject %s, naming both variables', (_label, vars) => {
      expect(() => validate({ ...BASE, ...vars })).toThrow(
        /SWAGGER_USER and SWAGGER_PASSWORD/,
      );
    });

    it('rejects a password under 16 characters without echoing it', () => {
      const short = 'fifteen-chars-x';

      expect(short).toHaveLength(15);
      expect(() =>
        validate({
          ...BASE,
          SWAGGER_USER: 'frontdev',
          SWAGGER_PASSWORD: short,
        }),
      ).toThrow(
        expect.objectContaining({
          message: expect.stringMatching(
            /^(?=.*SWAGGER_PASSWORD)(?!.*fifteen-chars-x)/s,
          ) as string,
        }),
      );
    });

    it('rejects a user name containing ":"', () => {
      expect(() =>
        validate({
          ...BASE,
          SWAGGER_USER: 'front:dev',
          SWAGGER_PASSWORD: DOCS_PASSWORD,
        }),
      ).toThrow(/SWAGGER_USER/);
    });

    it('never puts the password in the together-or-neither message', () => {
      expect(() =>
        validate({ ...BASE, SWAGGER_PASSWORD: DOCS_PASSWORD }),
      ).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(DOCS_PASSWORD) as string,
        }),
      );
    });
  });

  describe('SMTP_* and EMAIL_FROM (outgoing email)', () => {
    const SMTP_PASSWORD = 'smtp-pa55word-value';
    const SMTP = {
      SMTP_HOST: 'mail.ikaso-mali.com',
      SMTP_PORT: '465',
      SMTP_USER: 'alerte@ikaso-mali.com',
      SMTP_PASSWORD,
      EMAIL_FROM: 'Ikasso <alerte@ikaso-mali.com>',
    };

    it('are unset by default', () => {
      const env = validate(BASE);

      expect(env.SMTP_HOST).toBeUndefined();
      expect(env.SMTP_PORT).toBeUndefined();
      expect(env.EMAIL_FROM).toBeUndefined();
    });

    it('accept all five together and convert SMTP_PORT to a number', () => {
      const env = validate({ ...BASE, ...SMTP });

      expect(env.SMTP_HOST).toBe('mail.ikaso-mali.com');
      expect(env.SMTP_PORT).toBe(465);
      expect(env.SMTP_USER).toBe('alerte@ikaso-mali.com');
      expect(env.SMTP_PASSWORD).toBe(SMTP_PASSWORD);
      expect(env.EMAIL_FROM).toBe('Ikasso <alerte@ikaso-mali.com>');
    });

    it('accept a bare address as EMAIL_FROM', () => {
      expect(
        validate({ ...BASE, ...SMTP, EMAIL_FROM: 'alerte@ikaso-mali.com' })
          .EMAIL_FROM,
      ).toBe('alerte@ikaso-mali.com');
    });

    it('read empty values as unset, SMTP_PORT included', () => {
      const env = validate({
        ...BASE,
        SMTP_HOST: '',
        SMTP_PORT: '',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        EMAIL_FROM: '',
      });

      expect(env.SMTP_HOST).toBeUndefined();
      expect(env.SMTP_PORT).toBeUndefined();
      expect(env.SMTP_PASSWORD).toBeUndefined();
    });

    it.each(Object.keys(SMTP))(
      'reject the set without %s, naming the variables',
      (missing) => {
        const partial: Record<string, string> = { ...SMTP };
        delete partial[missing];

        expect(() => validate({ ...BASE, ...partial })).toThrow(
          /SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM must be set together/,
        );
      },
    );

    it('rejects a lone SMTP_HOST', () => {
      expect(() =>
        validate({ ...BASE, SMTP_HOST: 'mail.ikaso-mali.com' }),
      ).toThrow(/must be set together/);
    });

    it.each([
      ['not a number', 'abc'],
      ['zero', '0'],
      ['above 65535', '70000'],
    ])('rejects SMTP_PORT %s', (_label, port) => {
      expect(() => validate({ ...BASE, ...SMTP, SMTP_PORT: port })).toThrow(
        /SMTP_PORT/,
      );
    });

    it.each([
      ['a name without an address', 'Ikasso'],
      ['a line break', 'Ikasso <alerte@ikaso-mali.com>\r\nBcc: x@y.z'],
      ['an unclosed bracket', 'Ikasso <alerte@ikaso-mali.com'],
    ])('rejects EMAIL_FROM with %s', (_label, from) => {
      expect(() => validate({ ...BASE, ...SMTP, EMAIL_FROM: from })).toThrow(
        /EMAIL_FROM/,
      );
    });

    it('rejects a SMTP_HOST with a space or a scheme', () => {
      expect(() =>
        validate({ ...BASE, ...SMTP, SMTP_HOST: 'smtp://mail.ikaso-mali.com' }),
      ).toThrow(/SMTP_HOST/);
    });

    it('never puts the password in an error message', () => {
      const { SMTP_HOST: _host, ...withoutHost } = SMTP;

      expect(() => validate({ ...BASE, ...withoutHost })).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(SMTP_PASSWORD) as string,
        }),
      );
      expect(() => validate({ ...BASE, ...SMTP, SMTP_PORT: 'abc' })).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(SMTP_PASSWORD) as string,
        }),
      );
    });
  });
});
