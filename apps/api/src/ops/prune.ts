import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readManifest } from './backup-manifest.js';

export interface RetentionPolicy {
  /** The newest N backups are always kept. */
  keepLatest: number;
  /** Plus the newest backup of each of the last N calendar months (UTC). */
  keepMonthly: number;
}

/** Default retention: 30 daily + 12 monthly (docs/hardening.md section 3, decision 2). */
export const DEFAULT_RETENTION: RetentionPolicy = { keepLatest: 30, keepMonthly: 12 };

export interface BackupRef {
  name: string;
  createdAt: Date;
}

/** Which backups to keep and which to delete. Pure: easy to test, nothing touched. */
export function selectForDeletion(
  backups: readonly BackupRef[],
  policy: RetentionPolicy,
): { keep: BackupRef[]; remove: BackupRef[] } {
  const newestFirst = [...backups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = new Set<BackupRef>(newestFirst.slice(0, policy.keepLatest));
  const months = new Set<string>();
  for (const backup of newestFirst) {
    const month = backup.createdAt.toISOString().slice(0, 7);
    if (months.has(month)) continue;
    if (months.size >= policy.keepMonthly) break;
    months.add(month);
    keep.add(backup);
  }
  return {
    keep: newestFirst.filter((b) => keep.has(b)),
    remove: newestFirst.filter((b) => !keep.has(b)),
  };
}

/**
 * Deletes old backups in `dir` by the policy. Only folders with a valid Ultimate ERP manifest
 * are considered; anything else (including unfinished `.partial` folders) is left alone.
 */
export async function pruneBackups(
  dir: string,
  policy: RetentionPolicy,
  log: (line: string) => void = () => undefined,
): Promise<{ kept: number; removed: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const backups: BackupRef[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^uerp-\d{8}T\d{6}Z$/.test(entry.name)) continue;
    try {
      const manifest = await readManifest(join(dir, entry.name));
      backups.push({ name: entry.name, createdAt: new Date(manifest.createdAt) });
    } catch {
      log(`Skipping ${entry.name}: no valid manifest.`);
    }
  }
  const { keep, remove } = selectForDeletion(backups, policy);
  for (const backup of remove) {
    await rm(join(dir, backup.name), { recursive: true, force: true });
    log(`Deleted old backup ${backup.name}.`);
  }
  return { kept: keep.length, removed: remove.map((b) => b.name) };
}
