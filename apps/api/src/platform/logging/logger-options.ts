import { type LoggerOptions } from 'pino';
import { type AppConfig } from '../config/config.js';

/**
 * Query-string values can carry secrets (email-verification and reset tokens arrive as
 * `?token=`). Keep parameter names for debugging, replace every value.
 */
export function redactRequestForLog<T extends { url?: string; query?: object }>(req: T): T {
  const url = req.url ?? '';
  const queryStart = url.indexOf('?');
  const names = [...new URLSearchParams(queryStart === -1 ? '' : url.slice(queryStart + 1)).keys()];
  const redactedUrl =
    queryStart === -1
      ? url
      : `${url.slice(0, queryStart)}?${names.map((name) => `${name}=[Redacted]`).join('&')}`;
  const query = Object.fromEntries(Object.keys(req.query ?? {}).map((key) => [key, '[Redacted]']));
  return { ...req, url: redactedUrl, query };
}

/**
 * Fields that must never appear in logs (security.md R9). Pino replaces their
 * values with "[Redacted]". `*.x` matches the key one level deep in any object.
 */
const SENSITIVE_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'otp',
  'totpSecret',
  'recoveryCodes',
  'backupCodes',
  'totpUri',
  'civilId',
  'iban',
  'salary',
];

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
];

export function buildLoggerOptions(config: AppConfig): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    base: { service: 'api', profile: config.APP_PROFILE },
    ...(config.LOG_PRETTY
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
}
