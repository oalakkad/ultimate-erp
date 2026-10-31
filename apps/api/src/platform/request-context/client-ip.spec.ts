import { type Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientIp, PROXY_HOPS_SETTING } from './client-ip.js';

function request(hops: number, remoteAddress: string, forwardedFor?: string): Request {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    app: { get: (name: string) => (name === PROXY_HOPS_SETTING ? hops : undefined) },
  } as unknown as Request;
}

describe('clientIp', () => {
  it('uses the connection and ignores X-Forwarded-For without trusted proxies', () => {
    expect(clientIp(request(0, '198.51.100.7', '6.6.6.6'))).toBe('198.51.100.7');
  });

  it('takes the address the nearest proxy saw (one trusted proxy)', () => {
    // nginx appended the client's address; "6.6.6.6" was sent by the client itself.
    expect(clientIp(request(1, '172.18.0.5', '6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
  });

  it('walks back one entry per trusted proxy (HTTPS proxy + nginx)', () => {
    expect(clientIp(request(2, '172.18.0.5', '6.6.6.6, 203.0.113.9, 172.18.0.9'))).toBe(
      '203.0.113.9',
    );
  });

  it('falls back to the furthest known address when the chain is shorter than configured', () => {
    expect(clientIp(request(2, '172.18.0.5'))).toBe('172.18.0.5');
    expect(clientIp(request(3, '172.18.0.5', '203.0.113.9'))).toBe('203.0.113.9');
  });

  it('handles repeated headers', () => {
    const req = request(1, '172.18.0.5');
    (req.headers as Record<string, string[]>)['x-forwarded-for'] = ['6.6.6.6', '203.0.113.9'];
    expect(clientIp(req)).toBe('203.0.113.9');
  });
});
