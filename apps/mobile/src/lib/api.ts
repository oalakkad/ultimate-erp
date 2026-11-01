import {
  AUTH_STATE_HEADER,
  type ErrorCode,
  type ErrorDetail,
  errorResponseSchema,
  REQUEST_ID_HEADER,
} from '@ultimate-erp/contracts';
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

export const isApiError = (err: unknown, code?: ApiError['code']): err is ApiError =>
  err instanceof ApiError && (code === undefined || err.code === code);

export interface RequestOptions<T extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Response schema from packages/contracts: the answer is checked, not trusted. */
  schema?: T;
}

export interface ApiClientOptions {
  /** Web origin of the host to talk to, e.g. https://acme.erp.example (the API is under /api/v1). */
  origin: string;
  /** The auth state the app holds for this host ('' when none). */
  getState: () => string;
  /** Called with the new state whenever the server returns one. */
  setState: (state: string) => void | Promise<void>;
  fetch?: typeof fetch;
}

export type ApiClient = <T extends z.ZodType>(
  path: string,
  options?: RequestOptions<T>,
) => Promise<z.infer<T>>;

/**
 * Calls `${origin}/api/v1${path}` the way the mobile app does: no cookies, the auth state in
 * `X-Auth-State`, and the state the server answers with stored for the next call
 * (docs/modules/mobile.md §3). The company is decided by the server from the origin's host.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch;
  return async <T extends z.ZodType>(
    path: string,
    { method = 'GET', body, schema }: RequestOptions<T> = {},
  ) => {
    let res: Response;
    try {
      res = await doFetch(`${options.origin}/api/v1${path}`, {
        method,
        credentials: 'omit',
        headers: {
          [AUTH_STATE_HEADER]: options.getState(),
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', undefined);
    }
    const nextState = res.headers.get(AUTH_STATE_HEADER);
    if (nextState !== null) await options.setState(nextState);
    const requestId = res.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const data: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const parsed = errorResponseSchema.safeParse(data);
      throw parsed.success
        ? new ApiError(res.status, parsed.data.error.code, requestId, parsed.data.error.details)
        : new ApiError(res.status, 'INTERNAL_ERROR', requestId);
    }
    return (schema ? schema.parse(data) : data) as z.infer<T>;
  };
}

/** A full http(s) origin without a path, as typed on the sign-in screen; null if not usable. */
export function normaliseServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
