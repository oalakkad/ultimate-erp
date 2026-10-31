# Phase 15 — Hardening & release preparation

Spec and plan for Phase 15 (product brief §18 "Phase 15", §22). Written 2026-10-31, built in nonstop mode.
Each milestone ends with `pnpm check` + `pnpm security` (+ browser tests where relevant), a hand-over (A–H) in `session-log.md`, and a commit.

## 1. Goal
Show with evidence, not claims, that the system can be installed, run, backed up, restored, monitored and trusted with a real firm's data — and list exactly what is still needed from the owner before go-live.

## 2. Milestones

### 15a — Backup, restore and a clean install — ✅ done 2026-10-31 (`operations.md` §2–4)
- `pnpm backup`: database (`pg_dump` custom format, all schemas, roles' grants recorded) + object storage (mirror of the files bucket) + a manifest (version, migration number, row counts per table, checksums). Encrypted at rest with a key the operator supplies; the key never sits next to the backup.
- `pnpm restore`: into an empty database only (refuses to overwrite), recreates roles, verifies checksums, re-runs the manifest counts.
- **Restore drill test** (automated, Testcontainers): seed two companies → back up → restore into a fresh server → counts match, files download, *forced RLS still blocks company A from B*, the app role is still not superuser/BYPASSRLS.
- Fix the on-prem install gap: `compose.prod.example.yaml` says roles "must exist first" but nothing creates them. Add a one-shot `bootstrap` service (admin URL used once, never by the running app).
- Runbook `docs/operations.md`: backup schedule, retention, restore steps per profile (SaaS managed DB, on-prem), the encryption-key warning (losing `DATA_ENCRYPTION_KEY` = losing encrypted fields).

### 15b — Production configuration and deployment validation
- Production config guard: in `NODE_ENV=production` the API/worker refuse to start with dev defaults or example secrets, short/equal secrets, `http://` public URLs, API docs enabled, Mailpit/localhost SMTP, missing ClamAV, or a superuser DB role. One plain sentence per problem.
- **Deployment smoke test** (`pnpm deploy:verify`): build both images, bring up the prod compose with generated throw-away secrets, wait for health, then run a short browser smoke (sign up → company → client → invoice) against the containers, then tear down. Run in CI (`images` job).
- Staging profile documented (synthetic data only, architecture §7a); `.env` templates for `saas` and `onprem`.
- Security headers and rate-limit review against the running containers (CSP, HSTS, frame-ancestors, cookies `Secure`/`HttpOnly`/`SameSite`, limits on auth, exports, uploads, announcements). Findings fixed or recorded.
- `THIRD_PARTY_NOTICES` generated from production dependencies + font OFL texts (compliance.md obligation).

### 15c — Performance
- Volume seeder at the architecture §7b target: ~500 employees, ~5,000 projects, ~2 million time entries in one company (plus a second company to keep RLS honest).
- Load test with a Node script (autocannon, MIT — no new licence questions): sign-in, dashboard, task list, timesheet week, reports, invoice list, at realistic concurrency. Targets recorded in `docs/testing.md`; p95 per endpoint reported.
- `EXPLAIN (ANALYZE, BUFFERS)` on the slowest queries; index or query fixes only where measured.
- Web: route-level code splitting (the >500 kB bundle warning, open since Phase 2).

### 15d — Security, isolation, accessibility, monitoring, readiness
- **Isolation completeness test:** reads the PostgreSQL catalogue and fails if any table with a `tenant_id` lacks ENABLE + FORCE RLS and a policy, or is missing from the isolation test list — new tables can't slip through.
- Security review: walk `security.md` R1–R15 and the OWASP ASVS L2 sections that apply, with evidence per row (test name, file, or screenshot) in `compliance.md` §4. Dependency review (`pnpm audit` incl. moderate, outdated majors).
- Accessibility sweep: axe on every screen, EN + AR, light + dark; keyboard-only pass of the main journey.
- Monitoring: OpenTelemetry traces (ESM `--import` hook, off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set), verified end-to-end with a local collector; error-report and job-failure paths verified once more.
- Incident runbook + R15 tabletop (Kuwait CITRA 24-hour notification) in `docs/operations.md`.
- Documentation review (README, deployment, every module doc's §11 matches what is built).
- **Production readiness assessment** `docs/release-readiness.md`: each brief §18 Phase 15 item → evidence → status, and the owner go-live checklist.

## 3. Decisions (recommended option taken, owner can reverse — recorded in project-status.md)
1. **Backups:** logical `pg_dump` + bucket mirror built into the product (works for both profiles); for SaaS production additionally use the managed database's point-in-time recovery. *Alternative:* pgBackRest/WAL archiving now — more moving parts before there is a first customer.
2. **Default targets:** RPO 24 h on-prem (nightly) / ≤ 5 min SaaS (managed PITR); RTO 4 h; retention 30 daily + 12 monthly. To confirm with the first customer's contract.
3. **Load tool:** autocannon from a Node script rather than k6 (AGPL binary, separate install).
4. **Real cloud deployment is out of scope until the owner supplies an account, domain and SMTP provider** (nonstop-mode stop condition: credentials/payment). Phase 15 proves deployment on the production compose locally and in CI.
5. **External penetration test** is recommended before the first paying customer; Phase 15 does an internal review, not a substitute.

## 4. Needed from the owner before go-live (not blocking Phase 15)
Cloud account + region, platform domain + DNS, TLS, SMTP provider, error-monitoring choice, backup storage location, legal items in `compliance.md` (⚖️), payroll and leave rule verification, trademark search, external penetration test, GitHub remote so CI runs.
