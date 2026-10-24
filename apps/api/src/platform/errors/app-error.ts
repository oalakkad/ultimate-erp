import { type ErrorCode, type ErrorDetail } from '@ultimate-erp/contracts';

/** Throw from services to return a specific error code and HTTP status. */
export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}
