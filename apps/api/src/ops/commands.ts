// Backup tool commands (docs/operations.md); the entry point is cli.ts:
//   node dist/ops/cli.js backup  [--dir <folder>] [--dev]
//   node dist/ops/cli.js verify  <backup-folder>
//   node dist/ops/cli.js restore <backup-folder> [--dev] [--database <name>] [--bucket <name>]
//                                [--allow-key-mismatch] [--sign-out-everyone]
//   node dist/ops/cli.js prune   [--dir <folder>] [--keep-latest 30] [--keep-monthly 12]
// Settings come from environment variables (the same names as the API's); secrets are never
// printed.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { z } from 'zod';
import { ConfigError, withFileValues, withoutEmptyValues } from '../platform/config/config.js';
import { BackupIntegrityError } from './backup-crypto.js';
import { BackupFormatError } from './backup-manifest.js';
import { type StorageSettings } from './backup-storage.js';
import { BackupError, createBackup } from './backup.js';
import { PgToolError, type PgToolsTarget } from './pg-tools.js';
import { DEFAULT_RETENTION, pruneBackups } from './prune.js';
import { RestoreError, restoreBackup } from './restore.js';
import { grantFounder } from './founder.js';
import { BackupKeyError, verifyBackup } from './verify.js';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const secret = z.string().min(32, 'must be at least 32 characters');

const envSchema = z.object({
  DATABASE_URL: postgresUrl.optional(),
  DATABASE_MIGRATOR_URL: postgresUrl.optional(),
  DATABASE_ADMIN_URL: postgresUrl.optional(),
  BACKUP_ENCRYPTION_KEY: secret.optional(),
  BACKUP_DIR: z.string().min(1).default('backups'),
  /** Run pg_dump / pg_restore inside this PostgreSQL container instead of locally. */
  PG_TOOLS_CONTAINER: z.string().min(1).optional(),
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3).default('erp-files'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  DATA_ENCRYPTION_KEY: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
});
type Env = z.infer<typeof envSchema>;

class UsageError extends Error {
  override readonly name = 'UsageError';
}

const USAGE = `Usage:
  backup  [--dir <folder>] [--dev]
  verify  <backup-folder>
  restore <backup-folder> [--dev] [--database <name>] [--bucket <name>]
          [--allow-key-mismatch] [--sign-out-everyone]
  prune   [--dir <folder>] [--keep-latest 30] [--keep-monthly 12]`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(['dir', 'database', 'bucket', 'keep-latest', 'keep-monthly']);
const BOOLEAN_FLAGS = new Set(['dev', 'allow-key-mismatch', 'sign-out-everyone', 'revoke']);

export function parseArgs(argv: readonly string[]): Args {
  const [command = '', ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (BOOLEAN_FLAGS.has(name)) flags.set(name, true);
    else if (VALUE_FLAGS.has(name)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`--${name} needs a value.`);
      }
      flags.set(name, value);
      i += 1;
    } else throw new UsageError(`Unknown option --${name}.`);
  }
  return { command, positional, flags };
}

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new UsageError(`${name} is not set.`);
  return value;
}

/** The dev PostgreSQL container (infra/compose/compose.dev.yaml), found through Docker Compose. */
function devContainer(): string {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/compose/compose.dev.yaml',
      '--env-file',
      '.env',
      'ps',
      '-q',
      'postgres',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const id = result.stdout.trim();
  if (result.status !== 0 || !id) {
    throw new UsageError(
      'The development database is not running. Start it with: pnpm services:up',
    );
  }
  return id;
}

function pgTarget(args: Args, env: Env): PgToolsTarget {
  if (args.flags.has('dev')) return { kind: 'container', containerId: devContainer() };
  if (env.PG_TOOLS_CONTAINER) return { kind: 'container', containerId: env.PG_TOOLS_CONTAINER };
  return { kind: 'local' };
}

function storageOf(env: Env, bucket?: string): StorageSettings | undefined {
  if (!env.S3_ENDPOINT) return undefined;
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: bucket ?? env.S3_BUCKET,
    accessKey: need(env.S3_ACCESS_KEY, 'S3_ACCESS_KEY'),
    secretKey: need(env.S3_SECRET_KEY, 'S3_SECRET_KEY'),
  };
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Creates `name` on the server if it does not exist (side-by-side restore drills). */
async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new UsageError('--database must be lowercase letters, digits and underscores.');
  }
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await client.query(`create database ${client.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}

function count(value: string | true | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${name} must be a whole number.`);
  return n;
}

export async function main(argv: readonly string[], rawEnv: NodeJS.ProcessEnv): Promise<void> {
  const log = (line: string) => process.stdout.write(`${line}\n`);
  const args = parseArgs(argv);
  // Same rules as the API: empty = unset, NAME_FILE reads a secret from a file.
  const parsed = envSchema.safeParse(withFileValues(withoutEmptyValues(rawEnv)));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new UsageError(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const env = parsed.data;
  const dirFlag = args.flags.get('dir');
  const backupDir = resolve(typeof dirFlag === 'string' ? dirFlag : env.BACKUP_DIR);

  switch (args.command) {
    case 'backup': {
      await createBackup({
        migratorUrl: need(env.DATABASE_MIGRATOR_URL, 'DATABASE_MIGRATOR_URL'),
        pg: pgTarget(args, env),
        storage: storageOf(env),
        dir: backupDir,
        encryptionKey: need(env.BACKUP_ENCRYPTION_KEY, 'BACKUP_ENCRYPTION_KEY'),
        secrets: { dataEncryptionKey: env.DATA_ENCRYPTION_KEY, authSecret: env.AUTH_SECRET },
        log,
      });
      return;
    }
    case 'verify': {
      const dir = need(args.positional[0], 'The backup folder');
      const { manifest } = await verifyBackup(
        resolve(dir),
        need(env.BACKUP_ENCRYPTION_KEY, 'BACKUP_ENCRYPTION_KEY'),
        log,
      );
      const rows = Object.values(manifest.database.tables).reduce((sum, n) => sum + n, 0);
      const files = manifest.objects.included ? manifest.objects.count : 0;
      log(`Backup of ${manifest.createdAt} is good: ${rows} rows, ${files} stored files.`);
      for (const warning of manifest.warnings) log(`Warning recorded at backup time: ${warning}`);
      return;
    }
    case 'restore': {
      const dir = need(args.positional[0], 'The backup folder');
      let adminUrl = need(env.DATABASE_ADMIN_URL, 'DATABASE_ADMIN_URL');
      let migratorUrl = need(env.DATABASE_MIGRATOR_URL, 'DATABASE_MIGRATOR_URL');
      let appUrl = need(env.DATABASE_URL, 'DATABASE_URL');
      const database = args.flags.get('database');
      if (typeof database === 'string') {
        await ensureDatabase(adminUrl, database);
        adminUrl = withDatabase(adminUrl, database);
        migratorUrl = withDatabase(migratorUrl, database);
        appUrl = withDatabase(appUrl, database);
      }
      const bucket = args.flags.get('bucket');
      const result = await restoreBackup({
        dir: resolve(dir),
        adminUrl,
        migratorUrl,
        appUrl,
        pg: pgTarget(args, env),
        storage: storageOf(env, typeof bucket === 'string' ? bucket : undefined),
        encryptionKey: need(env.BACKUP_ENCRYPTION_KEY, 'BACKUP_ENCRYPTION_KEY'),
        secrets: { dataEncryptionKey: env.DATA_ENCRYPTION_KEY, authSecret: env.AUTH_SECRET },
        allowKeyMismatch: args.flags.has('allow-key-mismatch'),
        signOutEveryone: args.flags.has('sign-out-everyone'),
        log,
      });
      log(`${result.tables} tables, ${result.rows} rows and ${result.objects} files restored.`);
      return;
    }
    case 'prune': {
      const { kept, removed } = await pruneBackups(
        backupDir,
        {
          keepLatest: count(
            args.flags.get('keep-latest'),
            DEFAULT_RETENTION.keepLatest,
            'keep-latest',
          ),
          keepMonthly: count(
            args.flags.get('keep-monthly'),
            DEFAULT_RETENTION.keepMonthly,
            'keep-monthly',
          ),
        },
        log,
      );
      log(`Kept ${kept} backup(s), deleted ${removed.length}.`);
      return;
    }
    case 'founder': {
      const email = need(args.positional[0], 'The account email');
      const outcome = await grantFounder(
        need(env.DATABASE_MIGRATOR_URL, 'DATABASE_MIGRATOR_URL'),
        email,
        args.flags.get('revoke') === true,
      );
      const messages = {
        granted: `${email} can now open the platform console (two-factor must be on to use it).`,
        already: `${email} already has the platform console.`,
        revoked: `${email} no longer has the platform console.`,
        not_operator: `${email} did not have the platform console.`,
        no_account: `No account uses ${email}. The person must sign up first.`,
      } as const;
      log(messages[outcome]);
      if (outcome === 'no_account') throw new UsageError('Nothing changed.');
      return;
    }
    default:
      throw new UsageError(USAGE);
  }
}

const KNOWN_ERRORS = [
  UsageError,
  ConfigError,
  BackupError,
  BackupIntegrityError,
  BackupFormatError,
  BackupKeyError,
  RestoreError,
  PgToolError,
];

const HINTS: Record<string, string> = {
  ECONNREFUSED: 'Cannot reach the database or file storage. Are the services running?',
  '28P01': 'The database rejected the password. Check the DATABASE_* settings.',
  '3D000': 'The database does not exist. Check the DATABASE_* settings.',
  EACCES:
    'Permission denied on the backup folder. In Docker, give it to the app user once: sudo chown 1000:1000 backups',
};

/** One plain sentence for known problems; a stack trace only for real bugs. */
export function describeFailure(err: unknown): { message: string; known: boolean } {
  if (KNOWN_ERRORS.some((type) => err instanceof type)) {
    return { message: (err as Error).message, known: true };
  }
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && HINTS[code]) {
    return { message: `${HINTS[code]} (error code: ${code})`, known: true };
  }
  return { message: err instanceof Error ? (err.stack ?? err.message) : String(err), known: false };
}
