# Operations runbook

How to run Ultimate ERP safely in production: backups, restores, keys, deployment. Written for the person on call, in the order you need it. Phase 15a (§1–4), 15b (§5) and 15d (§6–7).

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

## 5. Deployment and configuration

### Profiles
| Environment | How | Data |
|---|---|---|
| Development | `pnpm dev` (Docker services + API, worker, web dev server) | Fictional, local |
| Test | Testcontainers (each suite starts its own PostgreSQL, storage, Mailpit) | Created by each test |
| Staging | The production images and compose file with their own secrets and domain (e.g. `staging.erp.yourfirm.com`) | **Synthetic only** — never a copy of production data |
| Production | `infra/compose/compose.prod.example.yaml` + `prod.env` (from `prod.env.example`), or the same images on a container platform | Real |

### Production guard
With `NODE_ENV=production` the API and worker **refuse to start** (one line per problem, never the value) when: logs are pretty-printed or the profile is `dev`; public addresses (`APP_PUBLIC_URL`, `WEB_PUBLIC_URL`, `S3_PUBLIC_ENDPOINT`, CORS origins, breach-check API) are not https or point to localhost; `PLATFORM_BASE_DOMAIN` is localhost; the mail server or sender is localhost; `AUTH_SECRET` / `DATA_ENCRYPTION_KEY` look like examples (`change-me`, `replace-with…`, `local-dev…`), have too few different characters, or are equal; the database password is short or a placeholder; file storage is missing, its keys are placeholders, or there is no https download address. They also stop at start-up if the database login could bypass row-level security (superuser / BYPASSRLS / not `erp_app`). Role creation (`bootstrap`) refuses passwords still containing the template's placeholder.

Settings: an empty variable counts as unset; `NAME_FILE=/run/secrets/name` reads `NAME` from a file (Docker / Kubernetes secrets).

### Your HTTPS proxy
Put HTTPS in front of the `web` service (port 8080):
- Certificates and DNS for the main address **and** `*.<PLATFORM_BASE_DOMAIN>` (each company is a subdomain).
- Keep the original `Host` header, append the client to `X-Forwarded-For`, set `X-Forwarded-Proto: https`; allow uploads of 26 MB.
- Forward the files host (`S3_PUBLIC_ENDPOINT`, e.g. `files.erp.yourfirm.com`) to the `object-storage` service on port 9000, keeping `Host` (download links are signed for it).
- `TRUST_PROXY_HOPS` = number of proxies appending `X-Forwarded-For` in front of the API: the web container (1) + your HTTPS proxy (2). Wrong values put everyone into one rate-limit bucket or let people forge their address. Check after go-live: the audit log shows people's real addresses. Only the address follows the proxies — the company is always taken from `Host`, and the web container removes any `X-Forwarded-Host`.

### Upgrading
1. Make and verify a backup (§2).
2. Pull or build the new images, then `docker compose --env-file prod.env up -d`: `bootstrap` and `migrate` run first, then the new API, worker and web start.
3. Sign in and open a few screens. Database changes are backward-compatible (ADR-0007), so going back means starting the previous images; if a release notes say a change cannot be undone, the way back is the backup from step 1.

### Deployment verification (`pnpm deploy:verify`)
Builds both images and starts the real production compose file with freshly generated secrets, behind a test-only HTTPS proxy (`infra/compose/compose.verify.yaml`, throwaway certificates for `*.verify.test`) and a test mail server. It then checks the security headers of the app, its files and the API; that the third-party notices are served; that an unknown company address answers 404; runs the **whole first-day browser journey** (sign-up, two-factor, invitations, clients, a virus-scanned upload and its signed download, contracts, projects, tasks, time, leave, attendance, payroll, invoices, expenses, reports, audit, announcements); checks that the audit log records the browser's address and not a proxy's; and makes and verifies a backup with the server image's own tools. Everything is removed afterwards (`--keep` leaves it running, `--skip-build` reuses images). CI runs it on every push (`deploy` job). Last run 2026-10-31: passed in 2.4 minutes.

### Licences
`THIRD_PARTY_NOTICES.txt` (all production dependencies and the fonts, with their licence texts) is generated by `pnpm notices`, checked by `pnpm security`, served at `/third-party-notices.txt` and included in the server image.

## 6. Monitoring
| Signal | Where | Turn on |
|---|---|---|
| Health | `GET /api/v1/health` (database up, latency) and `/api/v1/health/live`; container health checks | Always on |
| Logs | JSON on stdout (pino), personal data redacted, each line with the request ID; slow requests (> `SLOW_REQUEST_MS`, default 1 s) logged as warnings | Always on — collect stdout with your platform |
| Error reports | Sentry protocol (Sentry or self-hosted GlitchTip), scrubbed; includes jobs that failed for good | `SENTRY_DSN` |
| Traces | OpenTelemetry OTLP/HTTP: every request and its database queries (SQL with placeholders only; no query strings, addresses or user agents) | `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. `http://otel-collector:4318`) |
| Background jobs | Failed and retried jobs in the `pgboss` schema; final failures reported as errors | — |

Suggested alerts (in your monitoring tool): health not 200 for 2 minutes; error reports > 10 in 5 minutes; slow-request warnings > 20 in 5 minutes; the nightly backup or weekly `verify` exiting non-zero; disk over 80 %.

## 7. Incident response
For a suspected security incident or data breach. Kuwait: notify the regulator (CITRA) within **24 hours** of becoming aware of a breach of personal data — confirm the exact duty with legal counsel before go-live (compliance.md ⚖️).

1. **Contain (first hour).** Revoke the attacker's access: remove the affected member from the company (Members screen) — that blocks all access to the company at once; the person can be invited back later; if secrets may be exposed, rotate them — `AUTH_SECRET` (signs everyone out), database passwords (`bootstrap` applies them), storage keys. Keep the server running unless it is actively being damaged: logs and the audit trail are evidence.
2. **Preserve evidence.** Make a backup (§2) right away and copy the logs. The audit log (Audit screen, CSV export) shows who did what, when and from which address, per company; it cannot be altered by the application.
3. **Assess.** Which companies, which people, which kinds of data (employees' private details are encrypted with `DATA_ENCRYPTION_KEY` — were the database *and* that key exposed?). Use the audit search by actor, action, address and dates.
4. **Notify.** The regulator within 24 hours where required; affected companies (each company is the controller of its data) with what happened, what data, what you did, what they should do; individuals where required. Record every notification and its time.
5. **Recover.** Fix the cause; if data was damaged, restore into a new database (§3, with `--sign-out-everyone`) and tell users the restored point in time.
6. **Learn.** Write a short report (timeline, cause, fixes) within two weeks; add a test that would have caught it.

**Tabletop walk-through, 2026-10-31** (scenario: an employee's password is phished and used to export the client list): containment by removing the member (Members screen) — available, immediate; evidence: audit search for `clients.client.exported` by that actor shows time, address and request ID — available; assessment: export contents = the client list visible to that role — determinable from the permission matrix; notification: steps above; gap found: an admin cannot end another person's sessions without removing them from the company (only the person can, on their account) — workaround: remove and later re-invite. Recorded as a follow-up.

## 8. The mobile app (Phase 16)

The app in `apps/mobile` is an Expo (React Native) project. It is a second client of the same API: it needs no server of its own.

### What the server needs
- Nothing new for a deployed installation: the app talks to the main address (`APP_PUBLIC_URL` / `WEB_PUBLIC_URL`, e.g. `https://erp.yourfirm.com`) and to the company addresses the server hands it (`https://acme.erp.yourfirm.com`), both already served by the web container's nginx. CORS is not involved on a phone.
- The address is configurable in the app itself (sign-in screen → "Server address"), so one build serves SaaS and on-premises customers; a company can also bake its address in with `EXPO_PUBLIC_API_URL` at build time.

### Development
- Browser preview: `pnpm --filter @ultimate-erp/mobile web` (port 8081) with `pnpm dev` running; the API must list `http://localhost:8081` in `CORS_ORIGINS` (the default `.env.example` does). The preview is for development and tests only, not a product surface.
- A phone with Expo Go on the same Wi-Fi: run **`pnpm dev:phone`** once (`scripts/phone-dev.mjs`). A phone cannot resolve `*.localhost`, so the script gives the laptop a phone-reachable name through nip.io (`acme.192-168-1-20.nip.io` → 192.168.1.20): it sets `PLATFORM_BASE_DOMAIN`, `WEB_PUBLIC_URL` and `CORS_ORIGINS` in `.env`, and adds that address for every existing company (`tenant_domains`, development superuser). Then restart `pnpm dev`, start Metro with `EXPO_PUBLIC_API_URL=http://192-168-1-20.nip.io:5173` and `pnpm --filter @ultimate-erp/mobile start`, and open the project in Expo Go (scan the QR, or "Enter URL manually" → `exp://192.168.1.20:8081`). The Vite dev server listens on the network and accepts `.nip.io` hosts for this. `pnpm dev:phone --off` returns to localhost. If the names do not resolve on the phone, the router blocks DNS answers pointing at private addresses ("DNS rebinding protection") — use a phone hotspot or turn it off.
- Camera scanning needs a real device (Expo Go or a development build); the browser preview offers a text field for the code instead.

### Building for the stores (owner steps — need accounts)
1. Create an Expo account and run `npx eas login` / `npx eas build:configure` in `apps/mobile` (adds `eas.json`).
2. iOS: an Apple Developer account (USD 99/year); Android: a Google Play developer account (one-off USD 25). EAS Build manages the signing keys.
3. `npx eas build --platform all --profile production`, then `npx eas submit`. Set `EXPO_PUBLIC_API_URL` in the build profile to the installation's main address, or leave it and let people type the address.
4. Replace the placeholder icon and splash (`apps/mobile/assets/`) with the firm's artwork before the first store submission.
5. Push notifications are deferred: when wanted, add `expo-notifications`, register device tokens on the server (a new table) and send from the worker — the in-app notification list and badge already exist.
