import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type AppConfig } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';

/** Swappable for tests; defaults to the global fetch. */
export const BREACH_FETCH = Symbol('BREACH_FETCH');

/**
 * Checks a password against Have I Been Pwned's range API using k-anonymity: only the first
 * 5 characters of its SHA-1 hash are sent, never the password. If the service is unreachable
 * the check is skipped with a warning (failing closed would block every sign-up during an
 * outage); on-prem installs without internet set PASSWORD_BREACH_CHECK=false.
 */
@Injectable()
export class BreachedPasswordChecker {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BREACH_FETCH) private readonly fetchFn: typeof fetch,
    @InjectPinoLogger(BreachedPasswordChecker.name) private readonly logger: PinoLogger,
  ) {}

  async isBreached(password: string): Promise<boolean> {
    if (!this.config.PASSWORD_BREACH_CHECK) return false;
    const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    try {
      const response = await this.fetchFn(
        new URL(`/range/${prefix}`, this.config.PASSWORD_BREACH_API_URL),
        { headers: { 'Add-Padding': 'true' }, signal: AbortSignal.timeout(3_000) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      return body.split('\n').some((line) => {
        const [lineSuffix, count] = line.trim().split(':');
        return lineSuffix === suffix && Number(count) > 0;
      });
    } catch (err) {
      this.logger.warn({ err }, 'Breached-password check unavailable; password not checked');
      return false;
    }
  }
}
