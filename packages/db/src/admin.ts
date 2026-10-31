import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { installJobQueue } from './jobs.js';
import { DB_ROLES } from './roles.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export interface DatabaseUrls {
  /** Superuser/DBA connection. Used only to create roles. Dev and test only. */
  adminUrl: string;
  /** erp_migrator connection: runs migrations. */
  migratorUrl: string;
  /** erp_app connection: what the API uses. */
  appUrl: string;
}

function credentials(url: string, expectedUser: string) {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  if (user !== expectedUser) {
    throw new Error(`Expected the connection user to be "${expectedUser}", got "${user}".`);
  }
  const password = decodeURIComponent(parsed.password);
  if (password.length < 12) {
    throw new Error(`Password for "${expectedUser}" must be at least 12 characters.`);
  }
  if (/replace-?with|change-?me/i.test(password)) {
    throw new Error(
      `Password for "${expectedUser}" is still the placeholder from prod.env.example.`,
    );
  }
  return { user, password, database: parsed.pathname.slice(1) };
}

/**
 * Creates (or updates) the database roles and the schema ownership they need.
 * Idempotent: safe to run on every `pnpm dev`. In production a DBA runs the
 * equivalent statements once (see docs/database.md).
 */
export async function bootstrapDatabase(urls: DatabaseUrls): Promise<void> {
  const migrator = credentials(urls.migratorUrl, DB_ROLES.migrator);
  const app = credentials(urls.appUrl, DB_ROLES.app);
  const client = new pg.Client({ connectionString: urls.adminUrl });
  await client.connect();
  try {
    const ensureRole = async (name: string, attributes: string, password?: string) => {
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      const pw = password === undefined ? '' : ` PASSWORD ${client.escapeLiteral(password)}`;
      // Role names are fixed constants (DB_ROLES); passwords are escaped literals.
      await client.query(`${verb} ROLE ${client.escapeIdentifier(name)} ${attributes}${pw}`);
    };

    const restricted = 'NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION';
    await ensureRole(DB_ROLES.migrator, `LOGIN ${restricted}`, migrator.password);
    await ensureRole(DB_ROLES.app, `LOGIN ${restricted} NOINHERIT`, app.password);
    await ensureRole(DB_ROLES.platform, `NOLOGIN ${restricted} NOINHERIT`);

    const db = client.escapeIdentifier(migrator.database);
    const m = client.escapeIdentifier(DB_ROLES.migrator);
    const a = client.escapeIdentifier(DB_ROLES.app);
    const p = client.escapeIdentifier(DB_ROLES.platform);
    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await client.query(`GRANT CONNECT, CREATE ON DATABASE ${db} TO ${m}`);
    await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${a}, ${p}`);
    await client.query(`ALTER SCHEMA public OWNER TO ${m}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${a}, ${p}`);
  } finally {
    await client.end();
  }
}

/**
 * Applies all pending migrations as erp_migrator, then installs/upgrades the job queue.
 * Already-applied migrations are skipped.
 */
export async function runMigrations(migratorUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: migratorUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  await installJobQueue(migratorUrl);
}
