import { Inject, Injectable } from '@nestjs/common';
import { assertSafeAppRole, type Database, UnsafeDatabaseRoleError } from '@ultimate-erp/db';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DB } from './database.tokens.js';

/**
 * Verifies once per process that the API is connected as erp_app (no superuser, no BYPASSRLS).
 * If it were connected as a privileged role, row-level security would silently not apply, so
 * all data access is refused instead. A failed *connection* is not cached and is retried.
 */
@Injectable()
export class DatabaseRoleCheck {
  private verified: Promise<void> | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    @InjectPinoLogger(DatabaseRoleCheck.name) private readonly logger: PinoLogger,
  ) {}

  assertSafe(): Promise<void> {
    this.verified ??= assertSafeAppRole(this.db).catch((err: unknown) => {
      if (err instanceof UnsafeDatabaseRoleError) {
        this.logger.fatal({ err }, 'Refusing database access: unsafe database role');
        throw err; // keep the rejected promise: an unsafe role does not fix itself
      }
      this.verified = undefined; // connection problem: try again next time
      throw err;
    });
    return this.verified;
  }
}
