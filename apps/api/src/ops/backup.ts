import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type Readable } from 'node:stream';
import pg from 'pg';
import {
  deriveBackupKey,
  encryptToFile,
  KDF_PARAMS,
  keyCheck,
  newSalt,
  secretFingerprint,
} from './backup-crypto.js';
import {
  BACKUP_FORMAT,
  type BackupFileEntry,
  type Manifest,
  type ObjectEntry,
  writeManifest,
} from './backup-manifest.js';
import { BackupStorage, type StorageSettings } from './backup-storage.js';
import {
  appliedMigrations,
  countRows,
  forcedRlsTables,
  listTables,
  partlyReadableTables,
} from './database-inventory.js';
import { connectionFor, type PgToolsTarget, runPgTool } from './pg-tools.js';

export interface BackupOptions {
  /** erp_migrator connection: owns every table and may read every row (explicit policy). */
  migratorUrl: string;
  pg: PgToolsTarget;
  /** The file bucket; undefined when this installation has no file storage configured. */
  storage?: StorageSettings | undefined;
  /** Folder that holds backups; each backup is one sub-folder. */
  dir: string;
  /** BACKUP_ENCRYPTION_KEY. Keep it away from the backups themselves. */
  encryptionKey: string;
  /** Application secrets in use, fingerprinted so a restore can spot a key mismatch. */
  secrets?: { dataEncryptionKey?: string | undefined; authSecret?: string | undefined };
  now?: Date | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface BackupResult {
  path: string;
  manifest: Manifest;
}

export class BackupError extends Error {
  override readonly name = 'BackupError';
}

export const DUMP_FILE = 'database.dump.enc';
export const OBJECT_INDEX_FILE = 'objects.json.enc';

/** `uerp-20261031T161043Z`: sorts by time and is a valid folder name everywhere. */
export function backupName(date: Date): string {
  return `uerp-${date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')}`;
}

async function appVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Name of an object's file inside the backup: derived from its key, never the key itself. */
export function objectFileName(key: string): string {
  return `objects/${createHash('sha256').update(key).digest('hex')}.enc`;
}

/**
 * Renames the finished backup folder. On Windows, antivirus or indexing briefly holds newly
 * written files open (EPERM / EBUSY), so the rename is retried for up to ~15 seconds.
 */
async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 30 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100 * (attempt + 1), 1000)));
    }
  }
}

export function httpStatus(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

interface FileRow {
  storage_key: string;
  sha256: string;
}

const NOT_INFECTED_FILES =
  "select storage_key, sha256 from public.files where status <> 'infected' order by storage_key";

/**
 * Makes one complete, encrypted backup: the database (pg_dump, custom format) and every stored
 * file a file record points to, plus a manifest with exact row counts from the same snapshot.
 * Written to `<name>.partial` and renamed only when complete, so a half-written backup never
 * looks usable.
 */
export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const name = backupName(now);
  const finalPath = join(options.dir, name);
  const work = `${finalPath}.partial`;
  await mkdir(options.dir, { recursive: true, mode: 0o700 });
  await mkdir(join(work, 'objects'), { recursive: true, mode: 0o700 });

  try {
    const salt = newSalt();
    const key = await deriveBackupKey(options.encryptionKey, salt);
    const files: BackupFileEntry[] = [];
    const warnings: string[] = [];

    // 1. Database: one REPEATABLE READ snapshot shared by the row counts and pg_dump.
    const client = new pg.Client({ connectionString: options.migratorUrl });
    await client.connect();
    let database: Manifest['database'];
    let fileRows: FileRow[] = [];
    try {
      const hidden = await partlyReadableTables(client);
      if (hidden.length > 0) {
        throw new BackupError(
          `Refusing to back up: the backup role may not see every row of ${hidden.join(', ')}. Each protected table needs a "<table>_migrator" policy USING (true) (docs/database.md section 4).`,
        );
      }
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = (await client.query<{ id: string }>('select pg_export_snapshot() as id'))
        .rows[0]?.id;
      if (!snapshot) throw new BackupError('Could not take a database snapshot.');
      const serverVersion =
        (await client.query<{ v: string }>('show server_version')).rows[0]?.v ?? '';
      const tables = await listTables(client);
      log(`Counting rows in ${tables.length} tables.`);
      const counts = await countRows(client, tables);
      const forcedRls = await forcedRlsTables(client);
      const migrations = await appliedMigrations(client);
      if (tables.includes('public.files')) {
        fileRows = (await client.query<FileRow>(NOT_INFECTED_FILES)).rows;
      }

      log('Dumping the database.');
      const connection = connectionFor(options.migratorUrl, options.pg);
      let written: Awaited<ReturnType<typeof encryptToFile>> | undefined;
      await runPgTool({
        target: options.pg,
        tool: 'pg_dump',
        password: connection.password,
        args: [
          '--format=custom',
          // FORCE row-level security applies to the table owner too; its policy shows all rows.
          '--enable-row-security',
          `--snapshot=${snapshot}`,
          '--lock-wait-timeout=60s',
          '--no-password',
          `--dbname=${connection.url}`,
        ],
        output: async (stdout: Readable) => {
          written = await encryptToFile(
            stdout as AsyncIterable<Buffer>,
            join(work, DUMP_FILE),
            key,
            'database',
          );
        },
      });
      await client.query('COMMIT');
      if (!written) throw new BackupError('pg_dump produced no output.');
      files.push({ name: DUMP_FILE, size: written.size, sha256: written.sha256 });
      database = { serverVersion, dumpFile: DUMP_FILE, migrations, tables: counts, forcedRls };
      const megabytes = (written.plainSize / 1024 / 1024).toFixed(1);
      log(`Database: ${tables.length} tables, ${megabytes} MB.`);
    } finally {
      await client.end();
    }

    // 2. Stored files that the database refers to (unreferenced objects are unreachable).
    let objects: Manifest['objects'];
    if (!options.storage) {
      objects = { included: false, reason: 'No file storage is configured (S3_ENDPOINT unset).' };
      warnings.push('Files were not included: no file storage is configured.');
    } else {
      const storage = new BackupStorage(options.storage);
      try {
        log(`Copying ${fileRows.length} stored files.`);
        const index: ObjectEntry[] = [];
        let missing = 0;
        let damaged = 0;
        let bytesTotal = 0;
        for (const row of fileRows) {
          let object: Awaited<ReturnType<BackupStorage['read']>>;
          try {
            object = await storage.read(row.storage_key);
          } catch (err) {
            if (httpStatus(err) === 404) {
              missing += 1;
              continue;
            }
            throw err;
          }
          const file = objectFileName(row.storage_key);
          const out = await encryptToFile(
            object.body,
            join(work, file),
            key,
            `object:${row.storage_key}`,
          );
          if (out.plainSha256 !== row.sha256) damaged += 1;
          index.push({
            key: row.storage_key,
            file,
            size: out.plainSize,
            sha256: out.plainSha256,
            contentType: object.contentType,
          });
          files.push({ name: file, size: out.size, sha256: out.sha256 });
          bytesTotal += out.plainSize;
        }
        if (missing > 0) {
          warnings.push(`${missing} file record(s) point to a stored file that does not exist.`);
        }
        if (damaged > 0) {
          warnings.push(
            `${damaged} stored file(s) differ from the checksum recorded at upload (damaged storage?). Backed up as found.`,
          );
        }
        const written = await encryptToFile(
          [Buffer.from(JSON.stringify(index))],
          join(work, OBJECT_INDEX_FILE),
          key,
          'objects-index',
        );
        files.push({ name: OBJECT_INDEX_FILE, size: written.size, sha256: written.sha256 });
        objects = {
          included: true,
          bucket: storage.bucket,
          count: index.length,
          bytes: bytesTotal,
          indexFile: OBJECT_INDEX_FILE,
        };
      } finally {
        storage.close();
      }
    }

    const fingerprints: Manifest['secretFingerprints'] = {};
    if (options.secrets?.dataEncryptionKey) {
      fingerprints.DATA_ENCRYPTION_KEY = secretFingerprint(options.secrets.dataEncryptionKey);
    }
    if (options.secrets?.authSecret) {
      fingerprints.AUTH_SECRET = secretFingerprint(options.secrets.authSecret);
    }
    const manifest: Manifest = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      createdAt: now.toISOString(),
      appVersion: await appVersion(),
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: 'scrypt',
        salt,
        ...KDF_PARAMS,
        keyCheck: keyCheck(key),
      },
      secretFingerprints: fingerprints,
      database,
      objects,
      files,
      warnings,
    };
    await writeManifest(work, manifest);
    await renameWhenFree(work, finalPath);
    for (const warning of warnings) log(`Warning: ${warning}`);
    log(`Backup complete: ${finalPath}`);
    return { path: finalPath, manifest };
  } catch (err) {
    await rm(work, { recursive: true, force: true });
    throw err;
  }
}
