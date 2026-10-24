import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config.js';
import { buildLoggerOptions } from './logger-options.js';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const config = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost/db', LOG_LEVEL: 'info' });
  const logger = pino(buildLoggerOptions(config), stream);
  return { logger, output: () => lines.join('') };
}

describe('log redaction', () => {
  it('redacts credentials in request and response headers', () => {
    const { logger, output } = captureLogger();
    logger.info({
      req: { headers: { authorization: 'Bearer abc.def', cookie: 'session=xyz', host: 'acme' } },
      res: { headers: { 'set-cookie': 'session=xyz' } },
    });
    const logged = output();
    expect(logged).not.toContain('abc.def');
    expect(logged).not.toContain('session=xyz');
    expect(logged).toContain('acme');
    expect(logged).toContain('[Redacted]');
  });

  it('redacts sensitive fields at the top level and one level deep', () => {
    const { logger, output } = captureLogger();
    logger.info({
      password: 'hunter2-top',
      body: { password: 'hunter2-nested', otp: '123456', iban: 'KW81CBKU0000000000001234560101' },
      user: { email: 'a@example.com' },
    });
    const logged = output();
    for (const secret of ['hunter2-top', 'hunter2-nested', '123456', 'KW81CBKU']) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('a@example.com');
  });
});
