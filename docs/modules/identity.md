# Module spec: Identity (Milestone 1.3a)

Status: **Approved 2026-10-27 (Milestone 1.3a).** Owner decisions 2026-10-25: self-service sign-up after email verification; MFA required for sensitive roles (enforced in 1.3b once roles exist); defaults below accepted.

## 1. Purpose and fit
Answers "**who are you?**" for every later module: people create an account, prove they own their email, sign in (with two-factor where required), recover access, and control their sessions. It does **not** answer "what may you do here?" — that is the access module (1.3b: memberships, roles, permissions). Identity is global: one person, one account, possibly several companies.

## 2. Brief coverage (§8 Authentication)
| Brief requirement | How |
|---|---|
| Established framework, no homemade OTP | Better Auth 1.7.13 (ADR-0004, amended); TOTP via its two-factor plugin |
| Secure login, email verification | Email + password; sign-in refused until the email is verified |
| MFA + recovery codes | Authenticator-app TOTP (RFC 6238) + 10 one-time backup codes; codes encrypted at rest by Better Auth |
| Password reset | Emailed single-use token, 1 h expiry; all sessions revoked on reset |
| Session management, expiry, logout one/all | Idle 30 min (sliding), absolute 12 h (our guard), list / revoke one / revoke others / sign out |
| Remembered devices | "Trust this device" skips **only** the MFA prompt, 30 days, signed cookie; disallowed for sensitive roles from 1.3b |
| Rate limiting, credential stuffing, progressive throttling | Postgres-backed limits per IP and per account; 5 failed sign-ins in 15 min ⇒ account locked 15 min + email notice; two-factor lockout after 5 wrong codes |
| Suspicious-login detection | New-device email on first sign-in from an unseen browser |
| OTP replay protection | Our own used-code ledger: a TOTP code works once per user (Better Auth does not prevent reuse) |
| Breached passwords | Have I Been Pwned range API (k-anonymity: only 5 hash characters leave the server); switchable off for offline on-prem; fails open with a warning if the service is unreachable |
| Account enumeration | Sign-up, resend-verification and forgot-password always answer the same; an existing owner is emailed instead |
| No secrets in code | `AUTH_SECRET` from environment (≥ 32 chars), never defaulted |
| Secure invitation acceptance | 1.3b (access module) |

## 3. Data (migration 0002)
Global tables (not tenant-owned; one person spans companies), read/written only by this module and Better Auth:

| Table | Holds |
|---|---|
| `users` (+ `image`, `two_factor_enabled`, `locale`) | Account: name, email, verified flag, preferred language |
| `accounts` | Credential record (scrypt password hash); later SSO providers |
| `sessions` | Session token, expiry, IP, user agent |
| `verifications` | Email-verification and password-reset tokens |
| `two_factors` | Encrypted TOTP secret and backup codes, failed-attempt counter, lock |
| `used_totp_codes` | Hash of each accepted TOTP code per user (replay protection), pruned after 5 min |
| `user_known_devices` | Hash of each user agent seen per user (new-device notice) |
| `rate_limit_buckets` | Hashed limit keys with window counters |

**Row-level rule decision for `users`** (deferred from 1.2): these tables stay global without RLS, because sign-in must find an account before any company is known. Protection instead: (1) only the identity module may import them (lint rule), (2) the API never returns other users' rows from these tables, (3) tenant-scoped views of people go through memberships (RLS) in 1.3b.

## 4. API (all under `/api/v1/auth`, work on any host, standard error format)
| Method & path | Session | Purpose |
|---|---|---|
| POST `/sign-up` | — | Create account; sends verification email. Always `202`. |
| GET `/verify-email?token=` | — | Confirm email ownership |
| POST `/verify-email/resend` | — | Resend link. Always `202`. |
| POST `/sign-in` | — | `{status:"signed_in"}` + cookie, or `{status:"two_factor_required"}` |
| POST `/two-factor/verify` | pending 2FA | Complete sign-in with TOTP code (`trustDevice` optional) |
| POST `/two-factor/verify-backup-code` | pending 2FA | Complete sign-in with a backup code (single use) |
| POST `/sign-out` | yes | End this session |
| GET `/me` | yes | Current user + session |
| POST `/password/forgot` | — | Email a reset link. Always `202`. |
| POST `/password/reset` | — | Set new password with token; revokes all sessions |
| POST `/password/change` | yes | Requires current password; revokes other sessions |
| POST `/two-factor/enable` | yes | Requires password; returns `totpUri` (for QR) + backup codes; inactive until confirmed |
| POST `/two-factor/confirm` | yes | First valid code activates 2FA |
| POST `/two-factor/disable` | yes | Requires password |
| POST `/two-factor/backup-codes` | yes | Requires password; replaces backup codes |
| GET `/sessions` | yes | List own sessions (no tokens exposed) |
| DELETE `/sessions/:id` | yes | Revoke one own session |
| POST `/sessions/revoke-others` | yes | Revoke all other own sessions |

Bodies are strict Zod schemas from `packages/contracts` (unknown fields ⇒ `422 VALIDATION_FAILED`). New error codes: `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `INVALID_TOKEN`, `INVALID_CODE`, `PASSWORD_COMPROMISED`.

## 5. Dependencies
Platform: config, database (erp_app pool), errors, logging, request IDs. New: mailer (SMTP → Mailpit in dev; delivery retries/outbox move to Milestone 1.5), `packages/i18n` (bilingual email texts). Better Auth's HTTP handler is **not** mounted — only our controllers exist, so every route has our validation, errors, limits and logging. Better Auth telemetry is disabled.

## 6. Security notes
- Cookies: `erp.*`, httpOnly, SameSite=Lax, Secure when `APP_PUBLIC_URL` is https, host-only (scoped to the host that signed in).
- CSRF: state-changing requests carrying an `Origin` header must come from `APP_PUBLIC_URL` or `CORS_ORIGINS` (`403 FORBIDDEN` otherwise), on top of SameSite=Lax.
- Client IP for sessions/limits comes from the socket; `X-Forwarded-For` is ignored until a trusted proxy is configured.
- Logs: request bodies are not logged; passwords, tokens, codes are on the redaction list.

## 7. Acceptance criteria
1. A new user can sign up, receives a verification email (Mailpit), cannot sign in before verifying, can after.
2. Wrong password and unknown email give the identical `401 INVALID_CREDENTIALS`.
3. Five failed sign-ins lock the account for 15 minutes (even with the right password) and email the owner.
4. Reset tokens are single-use, expire after 1 h and are stored hashed. Email-verification tokens are signed, expire after 1 h and are bound to the email; reusing one only re-confirms the same address (harmless), and a tampered one is rejected.
5. Password reset revokes every existing session.
6. 2FA: enabling needs the password; sign-in then needs a code; a code cannot be reused; backup codes work once; trust-device skips the prompt on that browser only.
7. Sessions: list shows no tokens; revoking a session makes its cookie useless immediately; sessions die after 30 min idle or 12 h total.
8. A pre-set session cookie is never adopted at sign-in (session fixation).
9. Breached passwords are refused at sign-up, reset and change.
10. Unknown fields, cross-site `Origin`, and over-limit request rates are rejected in the standard error shape.

## 8. Test plan
Integration tests (`apps/api/test/identity.spec.ts`) against real PostgreSQL **and real Mailpit** containers, reading the actual emails, one test per acceptance criterion plus negative cases; unit tests for rate limiter, breached-password checker (incl. fail-open), Better Auth error mapping, i18n catalog completeness. Mutation-check the replay protection and lockout.

## 9. Implementation notes (found while building)
- Better Auth does not stop a TOTP code being reused inside its 30-second window → our `used_totp_codes` ledger (a replayed code's new session is deleted before any cookie is returned). Consequence: right after enabling two-factor, the same code cannot also be used to sign in; the next code works.
- Better Auth's built-in rate limiter only covers its own HTTP handler, which we do not mount → Postgres-backed `RateLimiter`.
- Better Auth ships telemetry → disabled. Verification identifiers stored hashed (`storeIdentifier: 'hashed'`, not the default).
- The automatic request log wrote full URLs including `?token=` → query-string values are now always redacted in logs (platform-wide).
- Emails are sent synchronously; a failed security notice is logged, a failed verification/reset email fails the request. Outbox with retries arrives in Milestone 1.5.

## 10. Out of scope (1.3b and later)
Company onboarding, invitations, roles/permissions, MFA enforcement by role, audit log (1.3b) · web screens (1.4) · email outbox/retries (1.5) · SSO, passkeys (post-MVP) · mobile bearer tokens (Phase 16).
