import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type Database } from '@ultimate-erp/db';
import { sql } from 'drizzle-orm';
import { DB } from '../database/database.tokens.js';
import { AppError } from '../errors/app-error.js';

export interface RateLimitRule {
  /** Short rule name, part of the key, e.g. "sign-in:ip". */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Thrown when a limit is exceeded; carries the seconds until the window resets. */
export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'Too many requests. Try again later.');
  }
}

/**
 * Fixed-window counters stored in PostgreSQL, so limits hold across several API instances and
 * restarts (an in-memory limiter would reset and could be bypassed by load balancing).
 * Keys are hashed: no email addresses or IPs are stored in the table.
 */
@Injectable()
export class RateLimiter {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Counts one event and returns the count within the current window. */
  async hit(rule: RateLimitRule, subject: string): Promise<{ count: number; retryAfter: number }> {
    const key = this.key(rule, subject);
    const result = await this.db.execute<{ count: number; retry_after: number }>(sql`
      insert into rate_limit_buckets (key, window_start, count)
      values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limit_buckets.window_start <= now() - make_interval(secs => ${rule.windowSeconds})
                     then 1 else rate_limit_buckets.count + 1 end,
        window_start = case when rate_limit_buckets.window_start <= now() - make_interval(secs => ${rule.windowSeconds})
                            then now() else rate_limit_buckets.window_start end
      returning count,
        greatest(1, ceil(extract(epoch from (window_start + make_interval(secs => ${rule.windowSeconds}) - now()))))::int
          as retry_after
    `);
    const row = result.rows[0];
    return { count: row?.count ?? 1, retryAfter: row?.retry_after ?? rule.windowSeconds };
  }

  /** Counts one event and throws RateLimitedError once the limit is exceeded. */
  async consume(rule: RateLimitRule, subject: string): Promise<void> {
    const { count, retryAfter } = await this.hit(rule, subject);
    if (count > rule.limit) throw new RateLimitedError(retryAfter);
  }

  /** Throws if the limit is already exceeded, without counting (e.g. "is this account locked?"). */
  async assertNotLimited(rule: RateLimitRule, subject: string): Promise<void> {
    const key = this.key(rule, subject);
    const result = await this.db.execute<{ count: number; retry_after: number }>(sql`
      select count,
        greatest(1, ceil(extract(epoch from (window_start + make_interval(secs => ${rule.windowSeconds}) - now()))))::int
          as retry_after
      from rate_limit_buckets
      where key = ${key} and window_start > now() - make_interval(secs => ${rule.windowSeconds})
    `);
    const row = result.rows[0];
    if (row && row.count >= rule.limit) throw new RateLimitedError(row.retry_after);
  }

  /** Clears a counter, e.g. failed sign-ins after a successful one. */
  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    await this.db.execute(
      sql`delete from rate_limit_buckets where key = ${this.key(rule, subject)}`,
    );
  }

  private key(rule: RateLimitRule, subject: string): string {
    return createHash('sha256').update(`${rule.name}\u0000${subject.toLowerCase()}`).digest('hex');
  }
}
