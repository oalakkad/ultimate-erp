import { describe, expect, it } from 'vitest';
import {
  applySetCookie,
  decodeAuthState,
  encodeAuthState,
  toCookieHeader,
} from './header-session.middleware.js';

describe('auth state codec (mobile session transport)', () => {
  it('round-trips a cookie map', () => {
    const state = { 'erp.session_token': 'abc.def', '__Secure-erp.trust_device': 'x' };
    expect(decodeAuthState(encodeAuthState(state))).toEqual(state);
    expect(toCookieHeader(state)).toBe('erp.session_token=abc.def; __Secure-erp.trust_device=x');
  });

  it('treats an empty header as an empty jar', () => {
    expect(decodeAuthState('')).toEqual({});
  });

  it('refuses anything that is not a map of well-formed cookies', () => {
    expect(decodeAuthState('not base64!')).toBeNull();
    expect(decodeAuthState(Buffer.from('[1]').toString('base64url'))).toBeNull();
    expect(decodeAuthState(Buffer.from('"x"').toString('base64url'))).toBeNull();
    expect(decodeAuthState(Buffer.from('{"a":1}').toString('base64url'))).toBeNull();
    expect(decodeAuthState(Buffer.from('{"bad name":"v"}').toString('base64url'))).toBeNull();
    expect(decodeAuthState(Buffer.from('{"a":"v;w"}').toString('base64url'))).toBeNull();
    expect(decodeAuthState('A'.repeat(9000))).toBeNull();
  });

  it('applies Set-Cookie like a cookie jar', () => {
    const state: Record<string, string> = {};
    applySetCookie(
      state,
      'erp.session_token=tok.sig; Max-Age=1800; Path=/; HttpOnly; SameSite=Lax',
    );
    applySetCookie(state, 'erp.two_factor=pending; Path=/');
    expect(state).toEqual({ 'erp.session_token': 'tok.sig', 'erp.two_factor': 'pending' });
    applySetCookie(state, 'erp.two_factor=; Max-Age=0; Path=/');
    expect(state).toEqual({ 'erp.session_token': 'tok.sig' });
    applySetCookie(state, 'erp.session_token=gone; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(state).toEqual({});
    applySetCookie(state, 'garbage');
    expect(state).toEqual({});
  });
});
