import { type AppConfig, loadConfig } from '../../src/platform/config/config.js';

/** Valid configuration for tests; override only what a test is about. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://erp:test@127.0.0.1:1/erp',
    AUTH_SECRET: 'test-only-secret-not-for-production-0123456789',
    APP_PUBLIC_URL: 'http://localhost:3000',
    PASSWORD_BREACH_CHECK: 'false',
    ...overrides,
  });
}
