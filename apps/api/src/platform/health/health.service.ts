import { Inject, Injectable } from '@nestjs/common';
import { type DependencyStatus, type HealthResponse } from '@ultimate-erp/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import { DatabaseRoleCheck } from '../database/database-role-check.js';
import { DB_POOL } from '../database/database.tokens.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB_POOL) private readonly pool: pg.Pool,
    private readonly roleCheck: DatabaseRoleCheck,
    @InjectPinoLogger(HealthService.name) private readonly logger: PinoLogger,
  ) {}

  async check(): Promise<HealthResponse> {
    const database = await this.checkDatabase();
    return {
      status: database.status === 'up' ? 'ok' : 'error',
      checks: { database },
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<{ status: DependencyStatus; latencyMs?: number }> {
    const started = performance.now();
    try {
      // Bounded by the pool timeouts (2 s to connect, 5 s per query).
      await this.pool.query('SELECT 1');
      // Connected as a role that could bypass tenant isolation counts as "down".
      await this.roleCheck.assertSafe();
      return { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      // The reason stays in server logs; the public response only says "down".
      this.logger.warn({ err }, 'Database health check failed');
      return { status: 'down' };
    }
  }
}
