import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BackupIntegrityError,
  decryptToBuffer,
  deriveBackupKey,
  encryptToFile,
  keyCheck,
  keyCheckMatches,
  newSalt,
  secretFingerprint,
} from './backup-crypto.js';
import { manifestSchema } from './backup-manifest.js';
import { selectForDeletion } from './prune.js';
import { describeFailure, parseArgs } from './commands.js';

let dir: string;
let key: Buffer;
const salt = newSalt();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uerp-crypto-'));
  key = await deriveBackupKey('a-test-backup-key-that-is-long-enough-0123', salt);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('backup encryption', () => {
  it('round-trips content and reports sizes and checksums', async () => {
    const path = join(dir, 'a.enc');
    const content = Buffer.from('payroll for October: 1,250.000 KWD');
    const written = await encryptToFile(
      [content.subarray(0, 10), content.subarray(10)],
      path,
      key,
      'database',
    );
    expect(written.plainSize).toBe(content.length);
    expect(written.size).toBe(content.length + 8 + 12 + 16);
    expect(await decryptToBuffer(path, key, 'database')).toEqual(content);
    // Encrypted at rest: the content does not appear in the file.
    expect((await readFile(path)).includes(Buffer.from('payroll'))).toBe(false);
  });

  it('handles empty content', async () => {
    const path = join(dir, 'empty.enc');
    await encryptToFile([], path, key, 'objects-index');
    expect((await decryptToBuffer(path, key, 'objects-index')).length).toBe(0);
  });

  it('rejects a wrong key, a renamed file and any changed byte', async () => {
    const path = join(dir, 'b.enc');
    await encryptToFile([Buffer.from('secret civil ID 285010112345')], path, key, 'object:x');
    const otherKey = await deriveBackupKey('another-backup-key-that-is-long-enough-99', salt);
    await expect(decryptToBuffer(path, otherKey, 'object:x')).rejects.toBeInstanceOf(
      BackupIntegrityError,
    );
    // Same bytes presented as another file (associated data differs).
    await expect(decryptToBuffer(path, key, 'object:y')).rejects.toBeInstanceOf(
      BackupIntegrityError,
    );
    const bytes = await readFile(path);
    bytes[30] = (bytes[30] ?? 0) ^ 0xff;
    await writeFile(path, bytes);
    await expect(decryptToBuffer(path, key, 'object:x')).rejects.toBeInstanceOf(
      BackupIntegrityError,
    );
  });

  it('rejects files that are not backups', async () => {
    const path = join(dir, 'c.enc');
    await writeFile(path, Buffer.alloc(64, 1));
    await expect(decryptToBuffer(path, key, 'database')).rejects.toThrow(/not an Ultimate ERP/);
  });

  it('checks the key without decrypting anything', async () => {
    const check = keyCheck(key);
    expect(keyCheckMatches(key, check)).toBe(true);
    const otherKey = await deriveBackupKey('another-backup-key-that-is-long-enough-99', salt);
    expect(keyCheckMatches(otherKey, check)).toBe(false);
  });

  it('fingerprints secrets one-way and consistently', () => {
    expect(secretFingerprint('x'.repeat(40))).toBe(secretFingerprint('x'.repeat(40)));
    expect(secretFingerprint('x'.repeat(40))).not.toBe(secretFingerprint('y'.repeat(40)));
    expect(secretFingerprint('x'.repeat(40))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('backup manifest', () => {
  const valid = {
    format: 'ultimate-erp-backup',
    formatVersion: 1,
    createdAt: '2026-10-31T12:00:00.000Z',
    appVersion: '0.0.0',
    encryption: {
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
      N: 32768,
      r: 8,
      p: 1,
      keyCheck: 'a'.repeat(64),
    },
    secretFingerprints: {},
    database: {
      serverVersion: '18.6',
      dumpFile: 'database.dump.enc',
      migrations: { count: 0, hashes: [], latest: 0 },
      tables: {},
      forcedRls: [],
    },
    objects: { included: false, reason: 'none' },
    files: [{ name: 'database.dump.enc', size: 1, sha256: 'b'.repeat(64) }],
    warnings: [],
  };

  it('accepts a valid manifest', () => {
    expect(manifestSchema.safeParse(valid).success).toBe(true);
  });

  it.each(['../etc/passwd', '/abs.enc', 'objects/../../x.enc', 'C:\\x.enc', 'objects/abc.enc'])(
    'refuses a file name that could point outside the backup: %s',
    (name) => {
      const tampered = { ...valid, files: [{ name, size: 1, sha256: 'b'.repeat(64) }] };
      expect(manifestSchema.safeParse(tampered).success).toBe(false);
    },
  );
});

describe('retention', () => {
  const day = (iso: string) => ({ name: iso, createdAt: new Date(`${iso}T02:00:00Z`) });

  it('keeps the newest N plus the newest of each recent month', () => {
    const backups = [
      day('2026-08-03'),
      day('2026-08-20'),
      day('2026-09-10'),
      day('2026-09-25'),
      day('2026-10-01'),
      day('2026-10-30'),
      day('2026-10-31'),
    ];
    const { keep, remove } = selectForDeletion(backups, { keepLatest: 2, keepMonthly: 2 });
    // Newest two (Oct 31, Oct 30) + newest of October (already kept) and September (Sep 25).
    expect(keep.map((b) => b.name)).toEqual(['2026-10-31', '2026-10-30', '2026-09-25']);
    expect(remove.map((b) => b.name)).toEqual([
      '2026-10-01',
      '2026-09-10',
      '2026-08-20',
      '2026-08-03',
    ]);
  });

  it('never deletes when there are fewer backups than the policy keeps', () => {
    const { remove } = selectForDeletion([day('2026-10-31')], { keepLatest: 30, keepMonthly: 12 });
    expect(remove).toEqual([]);
  });
});

describe('backup command line', () => {
  it('reads commands, folders and options', () => {
    const args = parseArgs(['restore', 'backups/uerp-1', '--dev', '--database', 'erp_restore']);
    expect(args.command).toBe('restore');
    expect(args.positional).toEqual(['backups/uerp-1']);
    expect(args.flags.get('dev')).toBe(true);
    expect(args.flags.get('database')).toBe('erp_restore');
  });

  it('rejects unknown options and missing values', () => {
    expect(() => parseArgs(['backup', '--force'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['backup', '--dir'])).toThrow(/needs a value/);
  });

  it('explains known problems in one sentence, without a stack trace', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(describeFailure(refused)).toEqual({
      message: expect.stringContaining('Cannot reach the database') as unknown,
      known: true,
    });
    expect(describeFailure(new Error('bug')).known).toBe(false);
  });
});
