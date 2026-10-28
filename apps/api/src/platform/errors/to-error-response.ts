import { HttpException, HttpStatus } from '@nestjs/common';
import { type ErrorCode, type ErrorResponse } from '@ultimate-erp/contracts';
import { AppError } from './app-error.js';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  BAD_REQUEST: 'The request could not be processed.',
  MALFORMED_JSON: 'The request body is not valid JSON.',
  VALIDATION_FAILED: 'The request contains invalid fields.',
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  METHOD_NOT_ALLOWED: 'This method is not allowed for this resource.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'The request content type or encoding is not supported.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  INVALID_CREDENTIALS: 'The email or password is incorrect.',
  EMAIL_NOT_VERIFIED: 'The email address has not been verified yet.',
  INVALID_TOKEN: 'The link is invalid or has expired.',
  INVALID_CODE: 'The code is invalid or has expired.',
  MFA_REQUIRED: 'Two-factor authentication must be set up before using this company.',
  PASSWORD_COMPROMISED: 'This password appears in known data breaches; choose another.',
};

/** The standard developer-facing message for an error code. */
export function messageFor(code: ErrorCode): string {
  return MESSAGE_BY_CODE[code];
}

export interface MappedError {
  status: number;
  body: ErrorResponse;
  /** True for unexpected failures that must be logged with their stack trace. */
  unexpected: boolean;
}

/**
 * Converts any thrown value into the single public error shape.
 * Internal details (messages of unknown errors, stack traces) never leave the server.
 */
export function toErrorResponse(exception: unknown, requestId: string): MappedError {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      unexpected: false,
      body: {
        error: {
          code: exception.code,
          message: exception.message,
          requestId,
          ...(exception.details ? { details: exception.details } : {}),
        },
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
    return {
      status,
      unexpected: status >= 500,
      body: { error: { code, message: MESSAGE_BY_CODE[code], requestId } },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    unexpected: true,
    body: {
      error: { code: 'INTERNAL_ERROR', message: MESSAGE_BY_CODE.INTERNAL_ERROR, requestId },
    },
  };
}
