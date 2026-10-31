import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BackupIntegrityError,
  decryptFile,
  decryptToBuffer,
  deriveBackupKey,
  digestOf,
  fileSha256,
  keyCheckMatches,
} from './backup-crypto.js';
import {
  type Manifest,
  type ObjectEntry,
  objectIndexSchema,
  readManifest,
} from './backup-manifest.js';

export class BackupKeyError extends Error {
  override readonly name = 'BackupKeyError';
}

export interface VerifiedBackup {
  manifest: Manifest;
  key: Buffer;
  objects: ObjectEntry[];
}

/**
 * Checks a backup without restoring it (docs/operations.md section 2): every file is present
 * with the recorded size and checksum, the key is right, and every file decrypts and passes its
 * authentication tag. Run it after each backup and before every restore.
 */
export async function verifyBackup(
  dir: string,
  encryptionKey: string,
  log: (line: string) => void = () => undefined,
): Promise<VerifiedBackup> {
  const manifest = await readManifest(dir);

  // 1. Damage check (no key needed): sizes and checksums of the files as stored.
  for (const file of manifest.files) {
    const path = join(dir, file.name);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new BackupIntegrityError(`${file.name} is missing.`);
    }
    if (size !== file.size || (await fileSha256(path)) !== file.sha256) {
      throw new BackupIntegrityError(`${file.name} is damaged (size or checksum differs).`);
    }
  }
  log(`${manifest.files.length} files present and undamaged.`);

  // 2. Key check, then full decryption of every file (authentication tags).
  const { salt, N, r, p, keyCheck } = manifest.encryption;
  const key = await deriveBackupKey(encryptionKey, salt, { N, r, p });
  if (!keyCheckMatches(key, keyCheck)) {
    throw new BackupKeyError('BACKUP_ENCRYPTION_KEY is not the key this backup was made with.');
  }
  await digestOf(decryptFile(join(dir, manifest.database.dumpFile), key, 'database'));

  let objects: ObjectEntry[] = [];
  if (manifest.objects.included) {
    const raw = await decryptToBuffer(join(dir, manifest.objects.indexFile), key, 'objects-index');
    const parsed = objectIndexSchema.safeParse(JSON.parse(raw.toString('utf8')));
    if (!parsed.success) throw new BackupIntegrityError('The file index is not valid.');
    objects = parsed.data;
    if (objects.length !== manifest.objects.count) {
      throw new BackupIntegrityError('The file index does not match the manifest.');
    }
    const listed = new Set(manifest.files.map((f) => f.name));
    for (const entry of objects) {
      if (!listed.has(entry.file)) {
        throw new BackupIntegrityError(`The file index names ${entry.file}, which is not listed.`);
      }
      const digest = await digestOf(decryptFile(join(dir, entry.file), key, `object:${entry.key}`));
      if (digest.size !== entry.size || digest.sha256 !== entry.sha256) {
        throw new BackupIntegrityError(`A stored file (${entry.file}) does not match its index.`);
      }
    }
  }
  log('Every file decrypts and passes its integrity check.');
  return { manifest, key, objects };
}
