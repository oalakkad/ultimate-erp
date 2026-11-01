import { AUTH_STATE_HEADER, meResponseSchema } from '@ultimate-erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { type ApiError, createApiClient, isApiError, normaliseServerUrl } from '../src/lib/api';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('mobile API client', () => {
  it('sends the auth state header, never cookies, and stores the state the server returns', async () => {
    let state = 'old-state';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json(200, { status: 'ok' }, { [AUTH_STATE_HEADER]: 'new-state', 'x-request-id': 'r-1' }),
      );
    const api = createApiClient({
      origin: 'https://acme.example',
      getState: () => state,
      setState: (next) => {
        state = next;
      },
      fetch: fetchMock,
    });
    await api('/auth/sign-out', { method: 'POST' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://acme.example/api/v1/auth/sign-out');
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>)[AUTH_STATE_HEADER]).toBe('old-state');
    expect(state).toBe('new-state');
  });

  it('checks the answer against the contract schema', async () => {
    const api = createApiClient({
      origin: 'https://acme.example',
      getState: () => '',
      setState: () => undefined,
      fetch: () => Promise.resolve(json(200, { user: { id: 'not-a-uuid' } })),
    });
    await expect(api('/auth/me', { schema: meResponseSchema })).rejects.toThrow();
  });

  it('turns error answers into ApiError with the code and reference', async () => {
    const api = createApiClient({
      origin: 'https://acme.example',
      getState: () => '',
      setState: () => undefined,
      fetch: () =>
        Promise.resolve(
          json(
            401,
            { error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'abc' } },
            { 'x-request-id': 'abc' },
          ),
        ),
    });
    const err = await api('/auth/me').catch((e: unknown) => e);
    expect(isApiError(err, 'UNAUTHENTICATED')).toBe(true);
    expect((err as ApiError).requestId).toBe('abc');
  });

  it('reports a network failure as NETWORK', async () => {
    const api = createApiClient({
      origin: 'https://acme.example',
      getState: () => '',
      setState: () => undefined,
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    const err = await api('/auth/me').catch((e: unknown) => e);
    expect(isApiError(err, 'NETWORK')).toBe(true);
  });

  it('normalises the server address typed by a person', () => {
    expect(normaliseServerUrl(' https://erp.firm.com/ ')).toBe('https://erp.firm.com');
    expect(normaliseServerUrl('http://localhost:5173/anything')).toBe('http://localhost:5173');
    expect(normaliseServerUrl('erp.firm.com')).toBeNull();
    expect(normaliseServerUrl('ftp://erp.firm.com')).toBeNull();
    expect(normaliseServerUrl('https://user:pw@erp.firm.com')).toBeNull();
  });
});
