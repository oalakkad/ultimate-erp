import { sql } from 'drizzle-orm';
import pg from 'pg';
import { type Db, fromDrizzle, PgBoss } from 'pg-boss';
import { type Database, type TenantTransaction } from './client.js';
import { DB_ROLES } from './roles.js';

/**
 * Lets pg-boss run its own parameterized SQL inside one of our transactions, so a job is
 * stored if and only if that transaction commits — the outbox guarantee (architecture §5
 * step 9). Uses pg-boss's own Drizzle adapter (values stay bound parameters).
 */
export function transactionExecutor(tx: Database | TenantTransaction): Db {
  return fromDrizzle(tx, sql);
}

/** Postgres schema holding the pg-boss job queue (global: payloads carry their own tenant ID). */
export const JOB_SCHEMA = 'pgboss';

/**
 * Every queue and its delivery policy. Queues are created here, by the migration runner as
 * erp_migrator, because creating one is DDL; the API and worker (erp_app) only add and take
 * jobs. Adding a queue = add it here and run `pnpm db:setup`.
 */
export const JOB_QUEUES = {
  /** Transactional email (docs/modules/platform-jobs.md §3): 5 retries, 30 s doubling. */
  'email.send': {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 30 * 60,
    expireInSeconds: 5 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  },
} as const;

export type JobName = keyof typeof JOB_QUEUES;

/**
 * Installs or upgrades pg-boss's tables, creates/updates our queues and grants erp_app the
 * row-level privileges it needs (no DDL). Idempotent; part of `runMigrations`.
 */
export async function installJobQueue(migratorUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: migratorUrl,
    schema: JOB_SCHEMA,
    max: 1,
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
  });
  boss.on('error', () => undefined); // surfaced by start()/createQueue rejections instead
  await boss.start();
  try {
    for (const [name, options] of Object.entries(JOB_QUEUES)) {
      if (await boss.getQueue(name)) await boss.updateQueue(name, options);
      else await boss.createQueue(name, options);
    }
  } finally {
    await boss.stop({ graceful: false, close: true });
  }

  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    const schema = client.escapeIdentifier(JOB_SCHEMA);
    const app = client.escapeIdentifier(DB_ROLES.app);
    await client.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${app}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${app}`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${app}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${app}`);
  } finally {
    await client.end();
  }
}
