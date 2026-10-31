# Operations runbook

How to run Ultimate ERP safely in production: backups, restores, keys. Written for the person on call, in the order you need it. Phase 15a; later sections are added by 15b–15d.

## 1. What must be protected

| Thing | Where it lives | In a backup? | If it is lost |
|---|---|---|---|
| Business data (companies, people, clients, projects, time, invoices, payroll, audit log, job queue) | PostgreSQL | **Yes** (`database.dump.enc`) | Restore from backup |
| Uploaded files (receipts, contracts, documents) | Object storage (S3 / RustFS) | **Yes** (`objects/`) — every file a record points to | Restore from backup |
| `DATA_ENCRYPTION_KEY` | Secret manager / `prod.env` | **No — keep it separately** | Employees' private details (civil ID, nationality, birth date, personal contacts, address, bank account / IBAN) can never be read again |
| `AUTH_SECRET` | Secret manager / `prod.env` | **No — keep it separately** | Everyone is signed out; two-factor secrets cannot be read (people set up two-factor again); emails still waiting to be sent cannot be opened and fail |
| `BACKUP_ENCRYPTION_KEY` | Secret manager / password vault | **No — must never sit next to the backups** | Backups made with it cannot be restored |
| Database passwords | `prod.env` | No | Set new ones; `bootstrap` applies them |

Rule: **three secrets, kept in two places, never in the same place as the backups**: `DATA_ENCRYPTION_KEY`, `AUTH_SECRET`, `BACKUP_ENCRYPTION_KEY`, each at least 32 random characters (64 recommended), all different. A backup records one-way fingerprints of the first two, so a restore can tell you if the server about to use the data has different keys.

## 2. Backups

### What a backup is
One folder, e.g. `backups/uerp-20261031T170358Z/`:

| File | Content |
|---|---|
| `manifest.json` | Readable table of contents: when, software version, database version, exact row count of every table, which tables have forced row-level security, list of files with sizes and checksums. No business data, no secrets. |
| `database.dump.enc` | The whole database (`pg_dump`, custom format), encrypted |
| `objects.json.enc` | Index of the stored files (their names inside storage), encrypted |
| `objects/<hash>.enc` | Each stored file, encrypted |

- **Consistent:** the row counts and the database dump come from the same moment (one database snapshot), so they must match exactly on restore.
- **Encrypted:** AES-256-GCM per file with a key derived from `BACKUP_ENCRYPTION_KEY` (scrypt). Any changed byte, wrong key, or file swapped for another is detected.
- **Least privilege:** made as `erp_migrator` (owns the tables; its explicit policy lets it read every row even under forced row-level security). No superuser needed. The backup refuses to run if any protected table lacks that policy, rather than silently missing rows.
- **Never half-written:** written to `<name>.partial` and renamed only when complete.

### Commands

| Where | Make a backup | Check a backup |
|---|---|---|
| Development | `pnpm backup` | `pnpm backup:verify backups/<name>` |
| On-premises (Docker Compose) | `docker compose --env-file prod.env --profile ops run --rm backup` | `docker compose --env-file prod.env --profile ops run --rm verify /backups/<name>` |
| Any server image | `node dist/ops/cli.js backup` | `node dist/ops/cli.js verify <folder>` |

Settings (environment variables, same names as the API): `DATABASE_MIGRATOR_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR` (default `backups`), `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` (without `S3_ENDPOINT`, files are skipped and the manifest says so), optionally `DATA_ENCRYPTION_KEY` and `AUTH_SECRET` (fingerprints only).

`verify` checks every file's size and checksum, the key, and decrypts everything; it never touches a database. The exit code is 0 only if all is well, so a scheduler can alert on failure.

### Schedule and retention (defaults, to confirm with each customer's contract)
- **On-premises:** nightly backup (cron / Task Scheduler running the command above), then copy `backups/` to storage in **another location** (another building or cloud bucket). The `backup` service prunes automatically: the 30 newest backups plus the newest of each of the last 12 months (`prune --keep-latest 30 --keep-monthly 12`). Recovery point: up to 24 hours of work.
- **SaaS:** the managed database's point-in-time recovery is the first line (recovery point ≤ 5 minutes); the same nightly logical backup runs as well, so a single company's data or a whole install can be rebuilt anywhere, and files are covered.
- **Recovery time target:** 4 hours from decision to working system.
- Run `verify` on the newest backup weekly, and a full restore drill (§4) every quarter.

Note: `pnpm backup` in development copies real development data (including test accounts); the `backups/` folder is git-ignored.

## 3. Restore

A restore goes **only into an empty database and an empty file bucket** — it never overwrites. Before writing anything it checks: every file, the key, that `DATA_ENCRYPTION_KEY` / `AUTH_SECRET` match the backup's, that this software version can read the backup (an older backup is upgraded automatically; a newer one is refused), and that the database and bucket are empty. After restoring it proves the result: exact row counts per table, the same tables under forced row-level security, every company table protected, the app role still unable to bypass security, and every file byte-for-byte.

### On-premises, after losing the server or the data
1. Install the same or a newer version (images `ultimate-erp-api`, `ultimate-erp-web`), with the **same** `prod.env` (same three secrets).
2. Start only the storage services, on fresh volumes:
   `docker compose --env-file prod.env up -d postgres object-storage`
   (Do **not** start the whole stack first: `migrate` would create empty tables and the restore would refuse.)
3. Copy the backup folder into `./backups/`, then check it:
   `docker compose --env-file prod.env --profile ops run --rm verify /backups/<name>`
4. Restore:
   `docker compose --env-file prod.env --profile ops run --rm restore /backups/<name>`
   Add `--sign-out-everyone` if restoring after a security incident (ends every session).
5. Start everything: `docker compose --env-file prod.env up -d`
6. Sign in, open a recent invoice and a stored file, and check the audit log shows the last activity you expect.

### Options
| Option | Use |
|---|---|
| `--sign-out-everyone` | End all sessions in the restored data (after an incident) |
| `--allow-key-mismatch` | Restore although `DATA_ENCRYPTION_KEY` / `AUTH_SECRET` differ — only if those keys are truly lost; encrypted fields and two-factor secrets will be unreadable |
| `--database <name>` | Create and use a side database on the same server (drills) |
| `--bucket <name>` | Use another bucket (drills) |

### Things to know
- Background jobs that were waiting at backup time (e.g. emails) are restored and will run; a few emails may be sent twice.
- Work done after the backup was made is not in it. Tell users which point in time was restored.
- If the restore stops with an error, the database is left empty (the load is one transaction): fix the cause and run it again. If it stops while copying files, empty the bucket and run it again.

## 4. Restore drills

- **Automated, on every test run:** `apps/api/test/backup.spec.ts` builds two companies through the real API (client, project, an issued invoice, an uploaded file), backs up, then restores into a brand-new PostgreSQL server and bucket and proves: same row counts, the issued invoice unchanged, forced row-level security on every company table, company B cannot see company A, files byte-identical, and a person can sign in to the restored system. It also proves the restore refuses a database with data, different application keys, and a non-empty bucket, and that damage, a wrong key, and a tampered manifest are detected.
- **Manual, every quarter (and before go-live):** on a copy of the environment or on development:
  1. `pnpm backup` and `pnpm backup:verify backups/<name>`
  2. `pnpm backup:restore backups/<name> --database erp_drill --bucket erp-drill`
  3. Note the time taken and the counts printed; compare with the target (4 hours).
  4. Remove the drill copy: `docker exec ultimate-erp-postgres-1 psql -U erp_dev -d erp -c "drop database erp_drill"` (and the `erp-drill` bucket in the storage console, http://localhost:9001).
- Last manual drill: 2026-10-31 on development data — 86 tables, 9,570 rows and 133 files restored, counts matched; a second restore into the same database was refused.