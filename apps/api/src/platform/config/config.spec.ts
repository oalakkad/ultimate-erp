import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const SECRET = 'super-secret-password-123';
const valid = {
  DATABASE_URL: `postgres://erp:${SECRET}@127.0.0.1:5432/erp`,
  AUTH_SECRET: 'x'.repeat(32),
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

  it('never includes configuration values in the error message', () => {
    const message = errorMessage(() =>
      loadConfig({ ...valid, DATABASE_URL: `mysql://erp:${SECRET}@db/erp`, API_PORT: SECRET }),
    );
    expect(message).not.toContain(SECRET);
  });
});
