# Module spec: Background jobs & notifications (Milestone 1.5a)

Status: **Built 2026-10-29, awaiting owner approval** (results in §9). Owner decisions 2026-10-28: Milestone 1.5 split into **1.5a** (background worker, transactional outbox, notifications: email with retries + in-app with a bell) and **1.5b** (files with ClamAV virus scanning, monitoring configurable and off by default, Dockerfiles).

## 1. Purpose and fit
Work that should not slow down or break a web request moves to a **background worker**: sending email first, later PDFs, reminders, exports and scheduled checks (architecture §2). The **notifications** foundation is the single way any module tells people something (brief Module L), in the app and by email, with delivery status and retries. Every later module (tasks, leave, invoices, payroll…) uses it rather than sending its own emails.

Today emails are sent during the request. If the mail server is down, the email is lost and the request fails. After 1.5a the request only *records* "send this email" in the same database transaction as the change, and the worker delivers it with retries.

## 2. Brief coverage (Module L and §7/§8 items)
| Required | 1.5a | Later |
|---|---|---|
| Background processing, domain events / jobs only where useful | ✅ pg-boss worker, jobs queued in the caller's transaction (outbox) | more job types per module |
| Delivery status and retry handling | ✅ `email_deliveries` (queued / sent / failed, attempts), 6 attempts (first + 5 retries) with backoff | job-failure alerting → 1.5b monitoring |
| In-app notifications, read / unread | ✅ `notifications` table, bell with unread count, list, mark read / all read | real-time push (Phase 13) |
| Deep links to authorized records | ✅ links carry only a path with IDs; the target page re-checks access | — |
| Prevent leaks across tenants / unauthorized access | ✅ RLS on `notifications`; recipient only sees own; jobs carry tenant and run under `withTenant` | — |
| Permission-controlled, auditable, no accidental mass delivery | ✅ recipients resolved server-side only, hard cap 200 per call, audit event per send | announcements UI (Phase 13) |
| Notification preferences | — | Phase 13 (with announcements) |
| Notification types for tasks, leave, invoices, payroll, contracts… | first types: *member joined*, *your roles changed* | each module adds its own |

## 3. Architecture
- **Queue: pg-boss 12** (MIT), stored in Postgres schema `pgboss`. No new server: on-prem still needs only Postgres + object storage + SMTP. The schema is created by our migration runner as `erp_migrator`. `erp_app` gets only the table privileges it needs and never runs DDL.
- **Outbox = same transaction.** `JobQueue.enqueue(tx, job)` inserts the pg-boss job through the caller's transaction (pg-boss `db` option). The job exists **if and only if** the change committed: no email for a rolled-back invitation, and no lost email for a committed one.
- **Worker:** `apps/api/src/worker.ts`, same codebase, separate process (`pnpm dev` runs both; production runs it as its own container in 1.5b). Handlers are small Nest providers. Each job payload carries `tenantId` (or `null` for account-level jobs such as sign-up emails), and handlers that touch tenant data run inside `withTenant(tenantId)`.
- **Secrets in jobs:** links with one-time tokens are encrypted (AES-256-GCM, key derived from `AUTH_SECRET` with HKDF, purpose `job-payload`) and decrypted only by the worker at send time. Completed jobs are deleted after 7 days.
- **Email delivery:** `email.send` job → render (existing templates, recipient's language) → SMTP → update `email_deliveries`. Retries: first attempt + 5 retries, exponential backoff starting at 30 s (≈ 30 min in total, capped at 30 min between attempts). After the last failure the status is `failed` with an error *code* (never the server's message text, which can contain addresses).
- **Notifications:** `Notifier.notify(tx, { type, recipients, params, link })` writes one `notifications` row per recipient and, for types that also email, enqueues `email.send`. Recipients must be active members of the current company (checked in the same transaction).
- **Web:** bell in the top bar (unread count, refreshed every 60 s and on focus), panel listing the latest notifications (newest first, cursor pagination), click → mark read + open link, "Mark all as read".

## 4. Data
| Table | Scope | Columns (main) |
|---|---|---|
| `notifications` | tenant, **forced RLS** | id, tenant_id, user_id (FK → users, member checked), type, params jsonb (IDs + display names only), link (relative path), read_at, created_at. Index (tenant_id, user_id, created_at desc). |
| `email_deliveries` | global (platform mail; like identity tables, not reachable from business modules — lint rule) | id, tenant_id nullable, template, locale, recipient, status, attempts, last_error_code, created_at, sent_at. No body, no links. |
| `pgboss.*` | global (queue) | managed by pg-boss; payloads hold IDs and encrypted secrets only |

## 5. API (new)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/notifications?cursor=&limit=` | Member | My notifications, newest first |
| GET | `/api/v1/notifications/unread-count` | Member | `{ count }` |
| POST | `/api/v1/notifications/:id/read` | Member | Mark one of mine read (others' IDs ⇒ 404) |
| POST | `/api/v1/notifications/read-all` | Member | Mark all of mine read |

`GET /invitations` gains `delivery: queued | sent | failed` so the Members screen can show "email failed" next to a pending invitation (resend = invite again).

## 6. Permissions and security
- Notifications are personal: a member reads and changes only their own (`user_id = me` in the query, RLS limits to the company). No permission key is needed to read your own.
- Sending is never exposed to the browser in 1.5a. Only server code sends, with server-resolved recipients, capped at 200 per call (protection against accidental mass delivery) and audited (`notification.sent` with type and recipient count).
- Links are relative paths built by the server from IDs. Opening one never grants access; the page's own API call is authorized as usual.
- Logs: job type, job ID, tenant ID and attempt number only. No recipients, tokens or content.

## 7. Acceptance criteria
1. Sign-up, verification-resend, password-reset, new-device and invitation emails are delivered by the worker; the HTTP request no longer waits for SMTP and does not fail when SMTP is down.
2. If SMTP is down, the email is retried (6 attempts in total) and is delivered once SMTP is back; `email_deliveries` shows attempts and final status.
3. If the transaction that queued an email rolls back, no email is sent.
4. A job for company A cannot read or write company B's data. **Deferred to the first job that touches company data** (1.5a's only job, email, uses account-level tables only). Rule recorded: such handlers take `tenantId` from the payload and run inside `withTenant`; the cross-tenant test is written with that job.
5. Job payloads in the database contain no readable one-time token.
6. When an invitee joins, the company's Owners/CEOs get an in-app notification; when someone's roles change, that person gets one. The bell shows the unread count; opening an item marks it read; "Mark all as read" works. EN + AR, axe clean.
7. A member cannot list, read or mark another member's notifications (404), nor those of another company.

## 8. Test plan
- **Integration (real Postgres + Mailpit, Testcontainers):** outbox commit vs rollback; retry with Mailpit stopped then started; delivery status; encrypted payload (raw `pgboss.job` row contains no token); notifications API isolation (other user, other company); recipient cap; audit event.
- **Unit:** payload encryption round-trip + tamper detection; backoff schedule.
- **Browser:** journey extended. After the invitee joins, the Owner's bell shows 1 unread, the panel lists "… joined", and marking it read clears the count. axe on the panel, EN + AR.
- Existing identity/access suites keep passing, with the worker running in-process in tests.

## 9. Results (2026-10-29)
- **Built:** pg-boss 12.38.0 queue in schema `pgboss` (installed by the migration runner; `erp_app` has row privileges only, verified by a test that it cannot create or drop tables there); `JobQueue` (jobs added through pg-boss's Drizzle adapter inside the caller's transaction); `PayloadSealer` (AES-256-GCM, HKDF from AUTH_SECRET); `EmailOutbox` + worker `EmailDeliveryHandler`; worker process `apps/api/src/worker.ts` (`pnpm dev` runs it); every email (sign-up, reset, new device, two-factor, lockout, invitation) now goes through the outbox, invitations queued in their own transaction; `Notifier` + notifications API; types *member joined* (Owners/CEOs) and *roles changed* (that member); bell + panel; Members shows "email not delivered".
- **Found while building:** the database rule for notification links rejected the valid link `/`; corrected (migration 0010) while still refusing `//host` and `/\host`.
- **Tests:** `apps/api/test/jobs.spec.ts` (5: delivered + status, rollback ⇒ no email, payload encrypted, SMTP down → retried → delivered, all attempts fail ⇒ `failed` with code only), access suite notifications (5), unit (sealer tamper/IV/key, error codes), db (queue privileges, notification RLS / member-only FK / relative links / read-only columns). Mutation checks: making the outbox ignore the caller's transaction fails the rollback test; removing encryption fails the encryption test. Journey EN + AR now also checks the bell (axe on the panel).
