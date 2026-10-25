import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type Database,
  resolveTenantByHost,
  type TenantTransaction,
  UnsafeDatabaseRoleError,
  withTenant,
} from '@ultimate-erp/db';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../errors/app-error.js';
import { DatabaseRoleCheck } from './database-role-check.js';
import { DB } from './database.tokens.js';

/**
 * The only way application code reaches tenant data (ADR-0003). Every call runs inside a
 * transaction bound to one tenant, after verifying the connection role is safe.
 */
@Injectable()
export class TenantDatabase {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly roleCheck: DatabaseRoleCheck,
    @InjectPinoLogger(TenantDatabase.name) private readonly logger: PinoLogger,
  ) {}

  async withTenant<T>(tenantId: string, fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    await this.ensureSafeRole();
    return withTenant(this.db, tenantId, fn);
  }

  /** Tenant ID for a verified host of an active tenant, or null. */
  async resolveHost(hostname: string): Promise<string | null> {
    await this.ensureSafeRole();
    return resolveTenantByHost(this.db, hostname);
  }

  /** Unsafe role or unreachable database ⇒ 503: an honest "try again later", never data. */
  private async ensureSafeRole(): Promise<void> {
    try {
      await this.roleCheck.assertSafe();
    } catch (err) {
      if (!(err instanceof UnsafeDatabaseRoleError)) {
        this.logger.warn({ err }, 'Database unavailable');
      }
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        HttpStatus.SERVICE_UNAVAILABLE,
        'The service is temporarily unavailable.',
      );
    }
  }
}
