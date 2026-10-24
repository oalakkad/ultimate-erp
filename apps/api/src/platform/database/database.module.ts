import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { type AppConfig } from '../config/config.js';

export const DB_POOL = Symbol('DB_POOL');

/**
 * One connection pool per process. Connections open lazily, so the API still
 * starts (and reports "database down" on /health) when Postgres is unavailable.
 * Milestone 1.2 adds Drizzle, DB roles and the tenant-scoped `withTenant` helper on top.
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
      ],
      exports: [DB_POOL],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
