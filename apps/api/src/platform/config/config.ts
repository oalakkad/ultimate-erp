import { z } from 'zod';

const flag = z.stringbool();

const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })));

/**
 * Every environment variable the API reads. The app refuses to start if any
 * value is missing or invalid (ADR-0007), rather than failing later at runtime.
 */
export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_PROFILE: z.enum(['dev', 'saas', 'onprem']).default('dev'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: flag.default(false),
    CORS_ORIGINS: originList.default([]),
    TRUST_INCOMING_REQUEST_ID: flag.default(false),
    HTTP_BODY_LIMIT: z
      .string()
      .regex(/^\d+(kb|mb)$/, 'must look like 100kb or 1mb')
      .default('1mb'),

    // Identity (Milestone 1.3a)
    /** Signs cookies and encrypts two-factor secrets. Never defaulted; rotate with care. */
    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Public base URL of this API, used in email links and cookie security. */
    APP_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
    SMTP_HOST: z.string().min(1).default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: flag.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().min(3).default('Ultimate ERP <no-reply@localhost>'),
    /** Have I Been Pwned range check. Turn off for on-prem installs without internet access. */
    PASSWORD_BREACH_CHECK: flag.default(true),
    PASSWORD_BREACH_API_URL: z
      .url({ protocol: /^https?$/ })
      .default('https://api.pwnedpasswords.com'),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && config.LOG_PRETTY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOG_PRETTY'],
        message: 'must be false in production',
      });
    }
    if (config.NODE_ENV === 'production' && !config.APP_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_PUBLIC_URL'],
        message: 'must use https in production',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      ['127.0.0.1', 'localhost', '::1'].includes(config.SMTP_HOST)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'must be a real mail server in production',
      });
    }
    if (config.NODE_ENV === 'production' && config.APP_PROFILE === 'dev') {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_PROFILE'],
        message: 'must be saas or onprem in production',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Parses configuration from environment variables.
 * Error messages name the variable and the rule, never the value, so secrets
 * such as DATABASE_URL passwords cannot end up in logs.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);
  if (result.success) return result.data;

  const problems = result.error.issues.map(
    (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new ConfigError(`Invalid configuration:\n${problems.join('\n')}`);
}
