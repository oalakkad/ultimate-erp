import { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../platform/errors/app-error.js';
import { toAppError } from './auth-errors.js';

describe('toAppError', () => {
  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'INVALID_CREDENTIALS', 401],
    ['EMAIL_NOT_VERIFIED', 'EMAIL_NOT_VERIFIED', 403],
    ['TOKEN_EXPIRED', 'INVALID_TOKEN', 400],
    ['INVALID_BACKUP_CODE', 'INVALID_CODE', 401],
    ['ACCOUNT_TEMPORARILY_LOCKED', 'RATE_LIMITED', 429],
  ])('maps %s to %s', (betterAuthCode, ourCode, status) => {
    const mapped = toAppError(new APIError('BAD_REQUEST', { code: betterAuthCode, message: 'x' }));
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped).toMatchObject({ code: ourCode, status });
  });

  it('turns unknown client errors into BAD_REQUEST without leaking the library message', () => {
    const mapped = toAppError(
      new APIError('BAD_REQUEST', { code: 'SOMETHING_NEW', message: 'internal detail' }),
    );
    expect(mapped).toMatchObject({ code: 'BAD_REQUEST' });
    expect((mapped as AppError).message).not.toContain('internal detail');
  });

  it('passes non-library errors through unchanged (logged as unexpected)', () => {
    const err = new Error('database down');
    expect(toAppError(err)).toBe(err);
  });
});
