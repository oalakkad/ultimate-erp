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
    /**
     * Encrypts sensitive personal data at rest (employee private details). Separate from
     * AUTH_SECRET so either can be rotated on its own; losing it loses that data.
     */
    DATA_ENCRYPTION_KEY: z.string().min(32, 'must be at least 32 characters'),
    /** Public base URL of this API, used in email links and cookie security. */
    APP_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
    /** Public URL of the web app (email links open its pages). Defaults to APP_PUBLIC_URL. */
    WEB_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Companies live at <slug>.<PLATFORM_BASE_DOMAIN>, e.g. acme.localhost in development. */
    PLATFORM_BASE_DOMAIN: z
      .string()
      .regex(/^[a-z0-9.-]+$/, 'must be a lowercase domain name')
      .default('localhost'),
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

    // Files (Milestone 1.5b). Without S3_ENDPOINT the file endpoints answer 503.
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    /** Address browsers use for signed download links, if different (e.g. behind a proxy). */
    S3_PUBLIC_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')
      .default('erp-files'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    /** Largest upload accepted, in bytes (default 25 MB). */
    FILE_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(512 * 1024 * 1024)
      .default(25 * 1024 * 1024),
    /** ClamAV daemon (clamd) used by the worker to scan uploads. */
    CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),

    // Monitoring (Milestone 1.5b) — all off unless configured (owner decision 2026-10-28).
    /** Sentry-protocol endpoint (Sentry cloud or self-hosted GlitchTip). Unset = nothing sent. */
    SENTRY_DSN: z.url().optional(),
    /** OpenTelemetry collector (OTLP/HTTP). Unset = no traces exported. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    SLOW_REQUEST_MS: z.coerce.number().int().min(50).default(1000),
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

/** Where people open the app: the web app's public URL (same as the API's unless configured). */
export function webPublicUrl(config: AppConfig): string {
  return config.WEB_PUBLIC_URL ?? config.APP_PUBLIC_URL;
}

/** The web address of a company host, e.g. http://acme.localhost:5173. */
export function companyWebOrigin(config: AppConfig, hostname: string): string {
  const url = new URL(webPublicUrl(config));
  url.hostname = hostname;
  return url.origin;
}
