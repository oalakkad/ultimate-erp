/** PostgreSQL error code (e.g. 23505 unique violation), also when wrapped by Drizzle in `cause`. */
export function pgErrorCode(err: unknown): string | undefined {
  for (
    let e: unknown = err;
    typeof e === 'object' && e !== null;
    e = (e as { cause?: unknown }).cause
  ) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

export const UNIQUE_VIOLATION = '23505';
