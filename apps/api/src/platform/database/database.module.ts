import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDatabase } from '@ultimate-erp/db';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { type AppConfig } from '../config/config.js';
import { DatabaseRoleCheck } from './database-role-check.js';
import { DB, DB_POOL } from './database.tokens.js';
import { TenantDatabase } from './tenant-database.js';

/**
 * One connection pool per process, connected as erp_app (subject to row-level security).
 * Connections open lazily, so the API still starts (and reports "database down" on /health)
 * when Postgres is unavailable. Business modules use `TenantDatabase` only.
 */
@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: pg.Pool) {}

  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DB_POOL,
          inject: [PinoLogger],
          useFactory: (logger: PinoLogger) => {
            logger.setContext('Database');
            const pool = new pg.Pool({
              connectionString: config.DATABASE_URL,
              max: config.DB_POOL_MAX,
              connectionTimeoutMillis: 2_000,
              query_timeout: 5_000,
              application_name: 'ultimate-erp-api',
            });
            // Without this listener an idle connection dropping would crash the process.
            pool.on('error', (err) => {
              logger.error({ err }, 'Idle database connection error');
            });
            return pool;
          },
        },
        { provide: DB, inject: [DB_POOL], useFactory: (pool: pg.Pool) => createDatabase(pool) },
        DatabaseRoleCheck,
        TenantDatabase,
      ],
      exports: [DB_POOL, DatabaseRoleCheck, TenantDatabase],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
