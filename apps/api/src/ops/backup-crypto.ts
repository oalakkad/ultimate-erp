import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/**
 * Encryption of backup files (docs/operations.md §2). Every file is AES-256-GCM with its own
 * random IV; its logical name ("database", "object:<key>") is bound in as associated data, so
 * a file renamed or swapped with another does not open. Layout:
 *
 *   "UERPBK01" (8 bytes) | IV (12 bytes) | ciphertext | auth tag (16 bytes)
 *
 * The key comes from BACKUP_ENCRYPTION_KEY through scrypt with a random salt per backup.
 */
const MAGIC = Buffer.from('UERPBK01', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

/** scrypt cost: ~100 ms once per backup or restore, expensive for anyone guessing the key. */
export const KDF_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;

export class BackupIntegrityError extends Error {
  override readonly name = 'BackupIntegrityError';
}

export function newSalt(): string {
  return randomBytes(16).toString('base64');
}

export function deriveBackupKey(
  secret: string,
  salt: string,
  params: { N: number; r: number; p: number } = KDF_PARAMS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      secret,
      Buffer.from(salt, 'base64'),
      32,
      { ...params, maxmem: 256 * 1024 * 1024 },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

/** Proves the key is right before any big file is read (stored in the manifest; not secret). */
export function keyCheck(key: Buffer): string {
  return createHmac('sha256', key).update('ultimate-erp backup key check v1').digest('hex');
}

export function keyCheckMatches(key: Buffer, expected: string): boolean {
  const actual = Buffer.from(keyCheck(key), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/**
 * One-way fingerprint of an application secret (DATA_ENCRYPTION_KEY, AUTH_SECRET), so a restore
 * can warn that the server about to use the data has a different key. Reveals nothing about it.
 */
export function secretFingerprint(secret: string): string {
  return createHmac('sha256', secret)
    .update('ultimate-erp key fingerprint v1')
    .digest('hex')
    .slice(0, 16);
}

export interface WrittenFile {
  /** Size on disk (encrypted). */
  size: number;
  /** SHA-256 of the file on disk: detects damage without the key. */
  sha256: string;
  /** Size of the original content. */
  plainSize: number;
  /** SHA-256 of the original content. */
  plainSha256: string;
}

/** Encrypts everything `source` yields into `path`. */
export async function encryptToFile(
  source: AsyncIterable<Buffer | Uint8Array> | Iterable<Buffer | Uint8Array>,
  path: string,
  key: Buffer,
  aad: string,
): Promise<WrittenFile> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const onDisk = createHash('sha256');
  const plain = createHash('sha256');
  let size = 0;
  let plainSize = 0;

  async function* encrypted(): AsyncGenerator<Buffer> {
    const emit = (chunk: Buffer) => {
      onDisk.update(chunk);
      size += chunk.length;
      return chunk;
    };
    yield emit(Buffer.concat([MAGIC, iv]));
    for await (const raw of source) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      plain.update(chunk);
      plainSize += chunk.length;
      const out = cipher.update(chunk);
      if (out.length > 0) yield emit(out);
    }
    const last = cipher.final();
    if (last.length > 0) yield emit(last);
    yield emit(cipher.getAuthTag());
  }

  await pipeline(encrypted, createWriteStream(path, { mode: 0o600 }));
  return {
    size,
    sha256: onDisk.digest('hex'),
    plainSize,
    plainSha256: plain.digest('hex'),
  };
}

/** SHA-256 of a file as stored (no key needed). */
export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Decrypts `path` as a stream. The authentication tag is checked when the last chunk is read:
 * a consumer must treat the content as untrusted until the stream ends without an error.
 */
export async function* decryptFile(path: string, key: Buffer, aad: string): AsyncGenerator<Buffer> {
  const { size } = await stat(path);
  if (size < HEADER_BYTES + TAG_BYTES) throw new BackupIntegrityError(`${aad}: file is too short`);
  const handle = await open(path, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupIntegrityError(`${aad}: not an Ultimate ERP backup file`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  if (size > HEADER_BYTES + TAG_BYTES) {
    const body = createReadStream(path, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 });
    for await (const chunk of body as AsyncIterable<Buffer>) {
      const out = decipher.update(chunk);
      if (out.length > 0) yield out;
    }
  }
  let last: Buffer;
  try {
    last = decipher.final();
  } catch {
    throw new BackupIntegrityError(`${aad}: damaged, altered, or encrypted with another key`);
  }
  if (last.length > 0) yield last;
}

/** Decrypts a whole (small) file, e.g. the object index. */
export async function decryptToBuffer(path: string, key: Buffer, aad: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of decryptFile(path, key, aad)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Reads a whole decrypted stream, returning its size and SHA-256 (verification pass). */
export async function digestOf(
  source: AsyncIterable<Buffer>,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of source) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: hash.digest('hex') };
}
