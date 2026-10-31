import { type AppConfig, loadConfig } from '../../src/platform/config/config.js';

/** Valid configuration for tests; override only what a test is about. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://erp:test@127.0.0.1:1/erp',
    AUTH_SECRET: 'test-only-secret-not-for-production-0123456789',
    DATA_ENCRYPTION_KEY: 'test-only-data-key-not-for-production-0123456789',
    APP_PUBLIC_URL: 'http://localhost:3000',
    PASSWORD_BREACH_CHECK: 'false',
    ...overrides,
  });
}

/**
 * A configuration that passes the production guard (productionIssues), for tests of
 * production-only behaviour. Values are made up but shaped like a real installation.
 */
export function productionTestConfig(overrides: Record<string, string> = {}): AppConfig {
  return testConfig({
    NODE_ENV: 'production',
    APP_PROFILE: 'saas',
    DATABASE_URL: 'postgres://erp_app:Tq8vL2mX9pR4sW7z@127.0.0.1:1/erp',
    APP_PUBLIC_URL: 'https://erp.firm.test-domain.com',
    PLATFORM_BASE_DOMAIN: 'erp.firm.test-domain.com',
    AUTH_SECRET: 'Qm9v3kL8xR2tY7pZ1aW5sD4fG6hJ0cVbN', // gitleaks:allow (made-up test value)
    DATA_ENCRYPTION_KEY: 'Zx8Cv7Bn6Mm5Ll4Kk3Jj2Hh1Gg0FfDdSs', // gitleaks:allow (made-up test value)
    SMTP_HOST: 'smtp.firm.test-domain.com',
    SMTP_FROM: 'Ultimate ERP <erp@firm.test-domain.com>',
    S3_ENDPOINT: 'https://s3.firm.test-domain.com',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secret-key-value',
    ...overrides,
  });
}
