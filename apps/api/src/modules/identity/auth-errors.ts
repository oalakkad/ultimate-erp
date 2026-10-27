import { HttpStatus } from '@nestjs/common';
import { type ErrorCode } from '@ultimate-erp/contracts';
import { APIError } from 'better-auth/api';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';

/** Better Auth error code → our public code and HTTP status. */
const MAPPING: Record<string, [ErrorCode, HttpStatus]> = {
  INVALID_EMAIL_OR_PASSWORD: ['INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED],
  INVALID_PASSWORD: ['INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED],
  CREDENTIAL_ACCOUNT_NOT_FOUND: ['INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED],
  EMAIL_NOT_VERIFIED: ['EMAIL_NOT_VERIFIED', HttpStatus.FORBIDDEN],
  INVALID_TOKEN: ['INVALID_TOKEN', HttpStatus.BAD_REQUEST],
  TOKEN_EXPIRED: ['INVALID_TOKEN', HttpStatus.BAD_REQUEST],
  INVALID_CODE: ['INVALID_CODE', HttpStatus.UNAUTHORIZED],
  INVALID_BACKUP_CODE: ['INVALID_CODE', HttpStatus.UNAUTHORIZED],
  OTP_HAS_EXPIRED: ['INVALID_CODE', HttpStatus.UNAUTHORIZED],
  INVALID_TWO_FACTOR_COOKIE: ['UNAUTHENTICATED', HttpStatus.UNAUTHORIZED],
  ACCOUNT_TEMPORARILY_LOCKED: ['RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS],
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: ['RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS],
  TOTP_ALREADY_ENABLED: ['CONFLICT', HttpStatus.CONFLICT],
  TOTP_NOT_ENABLED: ['CONFLICT', HttpStatus.CONFLICT],
  TWO_FACTOR_NOT_ENABLED: ['CONFLICT', HttpStatus.CONFLICT],
  PASSWORD_TOO_SHORT: ['VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY],
  PASSWORD_TOO_LONG: ['VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY],
  SESSION_EXPIRED: ['UNAUTHENTICATED', HttpStatus.UNAUTHORIZED],
};

/** Better Auth's error code, if `err` is one of its API errors. */
export function authErrorCode(err: unknown): string | undefined {
  if (!(err instanceof APIError)) return undefined;
  const code: unknown = (err.body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Converts a Better Auth error into our AppError. Unknown 4xx errors become BAD_REQUEST;
 * anything else is re-thrown unchanged so it is logged as an unexpected error.
 */
export function toAppError(err: unknown): unknown {
  if (!(err instanceof APIError)) return err;
  const code = authErrorCode(err);
  const mapped = code ? MAPPING[code] : undefined;
  if (mapped) return new AppError(mapped[0], mapped[1], messageFor(mapped[0]));
  if (err.statusCode >= 400 && err.statusCode < 500) {
    return new AppError('BAD_REQUEST', HttpStatus.BAD_REQUEST, messageFor('BAD_REQUEST'));
  }
  return err;
}

/** Runs a Better Auth call, translating its errors. */
export async function callAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toAppError(err);
  }
}
