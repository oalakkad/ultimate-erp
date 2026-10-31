import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * `manifest.json` — the table of contents of one backup (docs/operations.md §2). Plain JSON so an
 * operator can read it; holds no secrets and no business data (only row counts per table).
 * Everything a restore reads from it is validated: file names cannot point outside the backup.
 */
export const MANIFEST_FILE = 'manifest.json';
export const BACKUP_FORMAT = 'ultimate-erp-backup';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
/** `database.dump.enc`, `objects.json.enc`, `objects/<64 hex>.enc` — nothing else. */
const safeFileName = z
  .string()
  .regex(/^(?:[a-z][a-z0-9-]*(?:\.[a-z0-9]+)+|objects\/[0-9a-f]{64}\.enc)$/);

const fileEntrySchema = z.object({
  name: safeFileName,
  size: z.number().int().nonnegative(),
  sha256: hex64,
});

export const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  appVersion: z.string(),
  encryption: z.object({
    cipher: z.literal('aes-256-gcm'),
    kdf: z.literal('scrypt'),
    salt: z.string().min(16),
    N: z.number().int().positive(),
    r: z.number().int().positive(),
    p: z.number().int().positive(),
    keyCheck: hex64,
  }),
  /** One-way fingerprints of the application secrets in use when the backup was made. */
  secretFingerprints: z.object({
    DATA_ENCRYPTION_KEY: z.string().optional(),
    AUTH_SECRET: z.string().optional(),
  }),
  database: z.object({
    serverVersion: z.string(),
    dumpFile: safeFileName,
    migrations: z.object({
      count: z.number().int().nonnegative(),
      hashes: z.array(hex64),
      latest: z.number().int().nonnegative(),
    }),
    /** Exact rows per table, counted in the same snapshot as the dump. */
    tables: z.record(z.string(), z.number().int().nonnegative()),
    /** Tables protected by forced row-level security; a restore must protect the same tables. */
    forcedRls: z.array(z.string()),
  }),
  objects: z.discriminatedUnion('included', [
    z.object({
      included: z.literal(true),
      bucket: z.string(),
      count: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      indexFile: safeFileName,
    }),
    z.object({ included: z.literal(false), reason: z.string() }),
  ]),
  files: z.array(fileEntrySchema),
  warnings: z.array(z.string()),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type BackupFileEntry = z.infer<typeof fileEntrySchema>;

/** One stored object, listed in the encrypted object index (`objects.json.enc`). */
export const objectEntrySchema = z.object({
  key: z.string().min(1).max(1024),
  file: safeFileName,
  size: z.number().int().nonnegative(),
  sha256: hex64,
  contentType: z.string().max(255),
});
export const objectIndexSchema = z.array(objectEntrySchema);
export type ObjectEntry = z.infer<typeof objectEntrySchema>;

export class BackupFormatError extends Error {
  override readonly name = 'BackupFormatError';
}

export async function readManifest(dir: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(join(dir, MANIFEST_FILE), 'utf8');
  } catch {
    throw new BackupFormatError(`No ${MANIFEST_FILE} in ${dir}: this is not a complete backup.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new BackupFormatError(`${MANIFEST_FILE} is not valid JSON.`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new BackupFormatError(
      `${MANIFEST_FILE} is not an Ultimate ERP backup manifest (or is from an unsupported format version).`,
    );
  }
  return parsed.data;
}

export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  manifestSchema.parse(manifest);
  await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
}
