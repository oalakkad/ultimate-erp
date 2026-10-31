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
| R14 | Developer/technical admin seeing business data | Technical admin role has system permissions only (health, logs without PII, integrations); no business-data permissions by default; support access to tenant data is time-boxed, tenant-approved and audited. | Permission tests. |
| R15 | Data breach response (Kuwait: 24h CITRA notification) | Incident runbook, audit trail, alerting. | Phase 15 tabletop. |

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
