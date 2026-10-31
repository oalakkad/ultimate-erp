import { join } from 'node:path';
import { assertSafeAppRole, createDatabase } from '@ultimate-erp/db';
import { bootstrapDatabase, runMigrations } from '@ultimate-erp/db/admin';
import pg from 'pg';
import { decryptToBuffer, decryptFile, secretFingerprint } from './backup-crypto.js';
import { createHash } from 'node:crypto';
import { BackupStorage, type StorageSettings } from './backup-storage.js';
import {
  countRows,
  forcedRlsTables,
  isEmptyDatabase,
  knownMigrations,
  listTables,
  migrationProblem,
  unprotectedTenantTables,
} from './database-inventory.js';
import { connectionFor, type PgToolsTarget, runPgTool } from './pg-tools.js';
import { verifyBackup } from './verify.js';

export interface RestoreOptions {
  /** Backup folder (contains manifest.json). */
  dir: string;
  /** Administrator connection: creates the roles (once). Never used by the running app. */
  adminUrl: string;
  migratorUrl: string;
  appUrl: string;
  pg: PgToolsTarget;
  /** Target file bucket; required when the backup includes files. Must be empty. */
  storage?: StorageSettings | undefined;
  encryptionKey: string;
  /** Secrets of the server that will use the restored data, compared with the backup's. */
  secrets?: { dataEncryptionKey?: string | undefined; authSecret?: string | undefined };
  /** Restore even though DATA_ENCRYPTION_KEY / AUTH_SECRET differ from the backup's. */
  allowKeyMismatch?: boolean | undefined;
  /** Ends every session in the restored data (e.g. restoring after a security incident). */
  signOutEveryone?: boolean | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface RestoreResult {
  tables: number;
  rows: number;
  objects: number;
  migrationsApplied: number;
  warnings: string[];
}

export class RestoreError extends Error {
  override readonly name = 'RestoreError';
}

async function withClient<T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Restores a backup into an EMPTY database and an EMPTY bucket (docs/operations.md section 3).
 * Everything that can be checked is checked before anything is written: the files, the key,
 * the application secrets, the software version and that both targets are empty. Afterwards it
 * proves the result: exact row counts, the same tables under forced row-level security, a safe
 * app role, and every stored file byte-for-byte.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const log = options.log ?? (() => undefined);
  const warnings: string[] = [];

  // ---- Checks before writing anything -------------------------------------------------------
  log('Checking the backup.');
  const { manifest, key, objects } = await verifyBackup(options.dir, options.encryptionKey, log);

  const mismatched: string[] = [];
  for (const [name, expected] of Object.entries(manifest.secretFingerprints)) {
    const value =
      name === 'DATA_ENCRYPTION_KEY'
        ? options.secrets?.dataEncryptionKey
        : options.secrets?.authSecret;
    if (!value) {
      warnings.push(`${name} was not provided, so it could not be compared with the backup's.`);
    } else if (secretFingerprint(value) !== expected) {
      mismatched.push(name);
    }
  }
  if (mismatched.length > 0 && !options.allowKeyMismatch) {
    throw new RestoreError(
      `${mismatched.join(' and ')} differ from the ones in use when the backup was made. ` +
        'Use the original values (data encrypted with them cannot be read otherwise), or pass ' +
        '--allow-key-mismatch if you accept losing that data.',
    );
  }
  if (mismatched.length > 0)
    warnings.push(`Restored with a different ${mismatched.join(' and ')}.`);

  const problem = migrationProblem(manifest.database.migrations, knownMigrations());
  if (problem) throw new RestoreError(problem);

  if (!(await withClient(options.adminUrl, isEmptyDatabase))) {
    throw new RestoreError(
      'The target database is not empty. Restore only into a new, empty database; nothing was changed.',
    );
  }

  let storage: BackupStorage | undefined;
  if (manifest.objects.included) {
    if (!options.storage) {
      throw new RestoreError('The backup contains files: configure file storage (S3_*) first.');
    }
    storage = new BackupStorage(options.storage);
  } else {
    warnings.push('The backup has no files; only the database is restored.');
  }

  try {
    if (storage && !(await storage.isEmpty())) {
      throw new RestoreError(
        `The file bucket "${storage.bucket}" is not empty. Restore only into a new, empty bucket; nothing was changed.`,
      );
    }

    // ---- Database ---------------------------------------------------------------------------
    log('Creating the database roles.');
    await bootstrapDatabase({
      adminUrl: options.adminUrl,
      migratorUrl: options.migratorUrl,
      appUrl: options.appUrl,
    });

    log('Restoring the database.');
    const connection = connectionFor(options.migratorUrl, options.pg);
    await runPgTool({
      target: options.pg,
      tool: 'pg_restore',
      password: connection.password,
      args: [
        '--no-owner',
        '--exit-on-error',
        // All or nothing: a failure leaves the database empty, ready for another attempt.
        '--single-transaction',
        '--no-password',
        `--dbname=${connection.url}`,
      ],
      input: decryptFile(join(options.dir, manifest.database.dumpFile), key, 'database'),
    });

    const { tables, rows } = await withClient(options.migratorUrl, async (client) => {
      const restoredTables = await listTables(client);
      const expected = manifest.database.tables;
      const counts = await countRows(client, restoredTables);
      const differences: string[] = [];
      for (const table of new Set([...Object.keys(expected), ...restoredTables])) {
        if (expected[table] !== counts[table]) {
          differences.push(
            `${table}: backup ${expected[table] ?? 'none'}, restored ${counts[table] ?? 'none'}`,
          );
        }
      }
      if (differences.length > 0) {
        throw new RestoreError(
          `Row counts differ after the restore:\n  ${differences.join('\n  ')}`,
        );
      }
      const forced = new Set(await forcedRlsTables(client));
      const lost = manifest.database.forcedRls.filter((t) => !forced.has(t));
      if (lost.length > 0) {
        throw new RestoreError(`Row-level security is no longer forced on: ${lost.join(', ')}.`);
      }
      return {
        tables: restoredTables.length,
        rows: Object.values(counts).reduce((sum, n) => sum + n, 0),
      };
    });
    log(`Database restored: ${tables} tables, ${rows} rows, counts match the backup.`);

    // Bring an older backup up to this version, and refresh the job-queue grants.
    const before = manifest.database.migrations.count;
    await runMigrations(options.migratorUrl);
    const migrationsApplied = knownMigrations().count - before;
    if (migrationsApplied > 0) log(`Applied ${migrationsApplied} newer database change(s).`);

    await withClient(options.migratorUrl, async (client) => {
      const unprotected = await unprotectedTenantTables(client);
      if (unprotected.length > 0) {
        throw new RestoreError(
          `Company tables without forced row-level security: ${unprotected.join(', ')}.`,
        );
      }
      if (options.signOutEveryone) {
        const { rowCount } = await client.query('delete from public.sessions');
        log(`Signed everyone out (${rowCount ?? 0} sessions ended).`);
      }
    });
    const appPool = new pg.Pool({ connectionString: options.appUrl, max: 1 });
    try {
      await assertSafeAppRole(createDatabase(appPool));
    } finally {
      await appPool.end();
    }

    // ---- Files ------------------------------------------------------------------------------
    if (storage) {
      log(`Restoring ${objects.length} stored files.`);
      await storage.ensureBucket();
      for (const entry of objects) {
        const body = await decryptToBuffer(
          join(options.dir, entry.file),
          key,
          `object:${entry.key}`,
        );
        if (createHash('sha256').update(body).digest('hex') !== entry.sha256) {
          throw new RestoreError(`A stored file (${entry.file}) does not match its index.`);
        }
        await storage.write(entry.key, body, entry.contentType);
      }
      const restoredKeys = new Set(objects.map((o) => o.key));
      const orphans = await withClient(options.migratorUrl, async (client) => {
        const tablesNow = await listTables(client);
        if (!tablesNow.includes('public.files')) return 0;
        const { rows: fileRows } = await client.query<{ storage_key: string }>(
          "select storage_key from public.files where status <> 'infected'",
        );
        return fileRows.filter((r) => !restoredKeys.has(r.storage_key)).length;
      });
      if (orphans > 0) {
        warnings.push(
          `${orphans} file record(s) have no stored file (they were missing at backup time).`,
        );
      }
    }

    for (const warning of warnings) log(`Warning: ${warning}`);
    log('Restore complete.');
    return { tables, rows, objects: objects.length, migrationsApplied, warnings };
  } finally {
    storage?.close();
  }
}
