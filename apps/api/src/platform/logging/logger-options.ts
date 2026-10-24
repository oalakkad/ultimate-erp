import { type LoggerOptions } from 'pino';
import { type AppConfig } from '../config/config.js';

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
