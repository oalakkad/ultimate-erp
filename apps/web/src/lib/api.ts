import { type ErrorCode, type ErrorDetail, errorResponseSchema } from '@ultimate-erp/contracts';
import { type z } from 'zod';

/** An error answer from the API, with its stable code and the request reference for support. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    readonly requestId: string | undefined,
    readonly details: ErrorDetail[] = [],
  ) {
    super(code);
  }
}

interface RequestOptions<T extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Response schema from packages/contracts: the answer is checked, not trusted. */
  schema?: T;
}

/**
 * Calls the API on the same origin (/api/v1 …). The session cookie travels automatically; the
 * company is decided by the server from this page's address, never sent by the app.
 */
export async function api<T extends z.ZodType>(
  path: string,
  { method = 'GET', body, schema }: RequestOptions<T> = {},
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', undefined);
  }
  const requestId = res.headers.get('x-request-id') ?? undefined;
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error.code, requestId, parsed.data.error.details)
      : new ApiError(res.status, 'INTERNAL_ERROR', requestId);
  }
  return (schema ? schema.parse(data) : data) as z.infer<T>;
}

export const isApiError = (err: unknown, code?: ApiError['code']): err is ApiError =>
  err instanceof ApiError && (code === undefined || err.code === code);
