import { z } from 'zod';

/**
 * Stable, machine-readable error codes. Clients localize these (EN/AR);
 * the server never sends UI sentences. Add codes, never rename or reuse them.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'MALFORMED_JSON',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  // Identity (Milestone 1.3a)
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'INVALID_TOKEN',
  'INVALID_CODE',
  'PASSWORD_COMPROMISED',
  // Access (Milestone 1.3b)
  'MFA_REQUIRED',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** One problem with one input field, e.g. `{ path: "email", code: "invalid_format" }`. */
export const errorDetailSchema = z
  .object({
    path: z.string(),
    code: z.string(),
  })
  .strict();
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

/**
 * The only shape the API uses for error responses.
 * `message` is a short English description for developers; it is not shown to end users.
 * `requestId` matches the `X-Request-Id` response header and the server logs.
 */
export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string(),
        requestId: z.string(),
        details: z.array(errorDetailSchema).optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
