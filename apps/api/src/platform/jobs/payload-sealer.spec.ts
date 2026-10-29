import { describe, expect, it } from 'vitest';
import { type AppConfig } from '../config/config.js';
import { mailErrorCode } from '../mail/email-outbox.js';
import { PayloadSealer } from './payload-sealer.js';

const sealer = (secret: string) => new PayloadSealer({ AUTH_SECRET: secret } as AppConfig);
const a = sealer('first-secret-0123456789-0123456789-0123456789');

describe('PayloadSealer', () => {
  it('round-trips a value and never shows it in the sealed text', () => {
    const value = { url: 'https://x.example/reset?token=abc123', to: 'p@example.com' };
    const sealed = a.seal(value);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('abc123');
    expect(sealed).not.toContain('example.com');
    expect(a.open(sealed)).toEqual(value);
  });

  it('uses a fresh IV each time', () => {
    expect(a.seal({ x: 1 })).not.toBe(a.seal({ x: 1 }));
  });

  it('refuses tampered payloads and payloads from another key', () => {
    const sealed = a.seal({ x: 1 });
    const parts = sealed.split('.');
    const body = Buffer.from(parts[2] ?? '', 'base64url');
    body[0] = (body[0] ?? 0) ^ 1;
    const tampered = [parts[0], parts[1], body.toString('base64url'), parts[3]].join('.');
    expect(() => a.open(tampered)).toThrow();
    expect(() => sealer('other-secret-0123456789-0123456789-01234567').open(sealed)).toThrow();
    expect(() => a.open('v2.x.y.z')).toThrow('Unknown payload format');
  });
});

describe('mailErrorCode', () => {
  it.each([
    [{ code: 'ECONNECTION' }, 'SMTP_UNAVAILABLE'],
    [{ code: 'ETIMEDOUT' }, 'SMTP_UNAVAILABLE'],
    [{ code: 'EAUTH' }, 'SMTP_AUTH'],
    [{ code: 'EENVELOPE' }, 'SMTP_REJECTED'],
    [{ responseCode: 550 }, 'SMTP_REJECTED'],
    [{ responseCode: 421 }, 'SMTP_TEMPORARY'],
    [new Error('anything'), 'SMTP_ERROR'],
    [undefined, 'SMTP_ERROR'],
  ])('%j → %s', (err, code) => {
    expect(mailErrorCode(err)).toBe(code);
  });
});
