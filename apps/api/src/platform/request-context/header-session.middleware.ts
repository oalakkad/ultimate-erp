import { HttpStatus } from '@nestjs/common';
import { AUTH_STATE_HEADER, AUTH_STATE_MAX_BYTES } from '@ultimate-erp/contracts';
import { type NextFunction, type Request, type Response } from 'express';
import { AppError } from '../errors/app-error.js';

/** Cookie name → value, as a browser's cookie jar would hold it for one host. */
export type AuthState = Record<string, string>;

const COOKIE_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
/** Printable ASCII without `;` (a cookie value can never contain the separator). */
const COOKIE_VALUE = /^[\x21-\x3a\x3c-\x7e]{0,4096}$/;

export function encodeAuthState(state: AuthState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

/** Parses the header value; null when it is not a valid state (the caller answers 400). */
export function decodeAuthState(value: string): AuthState | null {
  if (value === '') return {};
  if (value.length > AUTH_STATE_MAX_BYTES || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const state: AuthState = {};
  for (const [name, cookieValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof cookieValue !== 'string' ||
      !COOKIE_NAME.test(name) ||
      !COOKIE_VALUE.test(cookieValue)
    ) {
      return null;
    }
    state[name] = cookieValue;
  }
  return state;
}

/** Serialises the state as a `Cookie` request header. */
export function toCookieHeader(state: AuthState): string {
  return Object.entries(state)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Applies one `Set-Cookie` header to the state the way a cookie jar would: a cookie with an
 * empty value, `Max-Age<=0` or an `Expires` in the past is removed, anything else stored.
 */
export function applySetCookie(state: AuthState, setCookie: string): void {
  const [pair = '', ...attributes] = setCookie.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value)) return;
  let expired = value === '';
  for (const attribute of attributes) {
    const [key = '', raw = ''] = attribute.split('=');
    const attrName = key.trim().toLowerCase();
    if (attrName === 'max-age') {
      const seconds = Number(raw.trim());
      if (Number.isFinite(seconds) && seconds <= 0) expired = true;
    } else if (attrName === 'expires') {
      const at = Date.parse(raw.trim());
      if (Number.isFinite(at) && at <= Date.now()) expired = true;
    }
  }
  if (expired) Reflect.deleteProperty(state, name);
  else state[name] = value;
}

/** True when this request keeps its own auth state (no browser cookie jar is involved). */
export function isHeaderStateRequest(req: Request): boolean {
  return req.headers[AUTH_STATE_HEADER] !== undefined;
}

/**
 * Cookie-less session transport for the mobile app (docs/modules/mobile.md §3–§4). A request
 * carrying `X-Auth-State` has its content used as the request's cookies, and every cookie the
 * response would set is returned in the same header instead of `Set-Cookie`. Nothing else
 * changes: Better Auth, the guards, rate limits and audit see an ordinary cookie session.
 */
export function headerSessionMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.headers[AUTH_STATE_HEADER];
    if (raw === undefined) {
      next();
      return;
    }
    const state = typeof raw === 'string' ? decodeAuthState(raw) : null;
    if (state === null) {
      next(new AppError('BAD_REQUEST', HttpStatus.BAD_REQUEST, 'Invalid auth state header.'));
      return;
    }
    // Only the header's cookies count: a stray browser cookie must never mix in.
    if (Object.keys(state).length > 0) req.headers.cookie = toCookieHeader(state);
    else delete req.headers.cookie;

    // Just before the headers go out, move Set-Cookie into the state header.
    const writeHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
      const setCookies = res.getHeader('set-cookie');
      if (setCookies !== undefined) {
        const list = Array.isArray(setCookies) ? setCookies : [String(setCookies)];
        for (const cookie of list) applySetCookie(state, cookie);
        res.removeHeader('set-cookie');
        res.setHeader(AUTH_STATE_HEADER, encodeAuthState(state));
      }
      return writeHead(...args);
    }) as Response['writeHead'];
    next();
  };
}
