/** Same-site path, not `//…` or `/\…`, and no backslashes, spaces or control characters. */
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const SAFE_PATH = /^\/(?![/\\])[^\\\u0000- \u007f]*$/;

/**
 * Accepts only same-site paths for "come back here after signing in" (blocks open redirects
 * like `//evil.example`, `https://evil.example` or `/\t/evil.example` — browsers drop tabs and
 * newlines from URLs, which would turn the last one into `//evil.example`).
 */
export function safeReturnTo(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_PATH.test(value) ? value : undefined;
}
