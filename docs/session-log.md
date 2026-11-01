# Session Log

Hand-off notes between working sessions. **Newest entry first.** Every session ends by adding an entry; every session starts by reading the newest entry, then `project-status.md` and `requirements-checklist.md`.

Each entry: date · what was done · state of the repo (commits, uncommitted work, running services) · verification results (real numbers) · decisions made · open items / waiting on owner · exact next step.

---

## 2026-11-01 — Session 9 (continued): Phase 17 — Platform console (founder) — built, tests green, docs pending

Owner asked for a founder-level module ("my account as founder, created once, sees all companies") and said "do finish it", then "save the progress, I will leave". State saved here; the module works and is verified; documentation hand-over is the remaining step.

### What was built (Phase 17, commit "Phase 17 (WIP): platform console")
- **Database** (`packages/db`): schema `platform.ts`; migration `0038_platform_tables` (`platform_operators`, `platform_audit_events` — global tables, reviewed in `isolation.spec.ts`) and `0039_platform_security` (RLS + grants: app may read operators and append audit, never grant; append-only triggers; **SECURITY DEFINER functions** `app.is_platform_operator`, `app.platform_companies`, `app.platform_overview`, `app.platform_set_company_status` — the only cross-company read path, directory facts only, each checks the operator itself).
- **API** (`apps/api/src/modules/platform/`): `PlatformGuard` (session → main address only → operator → two-factor on; everything else 404/403), `PlatformService` (calls the functions; never opens a company transaction; lint exception alongside identity), routes `GET /platform/me`, `/overview`, `/companies?search&status`, `/companies/:id`, `POST /companies/:id/status {status, reason}`, `GET /audit-events`. `/platform/*` excluded from tenant resolution (main address). **CLI** `founder <email> [--revoke]` (`ops/founder.ts`, migrator role) → root script **`pnpm platform:founder <email>`**; there is deliberately no API to grant it.
- **Web** (`apps/web/src/routes/platform.tsx`, route `/platform`): overview tiles, searchable company table (owners, people, pending invitations, last activity, created, status), suspend/reactivate dialog with a required reason, founder audit list; link on the Companies page for founders only. EN/AR (`ui.platform.*`).
- **Also this session (committed earlier):** sign-in redesign (web + app), `pnpm dev:phone` for iPhone testing.
- **Dev data:** migrations applied to the dev DB; **`omarakkad115@gmail.com` granted the console** — it will say "set up two-factor" until the owner turns two-factor on under My account (by design).

### Verification (really run)
- `apps/api/test/platform.spec.ts` **2 passed**: non-operator → 404 and `/platform/me` false; anonymous 401; app role cannot insert operators (42501); granted without two-factor → 403 MFA_REQUIRED; company host → 404; directory shows members/pending/owners/last activity and **no business data** (client name absent; founder gets 404 on `/clients` of a company); suspend → company host 404, gone from members' lists; reason required (422); reactivate restores; both actions in the platform audit with reason and actor; audit delete → 42501.
- `packages/db` 39 passed (new global tables registered). `apps/web/e2e/platform.spec.ts` **EN + AR passed** against the dev stack (founder granted through the real CLI; console opened from the Companies page; suspend/reactivate with reasons; axe clean on the page and the dialog; screenshots `e2e/screenshots/platform-{en,ar}.png`).
- `pnpm format:check` ✅, `pnpm lint` ✅, `pnpm typecheck` ✅ (10 packages). `pnpm test`: **451 of 452** — the one failure is `tasks.spec.ts` "lets a Manager allocate…" hitting the 30 s per-test limit under full parallel load (same as earlier today; passes alone and in an idle full API run). An attempt to give that test a 90 s budget was **not applied** (owner stopped the edit); decide: raise its timeout or leave as is.
- Not yet run after this phase: `pnpm security` (no new dependencies, so expected clean), the full `pnpm e2e:journey`.

### Still to do for the Phase 17 hand-over (next session)
1. Docs: `docs/modules/platform.md` (spec + results), `security.md` §2f (platform access path, R14 update), `permissions.md` (founder is not a company role), `api.md` endpoints, `operations.md` §9 (granting/revoking the founder), `testing.md`, `roadmap.md` (Phase 17), `requirements-checklist.md` (brief §486: deliberately designed, audited platform role), `project-status.md` (decisions: directory only, no support access, CLI-only grant, two-factor mandatory), README (`pnpm platform:founder`).
2. Decide on the `tasks.spec.ts` timeout; run `pnpm security`; then the final commit "Phase 17".
3. Owner: turn two-factor on for `omarakkad115@gmail.com` (web → My account) to open the console.

### Repo / machine state
- Committed as "Phase 17 (WIP): platform console". Not pushed.
- **`pnpm dev` and Metro are stopped** (stopped for the test run). To test the app on the iPhone again: `pnpm dev`, then in a second terminal `$env:EXPO_PUBLIC_API_URL='http://192-168-8-136.nip.io:5173'; pnpm --filter @ultimate-erp/mobile start` (QR in the terminal; Expo account `omar94alakkad` is logged in on the laptop). `.env` still points at the phone-friendly nip.io address (`pnpm dev:phone --off` to revert).

---
## 2026-11-01 — Session 9: Phase 16 (mobile app) built + committed — all phases of the brief done

Owner instruction at the start: "finish all left phases, do all without asking, all at once, I'm leaving home." The only phase left was 16 (React Native app); the open "GRC tooling" item is not a brief phase and is recorded as a decision (deferred until a pilot firm asks). Docker Desktop was off at the start and was started.

### Follow-up (same session): testing the app on the owner's iPhone
- Owner asked to use the app on the iPhone (as an app, not web). Built `pnpm dev:phone` (`scripts/phone-dev.mjs`): detects the LAN address, switches `.env` to a nip.io base domain (`192-168-8-136.nip.io`), adds that address for all 130 existing companies in `tenant_domains` (via psql in the dev container), prints the Expo Go steps; `--off` reverts. Vite now listens on the network and accepts `.nip.io` hosts (`vite.config.ts`).
- **Verified:** `acme.192-168-8-136.nip.io` resolves to the laptop; `http://acme.192-168-8-136.nip.io:5173/api/v1/tenant` returns the demo company through Vite → API; Metro serves the Expo manifest (SDK 58) and the **iOS bundle compiles (11 MB dev, 16 s)**; the firewall already allows node.exe inbound on the active (Public) profile. Not verified: an actual phone (none here).
- **Local state left running for the owner:** `pnpm dev` (hidden window, PID 15256) and Metro `expo start` (PID 10048, `EXPO_PUBLIC_API_URL=http://192-168-8-136.nip.io:5173`). **Local `.env` now points at nip.io** (`PLATFORM_BASE_DOMAIN`, `WEB_PUBLIC_URL`, `CORS_ORIGINS`); run `pnpm dev:phone --off` and restart `pnpm dev` to go back — note the browser journey (`pnpm e2e:journey`) expects the localhost settings.
- Committed ("Phone testing helper").
### Hand-over 16 (A–H)
- **A Built:** `apps/mobile` — an Expo SDK 58 / React Native 0.88 app: sign-in (server address configurable for on-prem), two-factor (authenticator or backup code, trust device), companies with the same one-time hand-off ticket as the web, tabs Home (today's attendance + check-in/out, timer, "needs you" list, my tasks, this week's hours, bell with unread dot, account), Attendance (events, web check-in, two-week history, correction requests), Tasks (mine, open/closed, detail with status moves from `nextStatuses`, timer, comments), My time (week, entries, add entry with duplicate confirmation, submit week, timer stop), Leave (balances, my requests with withdraw/cancel, apply with live preview, approvals of leave and attendance corrections for approvers), Scan (camera QR on devices; code field in the browser preview), Notifications (shared sentences, deep links into the app), Account (language with RTL, switch company, sign out). EN + AR, loading/empty/error/denied states everywhere. **Server:** one new middleware — `X-Auth-State` cookie-less session transport (the app holds the server's signed cookies as an opaque state in the secure store; the server returns the updated state instead of `Set-Cookie`; Origin check does not apply; CORS exposes the header). **Shared:** `notificationText()` moved into `packages/i18n` (the web bell now uses it). Spec: `docs/modules/mobile.md`.
- **B Files:** contracts `http.ts` (`AUTH_STATE_HEADER`, `AUTH_STATE_MAX_BYTES`); api `platform/request-context/header-session.middleware.ts` (+ spec), `origin-check.middleware.ts` (exemption), `bootstrap.ts`, `test/mobile-session.spec.ts`; i18n `notification-text.ts` (+ spec), `index.ts`, `package.json` (depends on contracts), catalogs `ui.mobile.*` EN/AR (+ `noEmployeeRecord`, `pendingTime`); web `components/notification-bell.tsx` (uses the shared helper), `playwright.mobile.config.ts`, `e2e/mobile-web.spec.ts`, `package.json` (`e2e:mobile`), `tsconfig.json`; mobile `package.json`, `app.json`, `babel.config.js`, `metro.config.js`, `tsconfig.json`, `vitest.config.ts`, `index.ts`, `assets/` (placeholder icon + splash), `src/core/` (app, i18n, session, navigation, routes), `src/lib/` (api, storage, device-storage, session-store, sessions-state, scan-link, errors, dates, config), `src/ui/` (theme, text, surfaces, controls, states), `src/screens/` (13 screens), `test/` (4 specs); root `package.json` (`e2e:mobile`), `eslint.config.js` (hook rules for mobile), `.env.example` (CORS 8081), `scripts/check-licenses.mjs` (reviewed exceptions, SPDX OR), `THIRD_PARTY_NOTICES.txt` (739 components), CI `journey` job (+ mobile smoke); docs mobile (new), api §2, architecture, security §2e, operations §8, testing, compliance §3, release-readiness addendum, roadmap, checklist, project-status, README.
- **C Architecture:** phone → main host (`/auth/*`, companies, hand-off) and → company host (everything else, company by Host as on the web). The app never decides a company by ID or a permission; it parses every answer with the contracts' schemas and hides what `/access/me` denies. Session state per host lives in Keychain/Keystore (`expo-secure-store`); the React side reads it through `useSyncExternalStore` so API clients always see the latest state.
- **D Security:** `security.md` §2e — same signed cookies, tamper = invalid session (tested), no ambient credential so no CSRF surface (tested both ways), malformed header → 400, sizes and character sets bounded, lifetimes unchanged (30 min idle / 12 h), sign-out ends the sessions on the server, nothing new stored server-side. A company that refuses the session (e.g. Owner without two-factor → `MFA_REQUIRED`) is not remembered and the person is told to set two-factor up on the web.
- **E Tests (all really run):** `pnpm check` → format ✅, lint ✅, typecheck ✅ (10 packages), tests **449** (api 310 = 302 + 4 middleware unit + 4 mobile-session integration; db 39; contracts 36; web 23; ui 16; i18n 12; mobile 13). `pnpm security` clean (licences 743 packages with 3 reviewed build-tool exceptions; notices regenerated; no leaks; 3 moderate advisories below the threshold — esbuild as before, plus glob/minimatch inside Expo's Metro config, build-time only). `pnpm e2e:mobile` **EN + AR passed** (≈30 s each) against the dev stack: API-created account and company → app sign-in → two-factor (waits for the next code window, replay protection is real) → company hand-off → Home → web check-in → Attendance event → Tasks empty state → Leave balances → Notifications → Account → sign out → reload stays signed out. `expo export --platform web` bundles 2,698 modules in ~15 s. Not run: native builds (no Android SDK / Xcode here; store builds are owner steps). Found and fixed on the way: the dev stack's `tsc --watch` and Turbo's build wrote `packages/contracts/dist` at the same time and Turbo cached an **empty `billing.js`** → 13 API failures that looked like product bugs; `turbo run build --force` for contracts/i18n refreshed the cache and the suite went green. Two 30-second timeouts (tasks, payroll) appeared once under full parallel load and pass alone and in the final full API run.
- **F Verify:** project-status "How to verify Phase 16".
- **G Open:** push notifications (needs an Expo/APNs/FCM account), store builds (Expo + Apple + Google accounts; replace the placeholder icon/splash), self-hosted fonts in the app, time approvals / expenses in the app (web only for now), web-preview-only camera fallback, the dev-watcher vs Turbo-build race when running `turbo run build` during `pnpm dev` (documented in testing.md; a `--force` rebuild fixes a poisoned cache).
- **Decisions:** project-status "Decisions 2026-11-01 (Phase 16)" incl. GRC tooling deferred until a pilot firm asks.
- **Repo state:** committed ("Phase 16"). Not pushed. **Local `.env` changed:** `CORS_ORIGINS` now also lists `http://localhost:8081` (the app's browser preview). `pnpm dev` was restarted by me and is running in a hidden window (API 3000, Vite 5173); the Expo preview server is not running. Docker Desktop running.
- **H Next:** nothing left in the brief's phases. Owner steps: review the reviewable decisions, try the app (`pnpm --filter @ultimate-erp/mobile web`, or Expo Go on a phone per operations.md §8), decide on store builds / push, legal verification of the flagged rules, deployment account/domain/SMTP, pilot firm, GRC tooling.

---
## 2026-10-31 — Session 8 (continued): Phase 15d — Phase 15 complete

### Hand-over 15d (A–H)
- **A Built:** OpenTelemetry traces (`apps/api/src/telemetry.ts`, preloaded with `--import` in the image, worker and start scripts; off unless `OTEL_EXPORTER_OTLP_ENDPOINT`; query strings, client addresses and user agents removed; SQL with placeholders only) — lean set (sdk-trace, OTLP/HTTP exporter, http + pg instrumentation; sdk-node dropped for its large tree); security review R1–R15 with evidence (`security.md` §2d); monitoring and incident runbook with a tabletop walk-through (`operations.md` §6–7); production readiness assessment and owner go-live checklist (`release-readiness.md`).
- **B Files:** api `src/telemetry.ts`, `test/telemetry.spec.ts`, `package.json` (OpenTelemetry deps, start scripts); infra api Dockerfile CMD, prod compose (worker command, `OTEL_EXPORTER_OTLP_ENDPOINT`); `THIRD_PARTY_NOTICES.txt` regenerated; docs security, operations, release-readiness (new), hardening, roadmap, checklist, project-status, README.
- **E Tests:** format, lint, typecheck ✅; API **302** passed (incl. telemetry: the built API sends an HTTP span and a PostgreSQL span to a local OTLP receiver, with no email from the query string); other packages unchanged and green in the previous full run (db 39, contracts 36, web 23, ui 16, i18n 10 → 426 total); `pnpm security` clean (licences incl. OpenTelemetry, notices current).
- **G Open:** tabletop gap — an admin cannot end another person's sessions without removing them (follow-up); owner go-live checklist in `release-readiness.md`. The owner tried sign-up: confirmation emails go to the local Mailpit inbox (http://localhost:8025), not Gmail — explained; real SMTP needs an app password in `.env` if wanted.
- **Repo state:** committed ("Phase 15d"). Not pushed. `pnpm dev` running.
- **H Next:** Phase 16 — React Native app (plan first: Expo, shared contracts, sign-in with two-factor and company hand-off, attendance scan, notifications, tasks, time, leave; EN/AR RTL).

---
## 2026-10-31 — Session 8 (continued): Phase 15c (performance) built + committed

### Hand-over 15c (A–H)
- **A Built:** `pnpm perf` — seeds one company at the architecture target (500 people, 5,000 projects, 2,000,000 time entries, 10,000 invoices, 200,000 audit events) through real constraints, runs the built API + worker as separate processes, and measures p95 for 27 scenarios (owner, employee, reports, writes) with a closed-loop load generator; slowest statements from `pg_stat_statements`. Results and targets in `docs/performance.md`.
- **Fixed by measurement:** tasks report 64 s → ~1.5 s, utilization 18.7 s (failing) → ~0.8 s, timesheets 6.2 s (failing) → ~1.7 s, projects 7.8 s → ~1.3 s (all: sums in SQL instead of Node), receivables aging 1.8 s → 178 ms and dashboard 1.4 s → 482 ms (balances in SQL, partial index `0037` for submitted time used via a literal), `anyUuid()` single-array parameter for long ID lists, company-wide reports skip ID lists. Web: route-level code splitting, main JS 1.23 MB → 283 kB (first load 234 kB gzip).
- **B Files:** api `test/perf/` (volume-seed, load, perf.perf), `vitest.perf.config.ts`, `platform/database/sql-helpers.ts`, reports / billing / dashboard / time services; db `schema/time.ts`, migration `0037_perf_indexes.sql`, `testing/index.ts` (server settings); web `app/router.tsx`, `vite.config.ts`; docs performance (new), hardening, testing, README, checklist, roadmap, project-status.
- **E Tests:** `pnpm check` **425** passed; `pnpm security` clean; billing/reports/time/access suites re-run after each change; last `pnpm perf`: all lists, employee screens and writes within target (47–270 ms), dashboard 482 ms, reports 0.06–1.74 s — targets recorded as decisions (screens 300 ms, dashboard 500 ms, full-year reports 2 s, writes 500 ms). The laptop's load makes runs vary up to 2×.
- **G Open:** pre-computed daily totals if customers need sub-second yearly reports; PostgreSQL tuning on real hardware.
- **Repo state:** committed ("Phase 15c"). Not pushed.
- **H Next:** 15d — security review, accessibility sweep, monitoring (OpenTelemetry), incident runbook, readiness report. Then Phase 16 (React Native, estimated 5–8 hours).

---
## 2026-10-31 — Session 8 (continued): Phase 15b (production configuration & deployment validation) built + committed

### Hand-over 15b (A–H)
- **A Built:** production guard (API and worker refuse unsafe settings; fail fast on an unsafe database role), `NAME_FILE` secrets, empty = unset, trusted-proxy client addresses (`TRUST_PROXY_HOPS`), per-person limits on exports / uploads / report runs, nginx security headers on every response + HSTS, `prod.env.example`, `THIRD_PARTY_NOTICES.txt` (generated, checked, shipped in both images), and **`pnpm deploy:verify`**: builds both images, starts the real production compose file behind HTTPS with fresh secrets, checks headers, runs the full EN browser journey (now including a signed file download), checks client addresses through two proxies and a backup inside the image. CI `deploy` job replaces `images`.
- **Defects found by the deployment test and fixed** (`security.md` §2c): (1) client IP was always nginx's → everyone shared one rate-limit bucket; (2) nginx dropped the port from Host → every form refused as cross-site on non-standard ports; (3) the app's pages lacked Referrer-/Permissions-Policy and HSTS (nginx header inheritance); (4) the example on-prem compose could not start at all (empty `SENTRY_DSN` = invalid URL); (5) **a second pooled connection inside company transactions** (account-name lookups in ~30 places) → under concurrency the pool ran dry: 2 s stalls and 500s (this is what made the dev journey fail at the expense claim). Fixed with an ambient transaction for read-only identity lookups; a probe run of the whole API suite (nested `withTenant` / rate limiter inside a transaction made to throw) found no other nested connection use; mutation check: without the fix 20 parallel requests on a 2-connection pool all fail with 500, with it all 200. Also: a small web bug (`replace(/W/g…)` instead of `\W`).
- **B Files:** api `platform/config/config.ts` (`productionIssues`, `withFileValues`, `withoutEmptyValues`, `TRUST_PROXY_HOPS`), `config.spec.ts`, `platform/request-context/client-ip.ts` (+ spec), `bootstrap.ts`, `main.ts`, `worker.ts`, `platform/rate-limit/route-limit.ts`, `app.module.ts`, `@Limit` on 4 export routes / report run / upload, `platform/database/ambient-transaction.ts`, `tenant-database.ts`, `modules/identity/identity.service.ts` + `user-directory.ts`, `modules/tenancy/tenant-resolution.middleware.ts` (comment), `ops/commands.ts`, `test/hardening.spec.ts` (new), `test/support/config.ts` (`productionTestConfig`), `test/openapi.spec.ts`; db `admin.ts` (placeholder passwords refused); web `routes/clients/tabs.tsx`, `playwright.config.ts` (`deployed` project, dev expect 15 s), `e2e/journey.spec.ts` (configurable addresses, download step, 8 min limit), `e2e/support/dev-stack.ts`; infra `docker/nginx.conf`, `docker/security-headers.conf` (new), both Dockerfiles, `compose/compose.prod.example.yaml` (TRUST_PROXY_HOPS, ClamAV healthcheck), `compose/compose.verify.yaml` + `verify.Caddyfile` (test-only), `compose/prod.env.example`; `.dockerignore`; scripts `deploy-verify.mjs`, `third-party-notices.mjs`; `THIRD_PARTY_NOTICES.txt`; `package.json` (`deploy:verify`, `notices`, `notices:check` in `security`); CI; docs operations §5, security §2c, compliance, checklist, testing, README, hardening, roadmap, project-status.
- **C Architecture:** browser → HTTPS proxy (appends X-Forwarded-For) → web nginx (keeps Host with port, strips X-Forwarded-Host, appends X-Forwarded-For, adds headers) → API (`clientIp` = N hops from the right; company from Host only). Inside `withTenant` the transaction is ambient (AsyncLocalStorage, marked inactive when the callback ends) so read-only global lookups reuse its connection.
- **D Security:** see A and `security.md` §2c; HSTS includes subdomains; limits are per person (company + membership).
- **E Tests:** `pnpm check`: format, lint, typecheck ✅; tests **425** (api 301, db 39, contracts 36, web 23, ui 16, i18n 10) — one production-config test needed a realistic database password after the stricter guard, then green; `pnpm security` clean (same moderate advisory; notices up to date; gitleaks flagged the made-up production test secrets → inline `gitleaks:allow`); `pnpm deploy:verify` **passed in 2.5 min** (15 header checks, EN journey 2.1 min, client IPs, backup); `pnpm e2e:journey` EN + AR **passed** (5.0 min each through the dev server). Restarting the owner's long-running `pnpm dev` (Vite up since 13:55, very slow) was not allowed by the permission system; instead the dev journey project waits up to 15 s per assertion.
- **F Verify:** project-status "How to verify Phase 15b".
- **G Open:** HSTS preload (domain decision), real cloud deployment (needs account, domain, SMTP), Vite dev server restart recommended (slow after hours of reloads).
- **Repo state:** committed ("Phase 15b"). Not pushed. Docker images `ultimate-erp-api:latest` / `ultimate-erp-web:latest` built locally; the verify stack was removed. `pnpm dev` still running (old Vite process).
- **H Next:** 15c — performance (volume seed at the architecture target, load test, measured fixes, route-level code splitting).

---
## 2026-10-31 — Session 8: Phase 15 plan; Phase 15a (backup, restore, clean install) built + committed

- Session started without the previous conversation; state taken from git and this log. The owner's sales-deck PDFs in `docs/sales/` are **not to be committed** (owner: "dont commit that"); excluded locally in `.git/info/exclude`.
- Phase 15 plan written: `docs/hardening.md` (15a–15d, decisions §3, owner go-live needs §4); decisions recorded in project-status.

### Hand-over 15a (A–H)
- **A Built:** encrypted backups of the database and every stored file a record points to (one database snapshot for the dump and the exact row counts), `verify` (sizes, checksums, key, full decryption), `restore` only into an empty database and empty bucket (checks everything first; afterwards proves row counts, forced RLS, safe app role, byte-identical files), retention `prune` (30 latest + 12 monthly), dev scripts, server-image tools, on-prem compose `bootstrap` (fixes the missing role creation) and `backup` / `verify` / `restore` services, runbook `docs/operations.md`.
- **B Files:** api `src/ops/` (`backup-crypto.ts` file format AES-256-GCM + scrypt, `pg-tools.ts` pg_dump/pg_restore locally or via `docker exec`, `backup-storage.ts`, `database-inventory.ts` catalogue checks + counts + migration level, `backup-manifest.ts` validated manifest, `backup.ts`, `verify.ts`, `restore.ts`, `prune.ts`, `commands.ts`, `cli.ts`, `ops.spec.ts`), `test/backup.spec.ts`, `test/support/people.ts` (`attach` for uploads); db `testing/index.ts` (`startEmptyTestDatabase`, `containerId`); `infra/docker/api.Dockerfile` (+ `postgresql18-client`), `infra/compose/compose.prod.example.yaml`; root `package.json` (`backup`, `backup:verify`, `backup:restore`, `backup:prune`, `ops:build`); `.env.example` (`BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR`), `.gitignore` + `.gitleaks.toml` (`backups/`); docs operations (new), hardening (new), database, testing, compliance, checklist, README, ADR-0007, roadmap, project-status.
- **C Architecture:** migrator connection → `BEGIN REPEATABLE READ` → `pg_export_snapshot()` → row counts + `pg_dump --snapshot --enable-row-security` (stdout → AES-GCM file) → file records → objects copied and encrypted → `manifest.json` → rename `.partial` to final. Restore: verify → key fingerprints → migration compatibility → empty database + bucket → `bootstrapDatabase` → decrypting stream → `pg_restore --single-transaction --exit-on-error --no-owner` → counts / forced RLS → `runMigrations` (upgrades older backups) → app-role check → objects with checksum check.
- **D Security:** backup as `erp_migrator`, no superuser; refuses if any RLS table hides rows from it (otherwise rows could be silently missing). Confirmed by experiment that pg_dump without `--enable-row-security` fails on our FORCE-RLS tables. Every file encrypted, logical name bound in (no swapping), tamper and wrong-key detection, manifest file names validated (no path traversal), no plaintext dump ever written to disk, passwords passed to tools through the environment (never in a process list). Restore never overwrites and checks the application keys before writing anything.
- **E Tests:** `pnpm check` **408** passed (api 284 = 261 + 17 ops unit + 6 restore drill; db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm security` clean (same moderate advisory; gitleaks first flagged the manifest `keyCheck` in the git-ignored `backups/` folder → allow-listed with reason). Manual drill on dev data: 86 tables, 9,570 rows, 133 files backed up, verified, restored into `erp_drill` / `erp-drill` with matching counts; second restore refused; drill database and bucket removed. Browser tests not affected (no UI change).
- **F Verify:** project-status "How to verify Phase 15a".
- **G Open:** the server image with `postgresql18-client` is built and exercised in 15b's deployment test (the package was verified on the same `node:24.22.2-alpine` base: pg_dump 18.6); scheduled backups are the host's job (cron); off-site copy is the operator's.
- **Windows notes:** the Bash tool mangles some heredocs (`\\` → `\`, and long files fail with a quote error) — write long files with PowerShell `[IO.File]::WriteAllText` (UTF-8 without BOM). Renaming a just-written folder can fail with EPERM (antivirus); the backup retries.
- **Repo state:** committed ("Phase 15a"). Not pushed. Docker dev services running; `pnpm dev` not checked this session. Local `.env` gained `BACKUP_ENCRYPTION_KEY`, `BACKUP_DIR` (appended by init-env). A dev backup sits in `backups/` (git-ignored).
- **H Next:** 15b — production configuration guard, deployment smoke test with built images on the production compose, staging profile, headers and rate-limit review, THIRD_PARTY_NOTICES.

---
## 2026-10-31 — Session 7 (continued): Phase 14 (Reports, audit search & analytics) built + committed

### Hand-over 14 (A–H)
- **A Built:** 13 reports (clients, projects & budgets, profitability, utilization, task performance, timesheets, attendance, leave, payroll, invoices, payments, receivables aging, revenue by month) with written definitions, period/client/project filters, totals, Arabic names, CSV export; audit log search by area/action, actor, target, request reference and dates, with an Audit log screen and CSV export. See `docs/modules/reports.md` §11.
- **B Files:** contracts `reports.ts` (new), `access.ts` (audit events carry `actorName`); api `modules/reports/` (service with the catalogue `REPORTS` and one computation per report, controller), `modules/access/audit-events.service.ts` (filters, names, export) and controller routes, app module, `test/reports.spec.ts`; web `routes/reports.tsx` (catalogue + generic report page), `routes/audit.tsx`, router, navigation group "Insights", palette; i18n EN/AR (report names, summaries, definitions, columns, values, audit areas); journey Phase 14 steps.
- **C Architecture:** catalogue entry (permissions, optional scope, filters, columns, totals) → `reach` decides company / scoped / none → computation inside the company's own transaction (forced RLS) over the module tables → strings for money and hours (exact fils / hundredths) → web formats per column type in the reader's language. Attendance reuses the attendance module's day rules (`daysOf`).
- **D Security:** every report re-checks permission on the server; scoped reports limit rows to the team (`teamScopeOf`) or managed projects; RLS keeps other companies out; CSV cells are formula-safe; exports audited (`reports.report.exported`, `audit.exported`); payroll export needs `exports.confidential`; audit filters validated (action prefix letters only, LIKE wildcards escaped).
- **E Tests:** `pnpm check` **385** passed (api 261, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e` 6 passed; `pnpm e2e:journey` 2 passed (5.3 min) after targeting the report link by its summary (the sidebar also has "Clients"); `pnpm security` clean (same moderate advisory).
- **F Verify:** project-status "How to verify Phase 14".
- **G Open:** saved / scheduled / emailed reports, charts on more reports, staff cost in profitability once payroll rules are verified.
- **Repo state:** committed ("Phase 14"); `pnpm dev` running. Not pushed.
- **H Next:** Phase 15 Hardening & release prep.

---

## 2026-10-31 — Session 7 (continued): design v0.3 — motion and an "AI-look" audit

- **Owner request:** more animation and polish (reference: getlayers.ai templates), then: "be an auditor — does this design scream AI or look professional?"
- **Audit verdict (screenshots, both languages):** the old dashboard read as generated (9 identical cards of two pastel tiles mostly showing 0, decorative colour, headers repeating their title, 17 flat nav links, stale copy). The first motion pass I built (aurora gradients, glass, pointer glow, button sweeps, floating sparkle illustrations, pulsing dots) also read as an AI template and was removed before commit.
- **Built:** `packages/ui/src/styles/motion.css` (rise-in once, stagger, chart bars grow / lines draw / meters fill, peak annotation from data via the new `highlight` chart prop, toast spring, shimmer skeletons, lift only on links, faint top highlight on cards; all off with reduced motion); still state marks for empty/error/locked; dashboard rebuilt ("Needs your attention" list of non-zero items by severity, 4 key numbers, revenue chart); navigation grouped Main / Work / People / Finance; stale dashboard copy removed; "Active" → "Active projects". Rules in `docs/design-system.md` §5–§6.
- **Tests:** `pnpm check` 381 passed; `pnpm e2e` 6 passed; `pnpm e2e:journey` 2 passed (5.2 min) — the accessibility check now waits for a quiet period with no one-off animation (text fading in is not a contrast failure), journey time limit 6 min, two slow steps (dashboard after a full reload, password change with the outside leaked-password check) given 15 s. New screenshot `e2e/screenshots/dashboard-busy-{en,ar}.png` shows a working firm's dashboard. `pnpm security` clean (same moderate advisory).
- **Repo state:** committed ("Design v0.3"); `pnpm dev` running. Not pushed.
- **Next:** Phase 14 Reports, audit search, analytics.

---

## 2026-10-31 — Session 7: Phase 13 committed; Phase 12b (Expenses) built + committed

### Hand-over 12b (A–H)
- **A Built:** expense claims with lines (date, category, description, amount, project, bill-to-client, receipt), categories and receipt threshold as company settings, draft → submitted (EX- number) → approved / sent back → reimbursed, reopen after send-back, recorded reimbursement, project expense cost, re-billing of billable expenses on invoices (once, at cost; void releases), notifications, dashboard Expenses card. See `docs/modules/expenses.md` §11.
- **B Files:** contracts `expenses.ts` (new), permissions (+5 `expenses.*`, matrix in `permissions.md`), notifications (+3 types), dashboard (`expenses`), billing (`includeExpenses`, `expenseLines`); db `schema/expenses.ts`, migrations 0035/0036 (`app.expense_claims_guard`, `app.expense_lines_draft_only`, `app.invoice_expense_lines_approved_only`, `app.invoice_draft_only` extended), isolation list; api `modules/expenses/` (service, controller + project route), billing from-time/void/toInvoice, dashboard, app module, `test/expenses.spec.ts`, `test/access.spec.ts` (employee dashboard now has expenses); web `routes/expenses/` (expenses, claim), project Expenses card, dashboard card, invoice "also re-bill expenses", bell, sidebar, palette, router; i18n EN/AR; journey Phase 12b steps.
- **C Architecture:** claimant → claim → lines (→ project, → receipt file) → approver (line manager / team lead via `teamScopeOf`, or company approvers) → reimbursement. Approved billable lines → `invoice_expense_lines` (unique) → invoice draft lines at cost. Project cost reads approved/reimbursed lines of the project.
- **D Security:** forced RLS on 3 tables; lines editable only while the claim is a draft, claims leave only by allowed transitions, totals fixed after submission, drafts only deletable, no self-decision or self-reimbursement (check constraints), only approved billable lines can be invoiced (triggers); receipts must be my own uploads, not infected; receipt downloads audited; 404 for claims outside my scope.
- **E Tests:** `pnpm check` **381** passed (api 257, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e` 6 passed; `pnpm e2e:journey` 2 passed (EN 2.6 min, AR 2.4 min) after making three status checks exact (the toast repeated the word); `pnpm security` clean (one moderate advisory below the threshold, as before). Receipt files in the API test are inserted directly as clean file rows (fixture; the real upload + virus scan path is covered by `files.spec.ts`).
- **F Verify:** project-status "How to verify Phase 12b".
- **G Open:** mileage/per-diem rules, foreign-currency receipts, re-billing mark-up, reimbursement through payroll, corporate cards.
- **Repo state:** committed ("Phase 12b"); `pnpm dev` running in the background; dev DB migrated to 0036. Not pushed.
- **H Next:** Phase 14 Reports, audit search, analytics (spec `docs/modules/reports.md` first).

---

## 2026-10-31 — Session 6 (continued): Phase 13 (Notifications & announcements) built + committed

### Hand-over 13 (A–H)
- **A Built:** notification preferences per person and type (in-app on/off, email copy on/off; roles changed and announcements always in the app), email copies in each recipient's language through the outbox, new notices (invoice issued → project manager, budget hours crossing 80 %/100 % → manager, Owner, CEO), company announcements (bilingual, everyone or chosen roles, optional email, exact recipient-count confirmation, 10 per day, delivery counts, audit). See `docs/modules/notifications.md` §11.
- **B Files:** contracts `announcements.ts` (new), `notifications.ts` (+3 types, `MANDATORY_IN_APP`, preference schemas), permissions (+`announcements.publish`, matrix in `permissions.md`); db `schema/announcements.ts`, migrations 0033/0034, isolation list; api `platform/notifications/notifier.ts` (preferences + email copies), `modules/identity/user-directory.ts` (contacts + locale), `modules/announcements/`, notifications preferences endpoints, tasks (threshold alerts), billing (issued notice), `test/announcements.spec.ts`, `test/access.spec.ts` (audit details now include the email count); web `routes/announcements.tsx`, `components/notification-settings.tsx` (on My account), bell texts, router, nav, palette; ui Checkbox `hideLabel`; ui test `logical-css.spec.ts` (bare `left`/`right` — the employee status — is no longer mistaken for a CSS utility); i18n EN/AR (email templates, types, preferences, announcements); journey Phase 13 steps (timeout 240 s).
- **C Architecture:** every module calls the one Notifier → it reads the recipients' preferences → in-app rows for those who want them (mandatory types always) + email copies queued in the same transaction for verified addresses → the worker sends and records status. Announcements: preview count → publish with the same count → announcement row + notifications in batches of 200 + recorded emails + audit, all in one transaction.
- **D Security:** forced RLS on the 3 new tables; announcements insert/select only for the app role; recipients chosen by the server from the company's members; publishing needs `announcements.publish`; protection against mass delivery (count confirmation, daily limit); links are company paths and the target page re-checks access.
- **E Tests:** `pnpm check` **378** passed (api 254, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e` 6 passed; `pnpm e2e:journey` 2 passed (EN + AR, 2.3 min each); `pnpm security` clean (one moderate advisory below the high threshold, as before). Notes: Docker Desktop had stopped (dev stack exited, test containers failed) and was restarted; after the restart, one real failure (the access test expected the old audit details, now updated), then one full run had a single failing API test that did not come back in the later runs (not identified, possibly timing) — watch for it.
- **F Verify:** project-status "How to verify Phase 13".
- **G Open:** SMS and push channels (push with Phase 16), scheduled announcements, digest emails; the intermittent API failure above.
- **Repo state:** committed ("Phase 13"); dev DB migrated to 0034. Not pushed. The computer was shut down overnight (exit code 1073807364 = console closed), which stopped Docker Desktop and `pnpm dev`; start Docker Desktop, then `pnpm dev`, before browser tests.
- **H Next:** Phase 12b Expenses (spec `docs/modules/expenses.md` first), then Phase 14.

---

## 2026-10-30 — Session 6 (continued): Phase 12 (Invoicing & payments) built + committed

### Hand-over 12 (A–H)
- **A Built:** invoices (drafts, issue with INV- numbers, lines with discounts and configured taxes, client/contract/project links), drafts from approved billable time (each entry billed once), recorded payments (partial), reversals, credit notes (CN-), void, overdue state and weekly reminders to finance, aging and revenue reports, bilingual print view, client Invoices tab, dashboard Receivables. See `docs/modules/billing.md` §11.
- **B Files:** contracts `billing.ts`, permissions (+`billing.invoice.read`), notifications (+1), dashboard (`billing`); db `schema/billing.ts`, projects (tenant+client+id key), migrations 0031/0032 (`app.invoices_guard`, `app.invoice_draft_only`, payment column grant), `jobs.ts` (`billing.daily`), isolation list; api `modules/billing/` (service with `lineTotals` and `BillingDailyHandler`, controller), worker registration, dashboard, `test/billing.spec.ts`; web `routes/billing/` (invoices, invoice, print), router, app-layout, client tab, dashboard card, notification bell; i18n `billing` EN/AR; journey Phase 12 steps.
- **C Architecture:** client → (contract, project of the same client) → invoice → lines; approved billable time entries → invoice (unique link); payments and credit notes → balance → status. Money is computed in fils with the same exact helpers as payroll.
- **D Security:** forced RLS on 5 tables; issued invoices undeletable and immutable in amounts/client/number, void needs a reason and no payments, void stays void, lines and billed time frozen after issue (triggers); payments insert-only except marking reversed (column grant); payment recording needs a two-factor permission; managers limited to invoices of projects they manage.
- **E Tests:** `pnpm check` **373** passed (api 249, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (first run); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). One test initially checked the payment rule as the migration role (which owns the tables); it now checks the application role, as intended.
- **F Verify:** project-status "How to verify Phase 12".
- **G Open:** server-generated PDF and client delivery links, KNET/payment-gateway integration (would create "provider" payments), multi-currency.
- **Repo state:** committed ("Phase 12"); `pnpm dev` running; dev DB migrated to 0032. Not pushed.
- **H Next:** Phase 13 Notifications & announcements.

---

## 2026-10-30 — Session 6 (continued): Phase 11 (Payroll — test-only until verified) built + committed

### Hand-over 11 (A–H)
- **A Built:** salary records with history, versioned payroll rules (law-dependent values off/0, all flagged "to be verified"), explicit monthly inputs, an exact fils-based calculation engine with a line-by-line trace (basic, allowances, overtime, bonus, unpaid leave from approved leave, late minutes from attendance, advances, adjustments, social insurance), run workflow draft → calculated → submitted → approved → paid with separation of duties, test runs never payable, payslips for employees after approval, CSV export, notifications. See `docs/modules/payroll.md` §11.
- **B Files:** contracts `payroll.ts`, notifications (+2), permissions (own payslips for every employee role); db `schema/payroll.ts`, migrations 0029/0030 (partial unique month index, column-only grant for verification, triggers `app.payroll_prepared_only` and `app.payroll_runs_guard`), isolation list; api `modules/payroll/` (engine + spec, service, controller), attendance `daysOf` now public, `test/payroll.spec.ts`, `test/support/people.ts` `enableTwoFactor`; web `routes/payroll/` (payroll, run, payslips), router, app-layout, notification bell; i18n `payroll` EN/AR; journey Phase 11 steps.
- **C Architecture:** salary record (as of month end) + rule version (as of month end) + approved unpaid leave + attendance late minutes + explicit inputs → pure engine → payslip rows with the trace and the rule version kept forever.
- **D Security:** forced RLS on 5 tables; salary history and rule versions insert-only (verification is a column-only update); payslips/inputs frozen after submission (trigger); approver/payer ≠ preparer (API + check constraints); paid only with a verified rule set and only once (trigger); salary reads, run views, payslip views and exports audited without amounts; employees see only their own approved payslips.
- **E Tests:** `pnpm check` **366** passed (api 242 incl. engine 6, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (first run found the payslip-permission gap above, fixed); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only).
- **F Verify:** project-status "How to verify Phase 11".
- **G Open / owner action:** **payroll is not for real use** until a Kuwaiti lawyer/accountant verifies the rules (then a CEO confirms in Payroll → Rules). Not built: end-of-service indemnity, WPS bank file, employer contributions / PIFSS reports.
- **Repo state:** committed ("Phase 11"); `pnpm dev` running; dev DB migrated to 0030. Not pushed.
- **H Next:** Phase 12 Invoicing & payments.

---

## 2026-10-30 — Session 6 (continued): Phase 10 (Attendance) built + committed

### Hand-over 10 (A–H)
- **A Built:** kiosk sites showing a rotating, HMAC-signed QR (new every 30 s), one-tap scan page, web check-in (company setting), automatic in/out alternation with a minimum gap, shifts with grace and break, per-day late / early / worked / absent / leave / holiday, comparison with logged time, who-is-in board, correction requests with approval, dashboard card, notifications. See `docs/modules/attendance.md` §9.
- **B Files:** contracts `attendance.ts`, permissions (+4 attendance), notifications (+2), dashboard (`attendance`); db `schema/attendance.ts` (incl. general `company_settings`), migrations 0027/0028 (incl. `app.attendance_corrections_guard`), isolation list; api `modules/attendance/` (service with `KioskCodes`, controller), dashboard, `test/attendance.spec.ts`; web `routes/attendance/` (attendance, kiosk, scan), router (kiosk outside the frame), app-layout, dashboard, notification bell, dependency `qrcode` 1.5.4 (MIT, already in the lockfile), i18n `attendance` EN/AR; journey Phase 10 steps; `waitForSteadyApi` now waits for 8 healthy seconds.
- **C Architecture:** kiosk (admin session) → signed code → phone (member session) → check → append-only events → per-day computation from events + shift + employee schedule + approved leave + holidays + time entries.
- **D Security:** codes bound to company, site and window, constant-time comparison, replay table with unique key, server time only; events insert-only for the app; corrections can't be self-approved (API + trigger); team scope per person; no IP or location stored.
- **E Tests:** `pnpm check` **356** passed (api 232, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (one earlier run failed only because the API restarted several times after the pre-build — the wait is now stricter); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). Found during testing: an identical Arabic/English label and a weak cross-company test (both fixed).
- **F Verify:** project-status "How to verify Phase 10".
- **G Open:** location verification (decided not needed), payroll use of the summary (Phase 11), mobile app (Phase 16).
- **Repo state:** committed ("Phase 10"); `pnpm dev` running; dev DB migrated to 0028. Not pushed.
- **H Next:** Phase 11 Payroll — rules as company settings flagged "to be verified by a Kuwaiti lawyer/accountant"; preparation and approval by different people; payslips; no real payroll before verification.

---

## 2026-10-30 — Session 6 (continued): Phase 9 (Leave management) built + committed

### Hand-over 9 (A–H)
- **A Built:** company leave types (four Kuwait defaults flagged "to be verified by a Kuwaiti lawyer/accountant"), public holidays, ledger-based balances with monthly/yearly accrual from the joining date, applications counting working days minus holidays (half days, documents), approval by team lead/manager/Owner/CEO/HR, reject with note, withdraw, cancel with restoration, overlap check, team calendar, notifications, dashboard Leave card. See `docs/modules/leave.md` §11.
- **B Files:** contracts `leave.ts`, permissions (+`leave.request.create`, `leave.request.read`, `leave.policy.manage`), notifications (+4), dashboard (`leave`); db `schema/leave.ts`, migrations 0025/0026 (incl. `app.leave_requests_guard`), isolation list; api `modules/leave/` (service, controller), dashboard, `test/leave.spec.ts`, access test update; web `routes/leave/leave.tsx`, router, app-layout, dashboard card, notification bell; i18n `leave` EN/AR; journey Phase 9 steps.
- **C Architecture:** employee record (schedule, joining date) + leave type (policy) + holidays → working days; approval writes ledger rows (one per year of the leave) inside one transaction with the person's employee row locked; balances are always computed from policy + ledger.
- **D Security:** forced RLS on 4 new tables; ledger append-only for the app and unique per (request, kind, year) so a request can't be deducted or restored twice even in a race; database trigger blocks self-decisions; team scope checked per request; supporting documents must be my own uploads.
- **E Tests:** `pnpm check` **351** passed (api 227, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (first run); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). The catalog test caught one untranslated Arabic label (fixed).
- **F Verify:** project-status "How to verify Phase 9".
- **G Open:** adjustments screen (API exists), carry-over/expiry rules, leave reducing capacity, attendance and payroll links (Phases 10–11). **Owner action:** have a Kuwaiti lawyer/accountant review the four default leave types before real use.
- **Repo state:** committed ("Phase 9"); `pnpm dev` running; dev DB migrated to 0026. Not pushed.
- **H Next:** Phase 10 Attendance (check-in/out with a rotating signed QR code, per brief Module I and "QR code security").

---

## 2026-10-30 — Session 6 (continued): Phase 8 (Employees & teams) built + committed

### Hand-over 8 (A–H)
- **A Built:** employee records (E-0001) for members with job title, department, manager, employment type, dates, weekly hours and working days; lifecycle onboarding → active ⇄ on leave → offboarding → left with checklists; departments, teams (lead + members), reporting lines; documents (confidential flag); private details and emergency contacts encrypted at rest; append-only history; capacity/utilisation in time summaries. Web: People, person page, Organisation. See `docs/modules/people.md` §11.
- **B Files:** contracts `people.ts`, permissions (+`people.employee.manage` (two-factor), +`people.org.manage`), `time.ts` (capacity); db `schema/people.ts`, migrations 0023/0024, isolation list; api `platform/crypto/field-cipher.ts` (+spec), config `DATA_ENCRYPTION_KEY`, `modules/people/` (service with `teamScopeOf`, controller), time service (capacity), `test/people.spec.ts`, config/logger spec updates; web `routes/people/` (list, detail, organisation), shared `DocumentsTab` takes a schema, router, app-layout; i18n `people` EN/AR; journey Phase 8 steps.
- **C Architecture:** membership (sign-in, roles) → employee record (HR) → teams / reporting line → "team" scope for later modules (leave approvals use `teamScopeOf`).
- **D Security:** forced RLS on 9 new tables; private data sealed with AES-256-GCM bound to the company, separate key, keyed hash for civil-ID uniqueness, never logged (audit records field names only), every restricted read audited; employment details limited to company readers, HR, the person and their manager; leaving suspends company access; only an Owner ends an Owner's/CEO's employment and never the last Owner.
- **E Tests:** `pnpm check` **346** passed (api 222, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (two locator fixes in the new steps, no product defects); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only).
- **F Verify:** project-status "How to verify Phase 8".
- **G Open:** time approval by team leads (time stays with project managers); Kuwaiti legal field validation (Phase 11); self-service edits beyond private details.
- **Repo state:** committed ("Phase 8"); `pnpm dev` running; dev DB migrated to 0024. **Local `.env` changed:** a random dev-only `DATA_ENCRYPTION_KEY` was added (not committed). Not pushed.
- **H Next:** Phase 9 Leave management (leave types and balances as company settings flagged "to be verified", requests, approval by team lead/manager, calendar, integration with timesheets/capacity).

---

## 2026-10-30 — Session 6 (continued): Phase 7 (Timesheets & time tracking) built + committed

### Hand-over 7 (A–H)
- **A Built:** time entries on tasks the person is assigned to, a timer, weekly timesheets (Sunday–Saturday), submit → approval by each project's manager (Owner/CEO anywhere) with send-back and correction, reopen of approved time with a reason, duplicate and 24-hour-a-day guards, billable defaults from the project, period summaries, planned vs actual per task; projects now show real logged / approved / billable hours. Web: My time, Time approvals, task "Planned vs actual", sidebar, palette, dashboard Time card, notifications. See `docs/modules/timesheets.md` §11.
- **B Files:** contracts `time.ts`, permissions (+`time.entry.read`), notifications (+3), dashboard (`time`); db `schema/time.ts`, migrations 0021/0022 (incl. `app.time_entries_guard` trigger), isolation list; api `modules/time/` (service, controller), projects service (real time totals), tasks service (keep people with logged time), dashboard, `test/time.spec.ts`, access test update; web `routes/time/` (my-time, approvals, task-time), router, app-layout, task detail, dashboard, notification bell; i18n `time` EN/AR; journey Phase 7 steps + `waitForSteadyApi` (fixes a start-up race after the pre-build).
- **C Architecture:** allocation → time entries (composite FK: only assignees log time) → timesheet of the same person (composite FK) → project totals. Approval is per entry, so one week can go to several project managers.
- **D Security:** forced RLS on 3 new tables; database trigger keeps entries inside their week, blocks self-decisions and deleting submitted/approved entries; API re-checks approver scope per entry; approved time locked; reopen audited with reason.
- **E Tests:** `pnpm check` **337** passed (api 213, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (one earlier failure was the API restarting after the pre-build; fixed with a steady-API wait); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). The catalog test caught an untranslated Arabic label (fixed).
- **F Verify:** project-status "How to verify Phase 7".
- **G Open:** overtime (Phase 11), profitability (11/12), utilisation vs capacity (8), UI to browse approved entries for reopening (API exists), monthly summary screen.
- **Repo state:** committed ("Phase 7"); `pnpm dev` running; dev DB migrated to 0022. Not pushed.
- **H Next:** Phase 8 Employee & team management (employee records with restricted fields, teams, capacity → team scopes and utilisation).

---

## 2026-10-30 — Session 6 (continued): Phase 6 (Tasks & hour allocation) built + committed

### Hand-over 6 (A–H)
- **A Built:** tasks (T-0001, priority, dates, estimate, workflow backlog → ready → in progress → in review → completed / cancelled, dependencies, comments, documents, activity) and per-person hour allocations checked against the project budget inside one transaction with the project row locked, Owner/CEO override with a reason; live preview of remaining hours and workload; workload per person; assignment + overdue notifications (daily 08:00 Kuwait job `tasks.daily`); project allocated hours and "over budget" now real. Web: Tasks list + board, New task (12-step workflow), task page, project Tasks tab, sidebar, palette, dashboard "My work". See `docs/modules/tasks.md` §11.
- **B Files:** contracts `tasks.ts`, permissions (+3: tasks.task.read/manage/work; team lead allocation now project scope), notifications (+2), dashboard (`tasks`, `projects.overBudget`); db `schema/tasks.ts`, migrations 0019/0020, `jobs.ts` (`tasks.daily`), isolation list; api `modules/tasks/` (service with `TasksDailyHandler`, controller), projects service (real allocated hours, team-removal guard), dashboard, worker registration, `test/tasks.spec.ts`, small updates to projects/access/contracts permission tests; web `routes/tasks/` (list, new, detail, shared, project-tab), router, app-layout, project detail tab, dashboard card, notification bell texts; i18n `tasks` EN/AR; journey Phase 6 steps.
- **C Architecture:** project → tasks → allocations (composite FKs: an allocation's project must be its task's project, and the person must be on that project's team). Every allocation change locks the project row first, so concurrent requests are checked one after another against the same budget. Timesheets (Phase 7) will log time against task allocations.
- **D Security:** forced RLS on 5 new tables; comments append-only for the app role (tested); scope checks per task (own = assigned, project = on the team); override needs a two-factor permission + reason (audited); other companies 404.
- **E Tests:** `pnpm check` **329** passed (api 205, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed on the first run; `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). Found and fixed during testing: the overdue job would have alerted on tasks of cancelled projects.
- **F Verify:** project-status "How to verify Phase 6".
- **G Open:** recurring tasks, calendar view, board drag-and-drop (decided not now); workload capacity limits (Phase 8); actual/approved hours (Phase 7); palette does not search tasks by title yet.
- **Repo state:** committed ("Phase 6"); `pnpm dev` running; dev DB migrated to 0020. Not pushed.
- **H Next:** Phase 7 Timesheets & time tracking (log time against allocations, submit/approve/reject, actual vs allocated vs billable).

---

## 2026-10-30 — Session 6: Phase 5 (Projects & budgeting) built + committed

### Hand-over 5 (A–H)
- **A Built:** projects per client (optional contract of the same client), P-0001 numbering, manager + team, status machine (planned → active ⇄ on hold → completed; open → cancelled; closed = frozen), budget hours/amount with append-only revisions (reason, who, when), hours summary (budgeted / allocated / remaining / logged / approved / billable + 80 %/100 % warnings), documents, activity, project-scoped access. Web: list, new, detail, client Projects tab, sidebar, palette, dashboard card, EN + AR. See `docs/modules/projects.md` §11.
- **B Files:** contracts `projects.ts`, `permissions.ts` (project read/manage scopes), `dashboard.ts`; db `schema/projects.ts`, `contracts.ts` (tenant+client+id key), migrations 0017/0018, isolation list; api `modules/projects/` (service, controller), access guard minimum scope (`RequirePermission(p, scope)`), dashboard section, `test/projects.spec.ts`; web `routes/projects/` (list, new, detail, client-tab, shared), `lib/session.ts` `canAny`, router, app-layout, client detail tab, dashboard, client `DocumentsTab` made generic (`basePath`); i18n `projects` EN/AR; journey Phase 5 steps.
- **C Architecture:** client → project (→ contract of the same client via composite FK). The guard lets project-scope roles through; the service then checks "manager or team member" on the specific project and answers 404 otherwise. Tasks (Phase 6) and timesheets (Phase 7) will feed the hour measures through `ProjectsService.hours`.
- **D Security:** forced RLS on 4 new tables; budget history insert-only for the app role (tested: permission denied on update); team members must be active members of this company; server re-checks permission + state on every change; no client-supplied company IDs.
- **E Tests:** `pnpm check` **320** passed (api 196, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (first attempt failed because the API was restarting after the check's rebuild; second run found one ambiguous locator in my new step, fixed; third run 2 passed); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only).
- **F Verify:** project-status "How to verify Phase 5".
- **G Open:** allocated/logged/approved/billable are 0 until Phases 6–7; dashboard "over budget" count with Phase 6; palette does not search projects by name yet; "engagement" label setting not built; Team leads/Employees cannot yet open the client/contract of their projects (Phase 6).
- **Repo state:** committed (see git log, "Phase 5"); `pnpm dev` running in the background; dev DB migrated to 0018. Not pushed.
- **H Next:** Phase 6 Tasks & hour allocation (concurrency-safe allocations against the project budget).

---

## 2026-10-30 — Session 5 (continued): Phase 4 (Contracts & engagement letters) built + committed

### Hand-over 4 (A–H)
- **A Built:** see `docs/modules/contracts.md` §10.
- **B Files:** contracts `agreements.ts`, permissions (+4), notifications (+5 types), dashboard; db `schema/contracts.ts`, migrations 0015/0016, `jobs.ts` (`contracts.daily`); api `modules/contracts/`, `platform/database/numbering.ts`, Notifier `notifySystem`, `TenantDatabase.activeTenantIds`, `JobQueue.schedule`, worker registration, dashboard section, `test/contracts.spec.ts`; web `routes/contracts/` (list, new, detail, print, templates, client-tab, shared), router, nav, palette, client tab, dashboard card, notification texts; ui Dialog description type.
- **C Architecture:** client → contracts (composite FK); one state machine (`TRANSITIONS`) drives both the API checks and the `actions` the UI shows; the daily job iterates companies by ID and works inside each with RLS.
- **D Security:** separation of duties in API + DB; transitions re-check permission + source state server-side; signed copy must be my own clean upload; documents never deleted; print view uses the same authorised API; "Signed" is never presented as an e-signature.
- **E Tests:** `pnpm check` **308** passed; journey EN + AR 2 passed; gallery 6; `pnpm security` clean.
- **F Verify:** project-status "How to verify Phase 4".
- **G Open:** server-side PDF (Phase 12 with invoices); e-signature provider (integration, later); projects/invoices links come with Phases 5/12. Dev processes: same orphan note as Phase 3 (a fresh `pnpm --filter @ultimate-erp/api dev` serves :3000 next to the old vite on :5173).
- **H Next:** Phase 5 Projects / engagements & budgeting.

---

## 2026-10-30 — Session 5 (continued): Phase 3 (Clients / CRM) built + committed

### Hand-over 3 (A–H)
- **A Built:** the clients module end to end. See `docs/modules/clients.md` §10.
- **B Files:** contracts `clients.ts` (+spec), `permissions.ts` (+4 permissions, matrix in permissions.md), `dashboard.ts`; db `schema/clients.ts`, migrations 0013/0014, isolation tests; api `modules/clients/` (service, controller), dashboard clients section, `test/clients.spec.ts`, `test/support/people.ts` (shared helpers, used by the client suite); web `routes/clients/` (list, new, detail, tabs, client-form, keys), router, app-layout (nav + palette), dashboard card, `lib/api.ts` (FormData), `lib/use-debounced.ts`; i18n `clients` section EN/AR.
- **C Architecture:** client → contacts / interactions / documents (files service) / activity (audit trail). Later modules link through composite foreign keys `(tenant_id, client_id)`.
- **D Security:** RLS on 5 new tables, composite FKs (a contact of client A can't be used for client B), append-only history, permission per route (Employee 403, other company 404), literal search, CSV injection neutralised (mutation-checked), only my own clean uploads can be attached, downloads by client permission.
- **E Tests:** `pnpm check` passed with **300** (api 176, db 39, contracts 36, web 23, ui 16, i18n 10); journey EN + AR 2 passed (real ClamAV scan); gallery 6 passed; `pnpm security` clean.
- **F Verify:** project-status "How to verify Phase 3".
- **G Open / environment notes:** the access and files suites still have their own copies of the people helpers (move them to `support/people.ts` when next touched). **Dev processes:** my first `pnpm dev` (started 2026-10-29 19:17) left orphans after a TaskStop: vite on :5173 (pid 22084), a concurrently tree (pid 9528) with a parked API watcher (3488) and worker watcher (12732). Stopping them was blocked by the safety check, so a fresh `pnpm --filter @ultimate-erp/api dev` (API :3000 + worker) runs next to them. **The owner should close stray node processes** (Task Manager, or restart the PC) before the next `pnpm dev`.
- **H Next:** Phase 4 Contracts & engagement letters (bilingual templates, PDF, numbering, versions, approval/sign-off, linking to clients).

---

## 2026-10-29 — Session 5 (continued): Phase 2b (dashboard) built + committed — Phase 2 complete

### Hand-over 2b (A–H)
- **A Built:** the dashboard from real records only: getting-started progress (company, two-factor, invitation, colleague joined), Team tiles (active members, pending invitations), Recent activity (translated business events from the audit log), quick actions, each shown only with the permission. Reusable accessible charts `BarChart`, `LineChart`, `Meter`, demonstrated in the gallery with labelled example data.
- **B Files:** contracts `dashboard.ts`; api `modules/dashboard/dashboard.controller.ts` (service + controller + module); ui `charts.tsx` (+ `charts.spec.tsx`), `tokens.css` `--series-1…8`; web `routes/dashboard.tsx` (rewritten), `routes/gallery.tsx` (Charts section), router (`/members?invite`); i18n dashboard and gallery texts EN/AR; journey dashboard steps and screenshots.
- **C Architecture:** one summary endpoint; each module will add its own section (permission-gated) and card. Charts take translated labels and a value formatter, so money stays a formatted string (KWD 3 decimals) at the edge.
- **D Security:** sections are computed server-side per permission inside the tenant transaction; the activity feed sends actor names and action codes only (audit details can contain email addresses).
- **E Tests:** `pnpm check` passed with **275** (api 162, db 37, contracts 27, web 23, ui 16, i18n 10); journey EN + AR passed; gallery 6 passed (axe incl. charts); `pnpm security` clean. The palette was validated with the dataviz validator on our surfaces. Rendered screenshots were reviewed and fixed for two clipping issues and one ARIA issue (labels on role-less SVG marks).
- **F Verify:** project-status "How to verify Phase 2b".
- **G Open:** the date-range filter is deferred to the first module card that needs a period (Phase 3+); there is no drill-down yet because there are no business records yet.
- **H Next:** Phase 3 Clients / CRM. Write `docs/modules/clients.md` from brief Module B (+ §11 connections, §13 data), pick defaults, then build: data model + RLS, API, list (table with sort/filter/search/pagination — the first real data table), detail with activity timeline, documents via the 1.5b files, dashboard card, palette search, tests, journey.

---

## 2026-10-29 — Session 5 (continued): Phase 2a (shell) built + committed

### Hand-over 2a (A–H)
- **A Built:** command palette (Ctrl K / ⌘ K) over pages, actions and people with Arabic-aware matching; company switcher; phone navigation drawer; breadcrumbs (`PageHeader`); in-app navigation without reloads; My account name editing and password change; palette "Invite a colleague" opens the Members invite dialog.
- **B Files:** ui `menu.tsx`, `shell.tsx` (PageHeader, NavItem onClick, SearchBox button), `overlays.tsx` (Drawer side, Dialog initialFocus); web `components/command-palette.tsx`, `components/page-header.tsx`, `components/app-layout.tsx` (rewritten), `lib/commands.ts` (+spec), `lib/handoff.ts`, `app/switches.tsx` (`useChangeLocale`), `routes/account.tsx`, `routes/members.tsx`, `routes/dashboard.tsx`; i18n `palette` section + shell/account keys; spec `docs/modules/shell-dashboard.md`.
- **C Architecture:** commands are built in `AppLayout` from the person's access and data; modules will add their own pages, actions and searchable records. The switcher uses the 1.4b hand-off.
- **D Security:** the palette and switcher only offer what the person may do (UX only; the server still checks everything); password change re-checks the current password and signs out other sessions.
- **E Tests:** `pnpm check` passed with **265** (api 159, db 37, contracts 27, web 23, i18n 10, ui 9); journey EN + AR passed twice; `pnpm e2e` 6 passed; `pnpm security` clean (except the accepted esbuild moderate). axe found 2 real issues, now fixed: the switcher's accessible name didn't match its visible text, and focus didn't start in the palette field. The journey's axe helper now names the failing elements and waits for colour transitions.
- **F Verify:** project-status "How to verify Phase 2a".
- **G Open:** the main-address derivation assumes `<slug>.<main>` hosts (custom domains later); member results in the palette open the Members list (no per-person page until Phase 8).
- **H Next:** Phase 2b per `shell-dashboard.md` §4.

---

## 2026-10-29 — Session 5 (continued): 1.5a committed, nonstop mode, Milestone 1.5b built + committed

### Owner direction
"next, do all at once, finish the whole project". Owner chose **Nonstop, you pick defaults** and **Kuwaiti rules as configurable settings, flagged "to be verified"**. CLAUDE.md, memory (`nonstop-build-mode.md`) and project-status Decisions are updated. From now on: build → `pnpm check` + `pnpm security` (+ browser tests) → hand-over A–H here → commit → next milestone, without waiting.

### Hand-over 1.5b (A–H)
- **A Built:** file uploads (content-type allow-list by magic bytes, 25 MB limit, private S3 storage under a per-company prefix, ClamAV scan in the worker, downloads only when clean via 5-minute signed attachment links, uploader-only access for now); error reports in the Sentry protocol (own sender, off unless `SENTRY_DSN`, scrubbed); slow-request log; Docker images (API/worker, web with nginx) + on-prem compose example; ClamAV in dev compose.
- **B Files:** `packages/db/src/schema/files.ts`, migrations 0011/0012, `jobs.ts` (`file.scan` queue); `apps/api/src/platform/files/` (object-storage, virus-scanner, file-types), `platform/monitoring/monitoring.ts`, `platform/request-context/slow-request.middleware.ts`, `modules/files/` (service + controller), `AuditLog.recordSystem`, `worker.module.ts` (file.scan handler); contracts `files.ts` + error `FILE_NOT_READY` (EN/AR); `infra/docker/*`, `infra/compose/compose.prod.example.yaml`, `.dockerignore`; tests `files.spec.ts`, `monitoring.spec.ts`, support `storage.ts`, `tcp-relay.ts` (shared with jobs.spec).
- **C Architecture:** upload → API checks type and size → S3 put + `files` row + `file.scan` job in one transaction → worker streams the object to clamd → `clean`, or `infected` (object deleted, audited), or `scan_failed` after retries → download link only for `clean`. The scan job carries `tenantId` and runs inside `withTenant`.
- **D Security:** type comes from the bytes, not the name (a disguised .exe is refused); no SVG/HTML/archives/macro Office files; the storage key is random and DB-forced under the company prefix; links are attachment-only, short-lived and tamper-proof (signature); every other member or company gets 404; reports carry IDs only. **Licence gate caught** `@sentry/node` 11 pulling an FSL-1.1 (non-open-source) package, so the SDK was replaced by our own sender.
- **E Tests:** `pnpm check` passed: api 159, db 37, contracts 27, web 18, i18n 10, ui 9 = **260**. Browser 8 passed. `pnpm security`: licences OK (320), no leaks, only the accepted esbuild moderate. Mutation checks: type check, scanner verdict, email scrubbing. Images built and started locally.
- **F Verify:** project-status "How to verify Milestone 1.5b".
- **G Open:** OpenTelemetry traces deferred to Phase 15 (ESM loader hook); no upload UI until Phase 3; ClamAV needs ~1 GB RAM and 1–2 min to start (`pnpm dev` now waits for it after `services:up` restarts it); the CI `images` and `journey` jobs have not run on GitHub yet (no remote).
- **H Next:** Phase 2 (executive shell & dashboard). Plan it from roadmap + brief, pick defaults, build.

---

## 2026-10-29 — Session 5: Milestone 1.5a built, awaiting owner approval

### Where we are
The owner said "continue" after the gaming pause. Claude restarted Docker Desktop and finished 1.5a. **Everything is built and verified but NOT committed**; the owner tests it and approves. After "approved": commit "Milestone 1.5a: background jobs and notifications", then plan **1.5b** (files with ClamAV, monitoring configurable and off by default, Dockerfiles). Its decisions were already made on 2026-10-28; still present the short plan before building.

### What was done this session
- Fixed the paused compile error (identity emails return `Promise<void>` again).
- Worker added to `pnpm dev` (api `dev` script: tsc, api, worker) and to the CI `journey` job. Identity and access tests start a worker in-process (`createWorker`).
- `apps/api/test/jobs.spec.ts`: 5 outbox tests, with a real SMTP outage simulated by a switchable relay. Mutation-checked: the rollback test and the encryption test each fail when their protection is removed.
- Notifications: `platform/notifications/notifier.ts` (send side, cap 200, audited), `modules/notifications/` (4 endpoints), hooked into invitation accept (Owners/CEOs) and role change (that member). Tests in `access.spec.ts`; the audit test now expects `notifications.notification.sent` events.
- **Bug found by the database guard:** the notification link rule rejected `/`. Fixed in migration 0010.
- Web: `components/notification-bell.tsx` (bell, unread count every 60 s, panel, mark read / all, "Show older"), hidden while two-factor setup is required. Members shows "Email not delivered" on a failed invitation. EN/AR texts added. The journey now checks the bell (axe on the panel).
- Docs: platform-jobs.md (status, corrections: 6 attempts in total; cross-tenant job test deferred to the first company-data job; §9 results), api.md, testing.md, database.md (job queue section), README (worker; `db:generate --name=` without `--`), checklist, roadmap, project-status.

### Verification (real results, 2026-10-29)
- `pnpm check`: passed. api 148, db 37, contracts 27, web 18, i18n 10, ui 9 = **249**.
- `pnpm e2e:journey`: **2 passed** (EN, AR). `pnpm e2e`: **6 passed**.
- `pnpm security`: licences OK (294 packages), no leaks. Audit: only the accepted moderate esbuild advisory.

### Repo state
- Last commit `f1f9276` (1.4b). All 1.5a work is uncommitted: migrations 0008–0010, new deps pg-boss (api, db), the new files above.
- Dev DB migrated to 0010. `pnpm dev` is running in the background (started by Claude: API :3000, worker, web :5173). Docker Desktop is running.
- The dev DB has more `e2e-*` companies and `@example.test` accounts from journey runs (harmless).

### Waiting on owner
Test 1.5a (project-status.md "How to verify Milestone 1.5a") and approve.

---

## 2026-10-28 — Session 4 (continued): 1.4b approved + committed, 1.5a planned

### Where we are
Owner said "next" → 1.4b committed `f1f9276`. Milestone 1.5 planned and split. Owner decisions: split 1.5a/1.5b; monitoring configurable + off by default; ClamAV scanning; notification bell in 1.5a. Spec written: `docs/modules/platform-jobs.md`. **Building 1.5a.**

### Build plan (continue from the first unticked item)
- [x] pg-boss 12.38.0 dependency; schema `pgboss` created by migrator; erp_app grants; migration for `notifications` (RLS) + `email_deliveries`.
- [x] API platform/jobs: JobQueue.enqueue(tx) in caller's transaction; payload encryption (HKDF from AUTH_SECRET); worker entry `apps/api/src/worker.ts`; `pnpm dev` runs it.
- [x] Email via job (identity + invitation emails), retries 5 × backoff, delivery status; invitations list shows delivery.
- [x] Notifier + notifications API; types member_joined, roles_changed; audit; cap 200.
- [x] Web: bell + panel; Members shows email failed. i18n EN/AR.
- [x] Tests (spec §8), journey extended; docs; hand-over A–H (see Session 5 entry).

### Paused mid-build (owner asked to stop Docker)
- Done, uncommitted: pg-boss 12.38.0 (api + db). `packages/db/src/jobs.ts` (queues installed by the migrator, erp_app gets row privileges only, `transactionExecutor` = pg-boss `fromDrizzle`). Tables `notifications` (RLS) + `email_deliveries` (global), with migrations 0008/0009 applied to the dev DB. db tests: **37 passed**, including the new queue-privilege and notification-isolation tests.
- API, written but **not compiling yet**: `platform/jobs/` (JobQueue, PayloadSealer, JobsModule), `platform/mail/email-outbox.ts` (EmailOutbox + EmailDeliveryHandler), `worker.ts`, `worker.module.ts`, `worker-bootstrap.ts`. Identity emails and invitations now use EmailOutbox; invitations carry a `delivery` status (contract updated).
- **Next fix:** `IdentityEmails` methods now return `Promise<string>`, but Better Auth callbacks and `identity.service.ts` expect `Promise<void>`. Wrap them (`.then(() => undefined)`) or change the methods back to `Promise<void>`. The other typecheck errors (`auth.api.verifyTOTP` etc.) are knock-on effects of the `auth.ts` plugin type breaking, so re-check after that fix.
- Then: add the worker to the api `dev` script, start the worker in the identity/access tests (`createWorker`), and write the outbox/retry/rollback/encryption tests. Spec correction: `retryLimit` 5 means 6 attempts in total.
- README fix needed: with pnpm 12, use `pnpm db:generate --name=…` (no `--`).
- Docker Desktop and `pnpm dev` were stopped at the owner's request. To resume: start Docker Desktop, then `pnpm dev`.

### Repo state
Last commit `f1f9276` (1.4b). Everything above is uncommitted.

---

## 2026-10-28 — Session 4 (continued): Milestone 1.4b built, awaiting owner approval

### Where we are
1.4a approved and committed `b875341`. **Milestone 1.4b is built and verified, NOT committed**, and waits for the owner to test and approve. After "approved": commit 1.4b, then plan Milestone 1.5 (worker, files, notifications, monitoring). Present that plan with its owner decisions before building it.

### Build plan
- [x] API: `WEB_PUBLIC_URL` for email links; same-origin check for company web origins.
- [x] API: `sessions.authenticated_at`, `handoff_tickets`, `GET /auth/companies`, `POST /auth/handoff` + `/redeem`, `PATCH /auth/me` (migrations 0006/0007).
- [x] Web: API client, translated error codes, react-hook-form + contract schemas, QR via `qrcode` (drawn locally).
- [x] Web screens: all listed in `modules/web-ui.md` §9 (auth pages, companies, hand-off, invitation, shell, dashboard, members, account). MFA-required → `/account`.
- [x] E2E `apps/web/e2e/journey.spec.ts` (EN + AR, axe on 12 screens each); CI `journey` job added.
- [x] Docs: web-ui.md §8–§14, api.md, testing.md, README, checklist, roadmap, compliance, project-status.

### Changes made late in this session (beyond the plan)
- `safeReturnTo` hardened: also rejects backslashes, spaces and control characters. Before this, `/\t/evil.example` would have become `//evil.example`, an open redirect. Unit-tested.
- Sign-in navigates to `returnTo` as an href, so the invitation token in the query string survives.
- Duplicate toast provider removed (`UiProvider` already provides one).
- `LanguageSwitch` saves the choice to the account (`PATCH /auth/me`) when signed in.
- Removed the 1.4a placeholder `routes/home.tsx`. `/gallery` stays.
- Playwright projects: `ui` (`pnpm e2e`) and `journey` (`pnpm e2e:journey`, needs `pnpm dev`).

### Repo state
- Last commit `b875341` (1.4a). All 1.4b work is uncommitted (API, db migrations 0006/0007, contracts, i18n, ui fields, web app, e2e, CI, docs).
- Local `.env`: added `WEB_PUBLIC_URL=http://localhost:5173` (also in `.env.example`).
- Dev DB: migrations 0006/0007 applied (`pnpm db:setup`). Contains `e2e-*` companies and `*@example.test` accounts from journey runs. Mailpit was cleaned by the tests.
- `pnpm dev` was started by Claude in the background (API :3000, web :5173) and may still be running.

### Verification (real results, 2026-10-28)
- `pnpm check`: passed. Tests: api 127, db 32, contracts 27, web 18, i18n 10, ui 9 = **223**.
- Browser: `playwright test` → **8 passed** (6 gallery + journey EN + journey AR). The journey passed on 2 consecutive runs.
- `pnpm security`: licence check passed (284 packages), no leaked secrets. Audit: only the accepted moderate esbuild advisory GHSA-67mh-4wv8-2f99.

### Waiting on owner
- Test 1.4b by hand (project-status.md "How to verify Milestone 1.4b") and approve.
- Known gaps (project-status Known issues): no password-change screen yet, phone-width layout not tuned, bundle > 500 kB.

### Next step
Owner approval → `git add -A && git commit` "Milestone 1.4b: screens and end-to-end journey" → plan Milestone 1.5.

---

## 2026-10-28 — Session 4: 1.3b committed, Milestone 1.4a design system built

### Where we finished
1.3b approved ("go next") and committed `4ae3f76`. **Milestone 1.4a (design system) is built and verified, awaiting the owner's review of the gallery. NOT committed.** Do not start 1.4b until approved.

### Decisions (owner, 2026-10-28)
- 1.4 split into 1.4a (look) and 1.4b (screens + E2E). Sidebar shows only built modules. First-visit language: company default on a company address, browser language on the main address; saved choice wins.
- Mine (documented): light `ink-3` → #68636f, `butter-ink` → #7a5600, `warn` → #b47e00, dark `ink-3` → #948e9e — required by axe for WCAG AA contrast; OFL-1.1 approved for fonts.

### Done
- Spec `docs/modules/web-ui.md`. New `packages/ui` (tokens.css from the approved preview, index.css with Tailwind 4 @theme, components: button, fields, data-display, overlays, states, shell), `apps/web` (Vite 8, TanStack Router/Query, i18n/theme providers with localStorage guarded, home page, `/gallery`), `packages/i18n` UI catalogs (`en-ui.ts`, `ar-ui.ts` machine-drafted) + `format.ts` (ICU translate, formatMoney from decimal strings, formatDate in Asia/Kuwait, latn digits).
- Lint covers `.tsx` with strict TS + react-hooks; logical-CSS guard test (mutation-checked). Playwright + axe (`apps/web/e2e/gallery.spec.ts`), CI `e2e` job, `pnpm e2e`.
- Visual check of screenshots by me: matched v0.2; fixed invisible skeletons and monospace "Ctrl K".

### State
- Uncommitted: all 1.4a work. `pnpm dev` started by me (background) and left running for the owner: API :3000, web :5173 (listens on ::1). Docker had stopped mid-session (restarted; containers auto-restarted).
- Chromium for Playwright installed in the user profile (`ms-playwright`).

### Verification (last run)
- `pnpm check`: 199 passed (i18n 10, contracts 27, ui 9, db 32, api 121). `pnpm e2e`: 6 passed, axe clean EN/AR × light/dark. `pnpm security`: 1 moderate (accepted), 253 licences OK, no leaks.

### Next step
Owner opens http://localhost:5173/gallery (switch language/theme), gives feedback on the look; on approval (+ commit) → 1.4b plan: auth/onboarding screens on the real API, invitation accept, sessions, app shell, translated error codes, origin check must allow `*.localhost:5173` company origins (currently only APP_PUBLIC_URL + CORS_ORIGINS), Playwright journey via Mailpit in EN and AR.

---

## 2026-10-27 — Session 3 (continued): Milestone 1.3b Access built

### Where we finished
**Milestone 1.3b (Access) is built and verified, awaiting the owner's review and approval. NOT committed** (last commit `253b180` = 1.3a). Do not start 1.4 until the owner approves 1.3b.

### Done
- Spec `docs/modules/access.md` first; permissions.md matrix extended (access.members.read/invite/manage, access.roles.assign) and now machine-checked.
- `packages/contracts`: `permissions.ts` (permissions, scopes, 8 fixed roles, sensitive set, effectivePermissions, hasPermission, isSensitive, canGrant, FOUNDER_ROLES), `access.ts` (slug rules + reserved list, request/response schemas), error `MFA_REQUIRED`.
- DB: migrations 0004 (membership_roles, invitations, audit_events) + 0005 (forced RLS, grants, append-only trigger incl. TRUNCATE, `app.user_role_names()`); isolation guard generalized (key containing tenant_id).
- API: `platform/audit` (same-transaction AuditLog), `platform/openapi` (`@ApiContract`, generator, `/api/v1/docs/openapi.json` dev-only), `TenantDatabase.newTenantId()`, `pg-error.ts`, config `PLATFORM_BASE_DOMAIN`; `modules/access` (AccessGuard, AccessService with advisory-lock-serialized role changes, CompaniesService, InvitationsService, AuditEventsService, MembershipSignInPolicy via identity's `SIGN_IN_POLICY` hook); identity: `completeSignIn` (policy, trusted-device refusal for sensitive roles), `revokeTrustedDevices`, `userSummaries`, `userIdByEmail`; i18n: invitation email + role names.
- Every existing route annotated with `@ApiContract` (~34).
- Dev helper `pnpm http` (scripts/dev-http.mjs, `.dev-cookies/` git-ignored) because PowerShell cannot resolve `*.localhost`.

### Findings worth remembering
- Owner could never appoint a CEO under strict "grant ⊆ own" (Owner lacks payroll) → Owner grants any role to others; founder = Owner + CEO; no self-change.
- Concurrency: without serialization two Owners demoting each other both succeed (`[200,200]`, zero Owners) — proven with a forced-overlap test (table lock + polling pg_stat_activity as superuser; non-superusers can't see others' wait states).
- Audit cursor by UUIDv7 id (timestamps lose microseconds in JS).
- Mutation checks (each made its test fail): invitation email match, MFA block, role-change lock, canGrant, missing @ApiContract.

### State
- Uncommitted: all 1.3b work. Dev DB migrated (0004/0005 applied with `pnpm db:setup`) and contains rehearsal data (`rehearsal-*`). Owner's `pnpm dev` was running and auto-reloaded. Rehearsal emails and cookie jars deleted; owner's Mailpit has only their own 2 emails.

### Verification (last run)
- `pnpm check`: **184 passed** (i18n 4, contracts 27, db 32, api 121). `pnpm security`: 1 moderate (accepted), licences OK (156), no leaks.
- Cold PowerShell rehearsal with `pnpm http`: create company → sign-in on company host → MFA_REQUIRED → enable + confirm 2FA → members 200 → invite → invitee signs up, signs in on company host, accepts → roles employee → members 403 → audit lists events.

### Next step
Owner tests (needs an authenticator app on the phone for two-factor; the secret can be typed in manually from the `totpUri`), approves 1.3b, says whether to commit → Milestone 1.4 plan (design system & shell).

---

## 2026-10-27 — Session 3 (continued): 1.3a approved + committed, 1.3b planned

### Where we finished
**Milestone 1.3a approved by the owner and committed `253b180`.** Milestone 1.3b plan presented and the owner's decisions recorded (project-status "Decisions 2026-10-27"). Building 1.3b starts now: first `docs/modules/access.md`.

### Decisions (owner, 2026-10-27)
- Fixed system roles now (Owner, CEO, Manager, Team Leader, Employee, Finance, HR/Payroll, Technical Admin); custom roles later.
- Sensitive roles blocked until two-factor is set up; no trusted device for them.
- Only Owner and CEO can invite; invitations expire after 7 days; verified matching email required.
- One account can belong to several companies.
- Defaults: audit log readable by Owner/CEO, kept indefinitely pending legal retention; OpenAPI docs dev-only.

### State
- Clean working tree after commit `253b180` (plus this entry). Owner's `pnpm dev` may be running. My orphan node processes from 19:56 (local) still exist; harmless, gone after a reboot.
- Verification at commit: `pnpm check` 134 passed (i18n 4, contracts 5, db 32, api 93); `pnpm security` 1 moderate (accepted), licences OK, no leaks.

### Next step
Write `docs/modules/access.md` (spec), then implement 1.3b: onboarding (tenant + subdomain + Owner membership, reserved slugs), invitations, RBAC permission keys + scopes in `packages/contracts`, server-side authorization guard, self-elevation and last-owner protection, MFA enforcement for sensitive roles, tenant sign-in requiring active membership, append-only audit log (DB-enforced), OpenAPI. Tests incl. invalid/expired/mismatched invitations, self-elevation, permission matrix, audit immutability, cross-tenant. Hand over in §22 A–H.

---

## 2026-10-27 — Session 3: owner re-testing Milestone 1.3a

### Where we finished
Milestone 1.3a still **awaiting owner approval**, uncommitted (last commit `097350e`). No code changes.

### Done
- Docker Desktop was not running after a reboot; started it. The dev containers came back on their own (`restart: unless-stopped` confirmed working).
- Re-ran from scratch: `pnpm check` **131 passed** (i18n 4, contracts 5, db 32, api 90); `pnpm security` 1 moderate (accepted), licences OK (156), no leaks.
- Rehearsed the owner's PowerShell steps cold with `rehearsal…@example.com` addresses (so `omar@example.com` stays unused): sign-up → email → verify → sign-in → me → sessions → 6 wrong passwords (5× INVALID_CREDENTIALS, then RATE_LIMITED) → lock email. All correct.
- Found a display pitfall: PowerShell shows `signe...` / blank lines when several result types print in one go. Owner steps now pipe to `ConvertTo-Json` / `Format-List`.
- API dev server stopped so the owner can run `pnpm dev`; Docker services left running.

- Owner's step 5 returned UNAUTHENTICATED. Cause (checked in DB + Mailpit, not guessed): omar@example.com was never verified — the owner clicked **my rehearsal emails** (same subject) left in the Mailpit inbox, which verified the rehearsal accounts instead. Deleted the rehearsal emails; owner continues from step 3. My mistake.

- Second retry still EMAIL_NOT_VERIFIED: the owner's email was still unopened (browser likely showing the stale Mailpit list). Found a real bug: the HTML email showed the link as plain text (not clickable). Fixed: `renderHtml()` in `platform/mail/mailer.ts` (escaped text, clickable links, RTL for Arabic) + `mailer.spec.ts` (3 tests). Typecheck + lint pass.
- While editing, the mailer briefly had a syntax error; the owner's auto-reloading `pnpm dev` stopped listening (port 3000 down). My earlier dev run (started 19:56 local) also left orphan node processes after TaskStop; stopping them was (rightly) blocked as a permission decision for the owner.

- Owner restarted `pnpm dev` (first command was sent before the server was ready), resent verification, clicked the new clickable link, signed in: DB confirms omar@example.com verified + 1 active session (steps 1–5 passed). Steps 6–7 (sign-out, lockout) handed to the owner.

### Notes for next session
- Suggest the owner enables Docker Desktop → Settings → General → "Start Docker Desktop when you sign in".
- After rehearsing steps, clean up what the owner will see (e.g. delete rehearsal emails from Mailpit).
- Don't edit code while the owner's dev server is running without warning them; prefer making edits in one valid step.
- TaskStop of `pnpm dev` can leave child node processes behind on Windows; check with Get-NetTCPConnection -LocalPort 3000 before handing over.

### Next step
Wait for the owner's test results and approval of 1.3a (and whether to commit), then plan 1.3b.

---

## 2026-10-25 — Session 2 (continued): Milestone 1.3a Identity built

### Where we finished
**Milestone 1.3a (Identity) is built and verified, awaiting the owner's review and approval. NOT committed** (last commit `097350e` = 1.2). Do not start 1.3b until the owner approves 1.3a.

### Done
- Spec `docs/modules/identity.md` written first (purpose, brief §8 coverage, data, API, security, acceptance criteria, test plan) and updated with implementation notes.
- DB: migrations `0002_identity_tables` (accounts, sessions, verifications, two_factors, used_totp_codes, user_known_devices, rate_limit_buckets; users + image/two_factor_enabled/locale) and `0003_identity_security` (least-privilege grants, triggers). New catalog guard: tables without tenant_id must be on a reviewed allow-list.
- New `packages/i18n` (EN/AR email catalogs; AR machine-drafted, needs native review; key/placeholder parity tests).
- API platform: `Mailer` (SMTP, bilingual), `RateLimiter` (Postgres fixed windows, hashed keys, Retry-After), `ZodValidationPipe` (strict), origin-check (CSRF), `NoStoreInterceptor`, client IP from socket, query-string redaction in request logs.
- API identity module: Better Auth 1.7.13 (handler not mounted; telemetry off; hashed verification identifiers; generateId=false → uuidv7), 18 endpoints under `/api/v1/auth`, SessionGuard (12 h absolute lifetime), TOTP replay ledger, new-device and lockout notices, breached-password checker (HIBP range, fails open, switchable).
- Lint: business modules may not import identity tables; identity module is the reviewed exception for the unscoped DB handle.

### Findings worth remembering
- Better Auth: TOTP codes reusable within the window (we added a ledger); its rate limiter doesn't apply to `auth.api` calls; telemetry on by default; tokens stored plain by default; `@Header` can't decorate a class in Nest 12.
- Request logs included `?token=` — fixed platform-wide; verified live (only the pre-fix line contains a token).
- `nodemailer` is MIT-0 → added to licence allow-list. Moderate esbuild advisory accepted (security.md §2b).
- Mutation checks: disabling replay protection, lockout, absolute lifetime, or the CSRF check each made its test fail.

### State
- Uncommitted: all 1.3a work. Local `.env` got AUTH_SECRET, APP_PUBLIC_URL, SMTP_HOST, SMTP_FROM, PASSWORD_BREACH_CHECK (via env:init). Docker services running (auto-restart). API stopped.

### Verification (last run)
- `pnpm check`: **131 passed** (i18n 4, contracts 5, db 32, api 90), 0 failed. `pnpm security`: 1 moderate (accepted), licences OK (156 packages), no leaks.
- Live PowerShell walkthrough (owner can repeat): sign-up → 202; sign-in before verify → EMAIL_NOT_VERIFIED; email in Mailpit; open link → ok; sign-in → signed_in; me; sessions; sign-out; me → UNAUTHENTICATED.

### Next step
Owner reviews 1.3a (hand-over A–H). After approval (+ commit if asked): Milestone 1.3b — plan + decisions first: onboarding (company + subdomain + Owner membership), invitations (verified matching email), RBAC permission keys + scopes from permissions.md, MFA required for sensitive roles (and no trusted device for them), append-only audit log, OpenAPI.

---

## 2026-10-25 — Session 2 (continued): 1.2 approved and committed, 1.3 planned

### Where we finished
**Milestone 1.2 approved by the owner (tested it themselves) and committed `097350e`.** Milestone 1.3 plan presented and the owner's decisions recorded. **Next: start Milestone 1.3a when the owner says go.** Nothing uncommitted except this log entry.

### Decisions (owner, 2026-10-25)
- Split 1.3 → **1.3a Identity** (sign-up, email verification, login, password reset, TOTP MFA + recovery codes, sessions, rate limits, remembered device, breached-password check, new-device notice, strict validation, `users` row rules) and **1.3b Access** (self-service onboarding, invitations, RBAC + scopes, MFA enforcement for sensitive roles, audit log, OpenAPI). See roadmap.
- Company creation: self-service for anyone after email verification.
- MFA: required for sensitive roles; optional for others; tenant may require for all.
- Defaults accepted without objection: passwords ≥ 12 chars + breached check (switchable off for offline on-prem); session idle 30 min / absolute 12 h; remembered device skips MFA prompt only, 30 days, never for sensitive roles.

### Findings
- Better Auth advisory check: latest **1.7.13**; ADR-0004's minimum 1.6.11 is no longer safe (GHSA-qq9h-g4jm-xgf3, high, fixed 1.6.22). ADR-0004 amended; email-OTP / magic-link sign-in will not be enabled.

### State
- Docker services running with `restart: unless-stopped`; dev DB seeded (acme, globex). API not running.

### Next step
Milestone 1.3a: first write `docs/modules/identity.md` (purpose, data, dependencies, permissions, acceptance criteria, test plan, brief §8 coverage), verify Better Auth 1.7.13 docs for NestJS/Express + Drizzle adapter + twoFactor plugin + uuid ids mapped onto our `users` table, then implement with tests (expired/reused OTP and reset tokens, throttling, session revoke/fixation, unverified email blocked) and hand over in §22 A–H format.

---

## 2026-10-25 — Session 2: owner re-verification of Milestone 1.2

### Where we finished
Milestone 1.2 still **awaiting owner approval**, uncommitted. No code changes this session.

### Done
- Re-ran verification for the owner. First attempt: db tests "31 skipped" because **Docker Desktop was not running** after a restart (not a code problem). Started Docker, re-ran: `pnpm check` **80 passed** (5 + 31 + 44), `pnpm security` clean (no vulnerabilities, 124 packages licence-OK, no leaks).
- Gave the owner a step-by-step self-check (pnpm check, pnpm security, db:seed + dev, browser URLs, `curl.exe` spoof test, verbose isolation tests).

- **Owner hit a bug following my steps:** `pnpm db:seed` failed with `ECONNREFUSED 127.0.0.1:5432` — after the Docker restart the dev containers were stopped (tests passed because they use their own containers), and my steps ran the seed before anything started the services. Fixed:
  - `infra/compose/compose.dev.yaml`: `restart: unless-stopped` on all three services (verified in `docker inspect`).
  - `pnpm db:seed` now runs `services:up` → `db:setup` → seed; `services:up` runs `init-env` itself; `pnpm dev` simplified accordingly.
  - New `packages/db/src/cli/run.ts`: CLI commands print one plain sentence for known problems (DB unreachable, bad password, missing DB/tables) instead of a stack trace. Verified with services stopped.
  - Re-verified: owner's exact command `pnpm db:seed` in PowerShell from stopped containers → services started, roles, migrations, both demo tenants, exit 0. `pnpm check` 80 passed; `pnpm security` clean.

### Notes for next session
- On Windows PowerShell `curl` is an alias for Invoke-WebRequest; tell the owner to use `curl.exe`.
- If tests show "skipped" or Docker connection errors, check Docker Desktop first.
- When giving the owner manual steps, run them myself first in PowerShell from a cold state (services stopped).

### Next step
Wait for the owner's result and approval of 1.2 (and whether to commit). Then Milestone 1.3 plan (see Session 1 entry).

---

## 2026-10-24 — Session 1: Phase 0 approval → Milestone 1.1 → brief review → Milestone 1.2

### Where we finished
**Milestone 1.2 (Tenancy & isolation) is built and verified, awaiting the owner's review and approval.** Do not start Milestone 1.3 until the owner approves 1.2 (brief §3 Rule 1, §22).

### Done this session
1. **Milestone 1.1 — Skeleton** (approved by owner, committed `c3d09be`): pnpm 12 + Turborepo monorepo, TypeScript 6.0.3 strict, ESLint/Prettier, Vitest; Docker Compose (Postgres 18.6, RustFS, Mailpit); NestJS 12 API with validated config, redacted Pino logs, correlation IDs, standard errors, Helmet, CORS allow-list, body limit, `/health` + `/health/live`; CI workflow.
2. **Brief compliance review + follow-up** (in `c3d09be`): CI `security` job (pnpm audit, licence allow-list, gitleaks — verified with a planted token); fixed high CVE in multer via pnpm override; created `requirements-checklist.md`, `testing.md`, `api.md`; evidence register; security/domain/architecture/roadmap gaps filled (Milestone 1.5 added, expenses as Phase 12b).
3. **Owner saved the full brief** as `docs/product-brief.md` (§1–25). Checklist now covers §22–25 too.
4. **Milestone 1.2 — Tenancy & isolation** (NOT committed yet):
   - `packages/db`: Drizzle 0.45.4 schema (`users`, `tenants`, `tenant_domains`, `memberships`), migrations `0000_foundation_tables.sql` (generated) and `0001_foundation_security.sql` (roles' grants, ENABLE+FORCE RLS, policies, `updated_at` triggers, `app.current_tenant_id()`, `app.resolve_tenant_by_host()`), `withTenant`, `assertSafeAppRole`, admin bootstrap/migrate, dev seed, Testcontainers helper.
   - DB roles: `erp_migrator` (owner), `erp_app` (API, no BYPASSRLS), `erp_platform` (NOLOGIN, tenant directory only).
   - API: `TenantDatabase` (only data path), `DatabaseRoleCheck` (refuses superuser/BYPASSRLS → 503), tenancy module (host → tenant middleware on all routes except health, `@CurrentTenant()`, `GET /api/v1/tenant`).
   - Lint: `import-x/no-cycle` (needed `importX.flatConfigs.typescript.settings` — without it the rule silently did nothing) and `no-restricted-imports` for business modules.
   - Docs: new `database.md`; ADR-0003 implementation notes; compliance evidence; testing, api, README, roadmap, checklist updated.

### State of the repo
- Branch `main`. Last commit `c3d09be` (1.1). **All Milestone 1.2 work is uncommitted** — commit after owner approval if they ask ("commit only when the owner asks").
- Owner's local `.env` was updated: `DATABASE_URL` now uses `erp_app`; `DATABASE_MIGRATOR_URL` and `DATABASE_ADMIN_URL` added.
- Docker services (postgres, object-storage, mailpit) were left **running**; dev DB has roles, migrations and the demo tenants `acme` / `globex` seeded. API dev server is stopped.
- No GitHub remote yet, so CI has never run on GitHub.

### Verification (last run, 2026-10-24)
- `pnpm check`: format ✅, lint ✅, typecheck ✅, tests **80 passed** (contracts 5, db 31, api 44), 0 failed.
- `pnpm security`: no known vulnerabilities; licence check passed (124 production packages); gitleaks no leaks.
- Mutation check: replacing the isolation policy with `USING (true)` made 10 isolation tests fail (then restored).
- Live: `acme.localhost:3000/api/v1/tenant` → Acme; `globex.localhost` → Globex; unknown host → 404; `X-Forwarded-Host` spoof ignored; `/health` up.

### Decisions made this session (all recorded in docs)
- TypeScript 6.0.3 not 7 (typescript-eslint support); NestJS 12 ESM; Drizzle stable 0.45 not 1.0-rc; RustFS instead of MinIO (ADR-0002 amendments).
- Expenses module included as Phase 12b (owner: "do whatever").
- `users` is global, no RLS yet — decide row rules with Better Auth in 1.3.
- Companies and memberships are never deleted (status instead).

### Open items / waiting on owner
- **Approve Milestone 1.2** (manual verification steps in the 1.2 hand-over / `project-status.md`).
- Whether to commit 1.2 once approved.
- GitHub remote (so CI runs).
- Legal review items (compliance.md ⚖️), trademark search, platform domain name — not blocking yet.

### Next step (after approval)
Milestone 1.3 — Identity & access: Better Auth ≥ 1.6.11 (verify latest + advisories first), sign-up, email verification via Mailpit, login, TOTP MFA + recovery codes, password reset, sessions list/revoke, remembered devices, rate limits, suspicious-login notices; company onboarding (creates tenant + subdomain + owner membership); invitations (verified email must match); RBAC with permission keys + scopes from `permissions.md`; append-only audit log; OpenAPI generation; strict request validation; decide `users` row rules. Start by writing the 1.3 plan + decisions for the owner (brief §22), and check `requirements-checklist.md` rows tagged 1.3.
