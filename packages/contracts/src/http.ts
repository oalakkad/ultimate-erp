/** Every API response carries this header; quote it when reporting a problem. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** All endpoints live under this prefix. Breaking changes go to a new version. */
export const API_PREFIX = 'api/v1';

/**
 * Cookie-less clients (the mobile app) send their auth state in this header and receive the
 * updated state in the same response header instead of `Set-Cookie` (docs/modules/mobile.md §3).
 * The value is opaque to the client: base64url JSON of cookie name → value.
 */
export const AUTH_STATE_HEADER = 'x-auth-state';
export const AUTH_STATE_MAX_BYTES = 8 * 1024;
