# Security Design

Status: **Draft — Phase 0.** Targets OWASP ASVS 5.0 Level 2 for the whole app, Level 3 controls for auth, payroll and financial modules. Targets are not claims of compliance.

## 1. Top risks and how the architecture addresses them

| # | Risk | Mitigation | Verified by |
|---|---|---|---|
| R1 | Cross-tenant data leak | ADR-0003: host-based tenant resolution, membership check, forced RLS, composite FKs, tenant-prefixed storage, tenant-scoped jobs. | Cross-tenant test suite per module (release-blocking). |
| R2 | Broken access control / IDOR within a tenant | Server-side permission + scope check in every service method; deny by default; resource ownership checks; no permission logic only in UI. | Permission matrix tests generated from `permissions.md`. |
| R3 | Account takeover | Better Auth ≥1.6.11, MFA (mandatory for sensitive roles), rate limiting + progressive throttling, breached-password check, session revocation, new-device notification. | Auth integration tests, OTP replay/expiry tests. |
| R4 | Privilege escalation via role edits | Role changes need `access.roles.manage`; nobody can grant permissions they don't hold; self-elevation blocked; all changes audited; owner role transfer requires re-authentication + MFA. | Negative tests. |
| R5 | Financial / payroll tampering | Separation of duties (preparer ≠ approver), immutable issued records, correction via new records, idempotency keys, row locks, audit with before/after. | Concurrency + duplicate-submission tests. |
| R6 | Injection (SQL/XSS) | Parameterized queries only (Drizzle), Zod validation, React auto-escaping, strict CSP, no `dangerouslySetInnerHTML` without sanitizer, rich text sanitized server-side. | Lint rules, SAST, tests with payloads. |
| R7 | CSRF | SameSite cookies + CSRF token / origin check on state-changing requests. | Integration tests. |
| R8 | Unsafe file uploads | Allow-list MIME + magic-byte sniffing, size limits, randomized keys, never served from app origin, `Content-Disposition: attachment`, malware scanning hook (ClamAV optional on-prem). | Upload tests with malicious samples. |
| R9 | Sensitive data in logs | Pino redaction list (passwords, tokens, OTPs, salaries, civil IDs, IBANs); audit stores diffs only for whitelisted fields. | Log-redaction unit tests. |
| R10 | Supply chain / vulnerable deps | Lockfile, `pnpm audit` + Dependabot/Renovate, pinned versions, minimal deps, advisory watch for Better Auth/NestJS/Drizzle. | CI gate. |
| R11 | Secrets exposure | `.env` git-ignored, `.env.example` placeholders only, secrets via environment/secret manager, config validated at boot. | Secret-scan in CI (gitleaks). |
| R12 | Notification/announcement leaks or mass-send accidents | Recipient set resolved server-side with authorization; announcements require permission, preview + confirmation with recipient count; rate limited; audited. | Tests. |
| R13 | QR attendance spoofing | Short-lived signed rotating codes, authenticated check-in, server time, replay protection, optional geofence; corrections audited. | Phase 10 tests. |
| R14 | Developer/technical admin seeing business data | Technical admin role has system permissions only (health, logs without PII, integrations); no business-data permissions by default; support access to tenant data is time-boxed, tenant-approved and audited. The founder's platform console (Phase 17, §2f) sees a company directory only. | Permission tests; `platform.spec.ts`. |
| R15 | Data breach response (Kuwait: 24h CITRA notification) | Incident runbook (operations.md §7), audit trail, alerting. | Tabletop walk-through 2026-10-31 (operations.md §7). |

## 2. Baseline controls (Phase 1 must deliver)

- HTTPS only; HSTS; security headers (CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors none).
- Strict CORS: only the tenant web origins.
- Rate limits: login, OTP verify, password reset, invitation accept, exports, uploads, report runs (15b).
- Uniform error responses with codes; no stack traces outside dev.
- Correlation ID on every request and log line.
- Audit log append-only (app role has INSERT/SELECT only; no UPDATE/DELETE grant).
- Input validation on every endpoint; unknown keys rejected.
- Request body size limits.
- Session: idle timeout + absolute lifetime; rotate on login and privilege change; list/revoke sessions.

## 2a. Further requirements (from the product brief)

| Topic | Design | When |
|---|---|---|
| Remembered devices | Optional "trust this device for 30 days" skips the MFA prompt only (never the password); stored as a signed, hashed device token bound to user + tenant; listed and revocable with sessions; disabled for roles holding sensitive permissions; tenant can turn it off. | 1.3 |
| Suspicious login | New device / new country / impossible-travel heuristics ⇒ email notification + audit event; repeated failures ⇒ progressive throttling, then temporary lock with email unlock; breached-password check at sign-up and reset. | 1.3 |
| Session fixation | Session ID rotated on login, MFA completion and privilege change; old ID invalidated. | 1.3 |
| SSRF | Any server-side fetch of a user-supplied URL (webhooks, integrations, logo import, e-signature callbacks) goes through one egress helper: https only, DNS resolved and private/link-local/metadata ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7) blocked, no redirects to blocked ranges, short timeouts, size limit. No such feature exists yet; the helper ships with the first one. | First integration |
| Real-time updates | Not used yet. If added (likely Server-Sent Events for notifications in Phase 13), each stream is authenticated, bound to one tenant + user at connect time, re-checks authorization per event, and is covered by the cross-tenant suite. | 13 |
| Notifications and deep links | Recipient set resolved server-side; deep links carry only IDs; opening one re-checks authorization (a link never grants access). | 1.5 / 13 |
| Exports and reports | Run through the RLS connection with the requester's permissions; confidential exports require `exports.confidential`, MFA-fresh session, and are audited with row counts. | 14 |
| Secrets management | Dev: `.env` (git-ignored). SaaS: platform secret manager injected as env vars. On-prem: customer-managed env/secret files (`*_FILE` variants). Never in images, logs or the database in plain text. | 1.1 / 15 |

## 2c. Phase 15b review: production configuration, proxies, headers, limits (2026-10-31)
Found by running the production compose file end to end (`pnpm deploy:verify`) and by review; all fixed and covered by tests.

| Finding | Risk | Fix | Evidence |
|---|---|---|---|
| Behind the web container's nginx every request had nginx's address | All users in one rate-limit bucket (one attacker throttles everyone; the sign-up limit applies to the whole install); audit log without real addresses | `TRUST_PROXY_HOPS`: the client address is read that many hops from the right of `X-Forwarded-For`; Express "trust proxy" stays off, so `X-Forwarded-Host` can never choose the company; nginx removes it | `client-ip.spec.ts`, `hardening.spec.ts`, deploy test (audit shows the browser's address, not the proxies') |
| nginx forwarded `Host` without the port | On any non-standard https port every form submission refused as cross-site | nginx forwards `$http_host` | deploy test (journey on port 8443) |
| Security headers missing on the app's pages | nginx drops server-level headers in a location with its own: pages had no Referrer-Policy / Permissions-Policy, no HSTS anywhere | One header file included in every location; added HSTS (incl. subdomains), X-Frame-Options, COOP, CORP | deploy test header checks |
| A second pooled connection taken inside a company transaction (account names) | Under concurrent use the pool runs dry: requests stall 2 s and fail with 500 | Read-only identity lookups use the open transaction's connection (`ambient-transaction.ts`); a probe run of the whole API suite found no other nested connection use | `hardening.spec.ts` (20 parallel requests on a 2-connection pool: all 200; 500s without the fix) |
| Example on-prem setup could not start | `SENTRY_DSN: ${SENTRY_DSN:-}` gave an empty, invalid URL | Empty variables count as unset | `config.spec.ts`, deploy test |
| Unsafe production settings accepted | Example secrets, localhost addresses, http, missing file storage, placeholder passwords | Production guard (operations.md §5); fail-fast database-role check at start-up | `config.spec.ts` |
| No limits on exports, uploads, report runs | Bulk data exfiltration speed, storage / scanner / database load | Per-member limits: 30 exports/h, 100 uploads/h, 120 report runs/10 min (`route-limit.ts`), 429 + Retry-After | `hardening.spec.ts` |
| `NAME_FILE` secrets promised (§2a) but not implemented | Secrets only via plain environment variables | `withFileValues` in the API and backup tool | `config.spec.ts` |
| Docker build context included local `backups/` | Real (encrypted) data inside build layers | `.dockerignore` | — |
## 2d. Phase 15d security review (2026-10-31): each risk with its evidence
Internal review, not a substitute for the external penetration test recommended before the first paying customer (hardening.md §3).

| Risk | Status | Evidence (automated unless stated) |
|---|---|---|
| R1 Cross-tenant leak | ✅ Controlled | `packages/db/test/isolation.spec.ts` (forced RLS on every company table — catalogue guard fails for any new table without it; B cannot read/write/link A), cross-tenant cases in every module suite, `hardening.spec.ts` (company from Host only), restore drill keeps isolation (`backup.spec.ts`) |
| R2 IDOR / access control | ✅ Controlled | `access.spec.ts` permission matrix, 404 for records outside scope in each module suite |
| R3 Account takeover | ✅ Controlled | `identity.spec.ts` (MFA, lockout, throttling, session revoke, reset tokens), `breached-password.spec.ts`; client address correct behind proxies (`client-ip.spec.ts`) |
| R4 Privilege escalation | ✅ Controlled | `access.spec.ts` (role changes need permission, no self-elevation, audited) |
| R5 Financial / payroll tampering | ✅ Controlled | `payroll.spec.ts`, `billing.spec.ts`, `expenses.spec.ts` (separation of duties, immutable issued records — database triggers) |
| R6 Injection | ✅ Controlled | Drizzle parameters only; long ID lists as one validated array parameter (`sql-helpers.ts`); Zod validation (`http.spec.ts`); CSP on app and API (deploy test) |
| R7 CSRF | ✅ Controlled | SameSite cookies + Origin check (`http.spec.ts`; proven on a non-standard port by the deploy test) |
| R8 Unsafe uploads | ✅ Controlled | `files.spec.ts` (content sniffing, size, ClamAV, attachment-only signed links); upload limit (`hardening.spec.ts`) |
| R9 Sensitive data in logs / telemetry | ✅ Controlled | `logger-options.spec.ts`, `monitoring.spec.ts` (scrubbing), `telemetry.spec.ts` (no query strings/addresses in traces) |
| R10 Supply chain | ✅ Controlled | `pnpm security` in CI: audit (1 moderate accepted, §2b), licence allow-list, notices up to date |
| R11 Secrets exposure | ✅ Controlled | gitleaks in CI; production guard refuses example secrets and placeholders (`config.spec.ts`); `NAME_FILE` secrets; backups excluded from images |
| R12 Mass-send accidents | ✅ Controlled | `announcements.spec.ts` (count confirmation, daily limit, audit) |
| R13 QR attendance spoofing | ✅ Controlled | `attendance.spec.ts` (rotating signed codes, replay protection) |
| R14 Technical admin sees business data | ✅ By design | The only platform access path is the Phase 17 console (§2f): directory facts through checked `SECURITY DEFINER` functions, no business data, no company context (`platform.spec.ts`: a client name never appears, the founder gets 404 on a company's `/clients`). `erp_platform` stays NOLOGIN. Support access into a company is still not built (would need tenant approval, a time limit and audit) |
| R15 Breach response (Kuwait CITRA 24 h) | 🟡 Runbook ready | `operations.md` §7 incident runbook + tabletop walk-through 2026-10-31; legal confirmation of the notification duty is an owner item (compliance.md ⚖️) |
## 2e. Phase 16 (2026-11-01): the mobile app's session transport

- **What changed on the server:** one middleware (`platform/request-context/header-session.middleware.ts`). A request that carries `X-Auth-State` is treated as a cookie-less client: the header's content (base64url JSON of cookie name → value, ≤ 8 KB, names `[A-Za-z0-9_.-]`, values printable ASCII without `;`) becomes the request's `Cookie` header, and every `Set-Cookie` the response would carry is moved into the response's `X-Auth-State` header instead. Nothing else changed: Better Auth, the guards, rate limits, two-factor, hand-off and audit run exactly as for a browser.
- **Why it is safe:** the values are the same HMAC-signed cookies a browser would hold, so a tampered state is simply an invalid session (tested). Browsers never attach a custom header by themselves (a cross-site page would need CORS approval for it), so a header-state request carries no ambient credential — that is why the Origin check does not apply to it (a POST with a foreign Origin is still refused when it relies on cookies; tested). A malformed header is refused with 400 before anything else runs.
- **On the device:** the state lives in the iOS Keychain / Android Keystore (`expo-secure-store`), one per host (main address, company address). Signing out removes it locally and ends the sessions on the server. The 30-minute idle and 12-hour absolute limits apply unchanged; after them the app shows the sign-in screen.
- **What the app never does:** choose a company by ID (hosts, as on the web), hold a long-lived refresh token, store passwords, or decide permissions — it only hides what `/access/me` says the person cannot do.
- **Not in this phase:** push notifications (would need an Expo/APNs/FCM account), certificate pinning (consider for the store build), biometric unlock of the app (the OS lock protects the secure store).
- **Evidence:** `apps/api/test/mobile-session.spec.ts` (4), `apps/api/src/platform/request-context/header-session.middleware.spec.ts` (4), `apps/web/e2e/mobile-web.spec.ts` (EN + AR).

## 2f. Phase 17 (2026-11-01): the platform console access path

- **What it is:** a page on the main address (`/platform`) where the installation's founder sees every company (name, address, status, owners, number of people, pending invitations, last activity, file volume) and can suspend or reactivate a company with a reason. Spec: `modules/platform.md`.
- **Who may use it:** accounts listed in the global table `platform_operators`. Rows are written **only by the command-line tool** (`pnpm platform:founder <email> [--revoke]`, migrator role). The application role can read the table but not write it (tested: 42501), so no bug in the API can promote anyone.
- **The gate on every `/platform` route** (`PlatformGuard`): session (401) → main address only (404 on a company address) → operator (404 — non-operators cannot learn the console exists) → two-factor on (403 `MFA_REQUIRED`).
- **How it reads across companies without breaking isolation:** four `SECURITY DEFINER` functions in migration `0039` (`app.is_platform_operator`, `app.platform_companies`, `app.platform_overview`, `app.platform_set_company_status`). Each re-checks that the caller is an operator, uses a fixed `search_path`, is not executable by `PUBLIC`, and returns directory facts only. The console never opens a company transaction and never queries business tables; forced row-level security on company tables is unchanged.
- **Suspension:** sets `tenants.status = 'suspended'`; the host resolver accepts only active companies, so the company's address answers 404 and it disappears from members' company lists immediately. Reactivation reverses it. Nothing is deleted.
- **Audit:** every status change is written to the append-only `platform_audit_events` (actor, company, from → to, reason, request reference, client address); update, delete and truncate are refused by trigger (tested).
- **Not built (deliberately):** "log in as", support access into a company's data, granting through the API.
- **Evidence:** `apps/api/test/platform.spec.ts` (2 tests), `packages/db` global-table review, `apps/web/e2e/platform.spec.ts` (EN + AR, axe).

## 2g. Security audit 2026-11-08 (commercial-readiness review)

Method: an empirical attack sweep instead of re-reading earlier reviews, plus targeted code searches. Internal review — still not a substitute for the external penetration test.

**Cross-tenant attack sweep** (`apps/api/test/tenant-sweep.spec.ts`, runs in `pnpm test`). Company A is filled through the real API (people, department, team, client, contact, interaction, engagement letter + version, project, task, comment, time entry, leave request, issued invoice + payment, submitted expense claim, announcement). Every `id` of every company-owned table of A is then harvested from the database (catalogue query — new tables are included automatically). The Owner of company B (fully privileged in B, two-factor on) then:
1. sends **every route of the API, every method**, with each of A's ids in the path, on B's address;
2. sends every list route with A's ids in each id filter the route declares;
3. sends every company route to **A's address** directly (not a member);
4. sends every parameterised route with an empty body on **B's own** records (robustness).

Pass criteria: no 2xx for A's ids, no answer containing A's marker text or any of A's ids, no 5xx, and a fingerprint (md5 of every row) of all A's tables unchanged. A positive control proves the detector sees A's data when A's Owner asks.

Result (2026-11-08): **6,783 requests — 0 cross-tenant answers, 0 server errors, A unchanged** (after the fix below). Limits: mutation routes whose body fails validation (422) never reach the record lookup; those paths are covered by each module's own cross-tenant cases and by the unchanged fingerprint.

| # | Severity | Finding | Affected | Fix | Verified |
|---|---|---|---|---|---|
| S1 | Medium | An empty update body `{}` passed validation and crashed with 500 (empty SQL `SET`). No data exposure, but unhandled errors on authenticated routes and noisy error reports. | `PATCH /teams/:id`, `/departments/:id`, `/leave/types/:id`, `/attendance/sites/:id`, `/attendance/shifts/:id` (same shape: `PATCH /clients/:id/contacts/:childId`) | Contract rule `hasAnyField` (`packages/contracts/src/update.ts`): an update must change at least one field → 422 `empty_update` | Sweep part 4: 0 × 5xx (was 200) |
| S2 | Low | The demo seed had one fixed password for every demo account in source code. | `apps/api/test/demo/demo-seed.ts` | Random password per run (or `DEMO_PASSWORD`), written only to the git-ignored `demo-credentials*.local.md` | Code review; seed still dev-only (refuses unless `NODE_ENV=development`, `APP_PROFILE=dev`) |
| S3 | Info | `dangerouslySetInnerHTML` in My account | `apps/web/src/routes/account.tsx` (two-factor QR) | None needed: the SVG is generated in the browser by the `qrcode` library from the server's `otpauth://` URI; no user-controlled markup | Code review |
| S4 | Info | No raw SQL (`sql.raw`, `unsafe`) in the API; browser storage holds only display preferences (language, theme), never tokens; sessions are HttpOnly cookies | — | — | Code search |

## 2b. Accepted risks (reviewed)
| Finding | Why accepted | Revisit |
|---|---|---|
| GHSA-67mh-4wv8-2f99 (moderate): esbuild ≤ 0.24.2 dev server lets websites read responses. Reaches the production tree via better-auth → drizzle-kit (optional peer auto-installed) → @esbuild-kit. | Only affects esbuild's development *server*, which nothing in this project runs; below the CI gate (high/critical). 2026-10-25. | On each better-auth / drizzle-kit upgrade; remove when drizzle-kit drops @esbuild-kit. |

## 3. Sensitive data classification

| Class | Examples | Handling |
|---|---|---|
| Restricted | Salaries, payslips, bank details/IBAN, civil ID, medical leave documents, MFA secrets | Field/resource-level permissions, excluded from logs and general exports, encrypted at rest (DB volume + column-level for secrets/IBAN), access audited. |
| Confidential | Client contracts, engagement letters, invoices, audit findings | Permission-controlled, signed download URLs, audited exports. |
| Internal | Tasks, projects, timesheets | Tenant + scope permissions. |
| Public | Marketing pages | — |

## 4. Outstanding / to decide
- Column-level encryption key management (KMS in SaaS vs. customer-provided key on-prem).
- Data retention schedules per record type (needs Kuwaiti legal input: labour, tax/commercial record retention).
- Penetration test before first paying customer.
- Backup, deletion and retention policies per record type (needs legal input; see `compliance.md`).
