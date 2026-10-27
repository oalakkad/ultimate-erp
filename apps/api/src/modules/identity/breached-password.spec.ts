import { createHash } from 'node:crypto';
import { type PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { type AppConfig } from '../../platform/config/config.js';
import { BreachedPasswordChecker } from './breached-password.js';

const config = (enabled: boolean) =>
  ({
    PASSWORD_BREACH_CHECK: enabled,
    PASSWORD_BREACH_API_URL: 'https://hibp.test',
  }) as AppConfig;
const warn = vi.fn();
const logger = { warn } as unknown as PinoLogger;
const suffixOf = (password: string) =>
  createHash('sha1').update(password).digest('hex').toUpperCase().slice(5);

describe('BreachedPasswordChecker', () => {
  it('flags a password whose hash suffix is listed, sending only the 5-character prefix', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(`AAAA:3\r\n${suffixOf('hunter2hunter2')}:12`)),
    );
    const checker = new BreachedPasswordChecker(config(true), fetchFn, logger);
    expect(await checker.isBreached('hunter2hunter2')).toBe(true);
    const [url] = fetchFn.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toMatch(/^\/range\/[0-9A-F]{5}$/);
    expect(url.toString()).not.toContain('hunter2');
  });

  it('ignores padding entries with a zero count', async () => {
    const fetchFn = () => Promise.resolve(new Response(`${suffixOf('padded-password')}:0`));
    const checker = new BreachedPasswordChecker(config(true), fetchFn, logger);
    expect(await checker.isBreached('padded-password')).toBe(false);
  });

  it('fails open with a warning when the service is unreachable', async () => {
    const fetchFn = () => Promise.reject(new Error('network down'));
    const checker = new BreachedPasswordChecker(config(true), fetchFn, logger);
    expect(await checker.isBreached('anything-at-all')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('makes no request when disabled (offline on-prem)', async () => {
    const fetchFn = vi.fn();
    const checker = new BreachedPasswordChecker(config(false), fetchFn as typeof fetch, logger);
    expect(await checker.isBreached('anything-at-all')).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
