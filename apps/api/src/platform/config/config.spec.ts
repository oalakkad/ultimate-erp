import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const SECRET = 'super-secret-password-123';
const valid = {
  DATABASE_URL: `postgres://erp:${SECRET}@127.0.0.1:5432/erp`,
  AUTH_SECRET: 'x'.repeat(32),
  DATA_ENCRYPTION_KEY: 'y'.repeat(32),
  APP_PUBLIC_URL: 'http://localhost:3000',
};

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err.message;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('applies safe defaults when only the required values are set', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      APP_PROFILE: 'dev',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      LOG_PRETTY: false,
      TRUST_INCOMING_REQUEST_ID: false,
      CORS_ORIGINS: [],
      HTTP_BODY_LIMIT: '1mb',
    });
  });

  it('parses numbers, booleans and origin lists from strings', () => {
    const config = loadConfig({
      ...valid,
      API_PORT: '4100',
      LOG_PRETTY: 'true',
      CORS_ORIGINS: 'http://localhost:5173, https://acme.example.com',
    });
    expect(config.API_PORT).toBe(4100);
    expect(config.LOG_PRETTY).toBe(true);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://acme.example.com']);
  });

  it('refuses to start without DATABASE_URL', () => {
    expect(errorMessage(() => loadConfig({}))).toContain('DATABASE_URL');
  });

  it.each([
    ['API_PORT', '70000'],
    ['API_PORT', 'abc'],
    ['NODE_ENV', 'staging'],
    ['LOG_PRETTY', 'maybe'],
    ['CORS_ORIGINS', 'not a url'],
    ['HTTP_BODY_LIMIT', '10gb'],
    ['DATABASE_URL', 'mysql://localhost/erp'],
  ])('rejects an invalid %s (%s)', (key, value) => {
    expect(errorMessage(() => loadConfig({ ...valid, [key]: value }))).toContain(key);
  });

  it('refuses a short AUTH_SECRET and missing APP_PUBLIC_URL', () => {
    expect(errorMessage(() => loadConfig({ ...valid, AUTH_SECRET: 'short' }))).toContain(
      'AUTH_SECRET',
    );
    const withoutUrl = { DATABASE_URL: valid.DATABASE_URL, AUTH_SECRET: valid.AUTH_SECRET };
    expect(errorMessage(() => loadConfig(withoutUrl))).toContain('APP_PUBLIC_URL');
  });

  it('requires https and a real mail server in production', () => {
    const message = errorMessage(() =>
      loadConfig({ ...valid, NODE_ENV: 'production', APP_PROFILE: 'saas' }),
    );
    expect(message).toContain('APP_PUBLIC_URL');
    expect(message).toContain('SMTP_HOST');
  });

  it('rejects pretty logs and the dev profile in production', () => {
    const message = errorMessage(() =>
      loadConfig({ ...valid, NODE_ENV: 'production', LOG_PRETTY: 'true' }),
    );
    expect(message).toContain('LOG_PRETTY');
    expect(message).toContain('APP_PROFILE');
  });

  it('treats empty values as unset (Docker Compose passes unset variables as empty)', () => {
    const config = loadConfig({
      ...valid,
      SENTRY_DSN: '',
      WEB_PUBLIC_URL: '',
      SMTP_USER: '',
      API_PORT: '',
    });
    expect(config.SENTRY_DSN).toBeUndefined();
    expect(config.WEB_PUBLIC_URL).toBeUndefined();
    expect(config.SMTP_USER).toBeUndefined();
    expect(config.API_PORT).toBe(3000);
  });

  it('reads NAME_FILE secrets (Docker / Kubernetes), a direct value winning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'erp-config-'));
    try {
      const file = join(dir, 'auth_secret');
      writeFileSync(file, `${'s'.repeat(40)}\n`);
      const fromFile = loadConfig({ ...valid, AUTH_SECRET: '', AUTH_SECRET_FILE: file });
      expect(fromFile.AUTH_SECRET).toBe('s'.repeat(40));
      expect(loadConfig({ ...valid, AUTH_SECRET_FILE: file }).AUTH_SECRET).toBe(valid.AUTH_SECRET);
      const missing = errorMessage(() =>
        loadConfig({ ...valid, AUTH_SECRET: '', AUTH_SECRET_FILE: join(dir, 'nope') }),
      );
      expect(missing).toContain('AUTH_SECRET_FILE: the file cannot be read');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never includes configuration values in the error message', () => {
    const message = errorMessage(() =>
      loadConfig({ ...valid, DATABASE_URL: `mysql://erp:${SECRET}@db/erp`, API_PORT: SECRET }),
    );
    expect(message).not.toContain(SECRET);
  });
});

describe('production guard', () => {
  const production = {
    NODE_ENV: 'production',
    APP_PROFILE: 'onprem',
    DATABASE_URL: `postgres://erp_app:${SECRET}@db:5432/erp`,
    AUTH_SECRET: 'Qm9v3kL8xR2tY7pZ1aW5sD4fG6hJ0cVbN', // gitleaks:allow (made-up test value)
    DATA_ENCRYPTION_KEY: 'Zx8Cv7Bn6Mm5Ll4Kk3Jj2Hh1Gg0FfDdSs', // gitleaks:allow (made-up test value)
    APP_PUBLIC_URL: 'https://erp.firm.example.com',
    PLATFORM_BASE_DOMAIN: 'erp.firm.example.com',
    SMTP_HOST: 'smtp.firm.example.com',
    SMTP_FROM: 'Ultimate ERP <erp@firm.example.com>',
    S3_ENDPOINT: 'http://object-storage:9000',
    S3_PUBLIC_ENDPOINT: 'https://files.erp.firm.example.com',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secret-key-value',
  };

  it('accepts a complete production configuration', () => {
    expect(loadConfig(production)).toMatchObject({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 0 });
    expect(loadConfig({ ...production, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
  });

  it('refuses example, repeated and identical secrets', () => {
    const example = errorMessage(() =>
      loadConfig({ ...production, AUTH_SECRET: 'local-dev-only-auth-secret-change-me-0123456789' }),
    );
    expect(example).toContain('AUTH_SECRET: must be a random secret, not an example value');
    const repeated = errorMessage(() =>
      loadConfig({ ...production, DATA_ENCRYPTION_KEY: 'ab'.repeat(20) }),
    );
    expect(repeated).toContain('DATA_ENCRYPTION_KEY: must be random');
    const same = errorMessage(() =>
      loadConfig({ ...production, DATA_ENCRYPTION_KEY: production.AUTH_SECRET }),
    );
    expect(same).toContain('DATA_ENCRYPTION_KEY: must be different from AUTH_SECRET');
  });

  it('refuses placeholder database and storage credentials', () => {
    const message = errorMessage(() =>
      loadConfig({
        ...production,
        DATABASE_URL: 'postgres://erp_app:replace-with-random-password@db:5432/erp',
        S3_SECRET_KEY: 'replace-with-random-secret',
      }),
    );
    expect(message).toContain('DATABASE_URL: must use a random password');
    expect(message).toContain('S3_SECRET_KEY: must be a real credential');
    expect(message).not.toContain('replace-with-random-password');
  });

  it('refuses localhost addresses and plain http where people connect', () => {
    const message = errorMessage(() =>
      loadConfig({
        ...production,
        WEB_PUBLIC_URL: 'http://localhost:5173',
        PLATFORM_BASE_DOMAIN: 'localhost',
        CORS_ORIGINS: 'http://erp.firm.example.com',
        SMTP_FROM: 'Ultimate ERP <no-reply@localhost>',
      }),
    );
    for (const expected of [
      'WEB_PUBLIC_URL: must use https in production',
      'WEB_PUBLIC_URL: must be the public address people use, not localhost',
      'PLATFORM_BASE_DOMAIN: must be your real domain',
      'CORS_ORIGINS: must list https origins only',
      'SMTP_FROM: must be a real sender address',
    ]) {
      expect(message).toContain(expected);
    }
  });

  it('requires file storage with an https address for downloads', () => {
    const withoutStorage: Record<string, string> = { ...production };
    delete withoutStorage.S3_ENDPOINT;
    expect(errorMessage(() => loadConfig(withoutStorage))).toContain('S3_ENDPOINT: is required');
    const withoutPublic: Record<string, string> = { ...production };
    delete withoutPublic.S3_PUBLIC_ENDPOINT;
    expect(errorMessage(() => loadConfig(withoutPublic))).toContain(
      'S3_PUBLIC_ENDPOINT: is required in production',
    );
    expect(
      loadConfig({ ...withoutPublic, S3_ENDPOINT: 'https://s3.me-south-1.amazonaws.com' })
        .S3_ENDPOINT,
    ).toBe('https://s3.me-south-1.amazonaws.com');
  });

  it('never applies the production rules in development', () => {
    expect(loadConfig({ ...valid, PLATFORM_BASE_DOMAIN: 'localhost' }).NODE_ENV).toBe(
      'development',
    );
  });
});
