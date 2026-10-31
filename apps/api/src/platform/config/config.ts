import { readFileSync } from 'node:fs';
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

/** The settings and their individual rules (see `configSchema` for the combined checks). */
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PROFILE: z.enum(['dev', 'saas', 'onprem']).default('dev'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: flag.default(false),
  CORS_ORIGINS: originList.default([]),
  TRUST_INCOMING_REQUEST_ID: flag.default(false),
  /**
   * How many reverse proxies stand between the internet and the API, each appending to
   * X-Forwarded-For (the web container's nginx = 1, plus your HTTPS proxy = 2). The client IP
   * used for rate limits and the audit log is read that many hops from the right; anything
   * further left is client-supplied and ignored. 0 = use the connection's address. Only the
   * IP is affected: the company is always taken from the Host header (docs/operations.md §5).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
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
});

/**
 * Every environment variable the API reads. The app refuses to start if any value is missing
 * or invalid (ADR-0007), or, in production, unsafe (`productionIssues`).
 */
export const configSchema = baseSchema.superRefine((config, ctx) => {
  if (config.NODE_ENV !== 'production') return;
  for (const issue of productionIssues(config)) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
});

/** Values copied from examples or development (`.env.example`, tests, docs). */
const EXAMPLE_SECRET =
  /change-?me|replace-?with|your-?(secret|key)|local-dev|dev-only|test-only|example|placeholder|not-for-production/i;
const isLocalHost = (host: string) =>
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || host.endsWith('.localhost');

/**
 * Production guard (docs/operations.md §5): settings that work in development but are unsafe
 * or broken for real users. The API and worker refuse to start until each is fixed. Messages
 * name the setting and the rule, never the value.
 */
export function productionIssues(
  config: z.infer<typeof baseSchema>,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (config.LOG_PRETTY) add('LOG_PRETTY', 'must be false in production');
  if (config.APP_PROFILE === 'dev') add('APP_PROFILE', 'must be saas or onprem in production');

  const httpsUrls = {
    APP_PUBLIC_URL: config.APP_PUBLIC_URL,
    WEB_PUBLIC_URL: config.WEB_PUBLIC_URL,
    S3_PUBLIC_ENDPOINT: config.S3_PUBLIC_ENDPOINT,
    PASSWORD_BREACH_API_URL: config.PASSWORD_BREACH_API_URL,
  };
  for (const [name, value] of Object.entries(httpsUrls)) {
    if (value !== undefined && !value.startsWith('https://')) {
      add(name, 'must use https in production');
    }
  }
  if (config.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
    add('CORS_ORIGINS', 'must list https origins only in production');
  }
  for (const name of ['APP_PUBLIC_URL', 'WEB_PUBLIC_URL'] as const) {
    const value = config[name];
    if (value !== undefined && isLocalHost(new URL(value).hostname)) {
      add(name, 'must be the public address people use, not localhost');
    }
  }
  if (isLocalHost(config.PLATFORM_BASE_DOMAIN)) {
    add(
      'PLATFORM_BASE_DOMAIN',
      'must be your real domain in production (companies use <slug>.<domain>)',
    );
  }

  if (isLocalHost(config.SMTP_HOST)) add('SMTP_HOST', 'must be a real mail server in production');
  if (/@localhost\b/i.test(config.SMTP_FROM)) {
    add('SMTP_FROM', 'must be a real sender address in production');
  }

  for (const name of ['AUTH_SECRET', 'DATA_ENCRYPTION_KEY'] as const) {
    const value = config[name];
    if (EXAMPLE_SECRET.test(value)) add(name, 'must be a random secret, not an example value');
    else if (new Set(value).size < 12) add(name, 'must be random (too few different characters)');
  }
  const databasePassword = decodeURIComponent(new URL(config.DATABASE_URL).password);
  if (databasePassword.length < 12 || EXAMPLE_SECRET.test(databasePassword)) {
    add('DATABASE_URL', 'must use a random password of at least 12 characters in production');
  }
  for (const name of ['S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
    const value = config[name];
    if (value !== undefined && EXAMPLE_SECRET.test(value)) {
      add(name, 'must be a real credential, not an example value');
    }
  }
  if (config.AUTH_SECRET === config.DATA_ENCRYPTION_KEY) {
    add('DATA_ENCRYPTION_KEY', 'must be different from AUTH_SECRET');
  }

  if (!config.S3_ENDPOINT) {
    add('S3_ENDPOINT', 'is required in production (uploaded files and receipts)');
  } else {
    if (!config.S3_ACCESS_KEY || !config.S3_SECRET_KEY) {
      add('S3_ACCESS_KEY', 'S3_ACCESS_KEY and S3_SECRET_KEY are required when S3_ENDPOINT is set');
    }
    if (!config.S3_PUBLIC_ENDPOINT && !config.S3_ENDPOINT.startsWith('https://')) {
      add(
        'S3_PUBLIC_ENDPOINT',
        'is required in production: the https address browsers use to download files',
      );
    }
  }
  return issues;
}
export type AppConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * An empty variable counts as unset. Docker Compose passes `${NAME}` / `${NAME:-}` as an empty
 * string when NAME is not set, which must mean "use the default", not "invalid value".
 */
export function withoutEmptyValues(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

/**
 * `NAME_FILE=/run/secrets/name` sets NAME from that file (Docker / Kubernetes secrets), so
 * secrets need not sit in environment variables. A value given directly wins; a trailing line
 * break is ignored. An unreadable file is a configuration error naming the variable only.
 */
export function withFileValues(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const resolved = { ...env };
  for (const [key, path] of Object.entries(env)) {
    if (!key.endsWith('_FILE') || !path) continue;
    const name = key.slice(0, -'_FILE'.length);
    if (resolved[name]) continue;
    try {
      resolved[name] = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new ConfigError(`Invalid configuration:\n  - ${key}: the file cannot be read`);
    }
  }
  return resolved;
}

/**
 * Parses configuration from environment variables.
 * Error messages name the variable and the rule, never the value, so secrets
 * such as DATABASE_URL passwords cannot end up in logs.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(withFileValues(withoutEmptyValues(env)));
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
