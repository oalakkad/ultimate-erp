# API Conventions

Status: **Active.** Sections marked *(planned)* are binding conventions not yet exercised by an endpoint; they are implemented with the first endpoint that needs them.

One API serves the web app, the future React Native app and integrations. The web app has no private back door.

## 1. Basics

- Base path: `/api/v1`. A breaking change ships as `/api/v2` alongside v1; additive changes (new fields, new endpoints, new error codes) stay in v1.
- JSON only (`Content-Type: application/json`), UTF-8. Request bodies are limited (`HTTP_BODY_LIMIT`, default 1 MB); file uploads use a separate flow (Milestone 1.5).
- Field names `camelCase`. IDs are UUID strings. Clients must treat IDs as opaque.
- Contracts: every request and response schema is a Zod schema in `packages/contracts`, shared by server and clients.
- **API documentation** *(implemented 1.3b)*: every route declares `@ApiContract({ summary, auth, permission, body, query, params, response })`; OpenAPI 3.1 is generated from those Zod schemas at `GET /api/v1/docs/openapi.json` (not served in production). A test fails if any route lacks a contract.

## 2. Tenancy and authentication

- The tenant is resolved from the **host** (`acme.<platform-domain>`, `acme.localhost` in dev) and verified against the user's membership. Requests never carry a trusted `companyId`; any such field in a body is rejected.
- Web: httpOnly session cookie + CSRF protection. Mobile: bearer session token. *(Milestone 1.3)*
- Unknown tenant or no membership ⇒ `404 NOT_FOUND` (does not confirm the tenant exists).
- Implemented in 1.2: every route except `/health` and `/health/live` passes through tenant resolution; `X-Forwarded-Host` and any client-sent tenant ID are ignored.

## 3. Correlation IDs

- Every response has `X-Request-Id`. It appears in every log line for that request and in every error body as `error.requestId`.
- An incoming `X-Request-Id` is reused only when `TRUST_INCOMING_REQUEST_ID=true` (set only behind our own reverse proxy) and it matches `[A-Za-z0-9._-]{8,128}`.

## 4. Errors

All errors use one shape (`errorResponseSchema` in `packages/contracts`):

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "The request contains invalid fields.", "requestId": "…", "details": [{ "path": "email", "code": "invalid_format" }] } }
```

- `code` is stable and machine-readable; the client shows a translated (EN/AR) message for it. `message` is a short English description for developers, not for display.
- No stack traces, SQL, hostnames or internal messages ever leave the server. Unexpected errors are `500 INTERNAL_ERROR` and logged with the stack trace server-side.
- Codes are added, never renamed or reused.

| HTTP | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST`, `MALFORMED_JSON` | Unparseable request |
| 401 | `UNAUTHENTICATED` | No/expired session |
| 403 | `FORBIDDEN` | Authenticated but lacks the permission or scope |
| 403 | `MFA_REQUIRED` | Sensitive role without two-factor set up (company routes) |
| 404 | `NOT_FOUND` | Missing, or exists in another tenant (indistinguishable on purpose) |
| 405 | `METHOD_NOT_ALLOWED` | |
| 409 | `CONFLICT` | Version conflict, invalid state transition, duplicate |
| 413 | `PAYLOAD_TOO_LARGE` | Body over limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | |
| 422 | `VALIDATION_FAILED` | Schema or business-rule validation; `details` lists fields |
| 429 | `RATE_LIMITED` | `Retry-After` header included |
| 401 | `INVALID_CREDENTIALS`, `INVALID_CODE` | Wrong email/password (identical for unknown emails); wrong or reused 2FA code |
| 403 | `EMAIL_NOT_VERIFIED` | Sign-in before confirming the email |
| 400 | `INVALID_TOKEN` | Verification/reset link invalid, used or expired |
| 422 | `PASSWORD_COMPROMISED` | Password appears in known breaches |
| 500 | `INTERNAL_ERROR` | Unexpected |
| 503 | `SERVICE_UNAVAILABLE` | Dependency down |

## 5. Validation *(implemented 1.3a: `ZodValidationPipe`)*

- Every body, query and path parameter is validated against its Zod schema before the service runs. Schemas are `.strict()`: **unknown fields are rejected** (prevents mass assignment such as `"role": "owner"`).
- Business rules (budget capacity, state transitions, permissions) are enforced in services, never only in the UI.

## 6. Money, hours and time

- Money: `{ "amount": "1250.500", "currency": "KWD" }` — amount is a **string** with the currency's decimals (KWD 3). Never a JSON number.
- Hours: decimal strings (`"7.50"`) until the Phase 6 decision (ADR-0005).
- Instants: ISO-8601 UTC (`2026-10-24T18:16:47.116Z`). Calendar dates: `YYYY-MM-DD`.

## 7. Collections *(planned, Phase 3)*

- Cursor pagination: `?limit=50&cursor=<opaque>`; response `{ "items": [...], "nextCursor": "…" | null }`. Max `limit` 200. Cursors are opaque and tenant-bound.
- Sorting: `?sort=name,-createdAt` (`-` = descending); only whitelisted fields per endpoint.
- Filtering: named, whitelisted query params per endpoint (`?status=active&clientId=…`); free text via `?q=`.
- Totals (`count`) only where cheap or explicitly requested.

## 8. Concurrency and idempotency *(planned)*

- **Optimistic concurrency** (Phase 3): resources return `version`; updates send `If-Match: "<version>"` (or `version` in body). A stale version ⇒ `409 CONFLICT` — no silent overwrite.
- **Idempotency keys** (first financial/time endpoint, Phase 7/12): retryable create operations accept `Idempotency-Key: <uuid>`. The server stores key + request hash + response per tenant for 24h; a repeat returns the original response; same key with a different body ⇒ `409 CONFLICT`. Required for payments, invoice issue, payroll approval, time-entry submission.
- Non-idempotent financial operations are never retried automatically (server or client).

## 9. Rate limits *(implemented 1.3a for /auth: Postgres-backed `RateLimiter`; general per-user limit later)*

Per IP and per account on login, OTP verify, password reset, invitation accept, exports; general per-user limit on all endpoints. Exceeding ⇒ `429 RATE_LIMITED` with `Retry-After`.

## 10. Endpoints

| Method | Path | Auth | Description | Since |
|---|---|---|---|---|
| GET | `/api/v1/health` | Public | Readiness: 200 if all dependencies up, 503 otherwise. Body `healthResponseSchema`. No versions or error details. | 1.1 |
| GET | `/api/v1/health/live` | Public | Liveness: process running. Always 200 `{ "status": "ok" }`. | 1.1 |
| POST | `/api/v1/auth/sign-up` | Public | `{ email, password, name, locale? }` → `202 { status: "accepted" }` (same for existing emails) | 1.3a |
| GET | `/api/v1/auth/verify-email?token=` | Public | Confirms the email → `{ status: "ok" }`; bad token ⇒ `400 INVALID_TOKEN` | 1.3a |
| POST | `/api/v1/auth/verify-email/resend` | Public | `{ email }` → `202` always | 1.3a |
| POST | `/api/v1/auth/sign-in` | Public | `{ email, password, rememberMe? }` → `{ status: "signed_in", user }` + session cookie, or `{ status: "two_factor_required" }`; `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED`, `429 RATE_LIMITED` | 1.3a |
| POST | `/api/v1/auth/two-factor/verify` | Pending 2FA | `{ code, trustDevice? }` → signed in; `401 INVALID_CODE` (wrong or replayed) | 1.3a |
| POST | `/api/v1/auth/two-factor/verify-backup-code` | Pending 2FA | `{ code, trustDevice? }` → signed in (each code once) | 1.3a |
| POST | `/api/v1/auth/sign-out` | Session | Ends this session | 1.3a |
| GET | `/api/v1/auth/me` | Session | `{ user, session }` | 1.3a |
| PATCH | `/api/v1/auth/me` | Session | `{ name?, locale? }` (at least one) → `user` | 1.4b |
| GET | `/api/v1/auth/companies` | Session | Companies where I am an active member: `{ companies: [{ tenantId, slug, name, defaultLocale, url, roles }] }` | 1.4b |
| POST | `/api/v1/auth/handoff` | Session | `{ tenantId }` (must be my company, else `404`) → `{ url }` = company address with a one-time ticket (60 s, stored hashed) | 1.4b |
| POST | `/api/v1/auth/handoff/redeem` | Public, company host | `{ ticket }` → signed in on this host (new host-only session, original sign-in time kept); used/expired/other-company ticket ⇒ `400 INVALID_TOKEN` | 1.4b |
| POST | `/api/v1/auth/password/forgot` | Public | `{ email }` → `202` always | 1.3a |
| GET | `/api/v1/auth/password/reset?token=` | Public | Is the reset link still valid? (does not use it) | 1.3a |
| POST | `/api/v1/auth/password/reset` | Public | `{ token, newPassword }`; revokes all sessions | 1.3a |
| POST | `/api/v1/auth/password/change` | Session | `{ currentPassword, newPassword }`; revokes other sessions | 1.3a |
| POST | `/api/v1/auth/two-factor/enable` | Session | `{ password }` → `{ totpUri, backupCodes }` (inactive until confirmed) | 1.3a |
| POST | `/api/v1/auth/two-factor/confirm` | Session | `{ code }` activates two-factor | 1.3a |
| POST | `/api/v1/auth/two-factor/disable` | Session | `{ password }` | 1.3a |
| POST | `/api/v1/auth/two-factor/backup-codes` | Session | `{ password }` → new `{ backupCodes }` | 1.3a |
| GET | `/api/v1/auth/sessions` | Session | Own sessions (no tokens) | 1.3a |
| DELETE | `/api/v1/auth/sessions/:id` | Session | Revoke one own session (others' IDs ⇒ 404) | 1.3a |
| POST | `/api/v1/auth/sessions/revoke-others` | Session | Revoke all other own sessions | 1.3a |
| POST | `/api/v1/companies` | Session (verified) | Create company + subdomain; caller becomes Owner + CEO → `201 { tenantId, slug, url, twoFactorRequired }`; taken slug ⇒ `409` | 1.3b |
| GET | `/api/v1/access/me` | Member | My roles, permissions, whether two-factor setup is required (works before MFA) | 1.3b |
| GET | `/api/v1/members` | `access.members.read` | Members with roles | 1.3b |
| PUT | `/api/v1/members/:id/roles` | `access.roles.assign` | Replace another member's roles (no self-change, no escalation, last Owner kept) | 1.3b |
| POST | `/api/v1/members/:id/remove` | `access.members.manage` | Mark removed | 1.3b |
| POST/GET | `/api/v1/invitations` | `access.members.invite` | Invite (email + role) / list pending; each invitation carries `delivery: queued \| sent \| failed` (1.5a) | 1.3b |
| DELETE | `/api/v1/invitations/:id` | `access.members.invite` | Revoke | 1.3b |
| GET | `/api/v1/invitations/preview?token=` | Public, company host | Company, role, masked email, expiry | 1.3b |
| POST | `/api/v1/invitations/accept` | Session, company host | `{ token }`; verified matching email required | 1.3b |
| POST | `/api/v1/files` | Member | Multipart `file` → `201` file `{ id, name, contentType, sizeBytes, status: pending, createdAt }`; type from content (allow-list) else `415`; over `FILE_MAX_BYTES` `413` | 1.5b |
| GET | `/api/v1/files/:id` | Member (uploader) | Details + scan status (`pending \| clean \| infected \| scan_failed`); anyone else `404` | 1.5b |
| POST | `/api/v1/files/:id/download` | Member (uploader) | `{ url, expiresInSeconds: 300 }` signed attachment link; not clean ⇒ `409 FILE_NOT_READY` | 1.5b |
| GET | `/api/v1/dashboard/summary` | Member | Sections present only with permission: `setup { invitationSent, colleagueJoined }` (invite), `team { activeMembers, pendingInvitations\|null }` (members.read), `activity { items[{ id, action, occurredAt, actorName }] }` (audit.event.read) | 2b |
| GET/POST | `/api/v1/clients` | `clients.client.read` / `.create` | List (`search, status, archived, sort=name\|nameAr\|created\|updated\|number, dir, limit, cursor`) / create (409 `duplicate` CR, `possible_duplicate` name unless `confirmDuplicate`) | 3 |
| GET/PATCH | `/api/v1/clients/:id` | read / `.update` | One client / edit with `version` (stale ⇒ 409) | 3 |
| POST | `/api/v1/clients/:id/archive`, `/restore` | `.archive` | Archive / restore | 3 |
| GET | `/api/v1/clients/export.csv` | `.export` | CSV of the filtered list (max 5,000, audited, formulas neutralised) | 3 |
| GET/POST/PATCH | `/api/v1/clients/:id/contacts[/:contactId]`, `POST …/archive` | read / `.update` | Contacts (one primary; authorized representatives) | 3 |
| GET/POST | `/api/v1/clients/:id/interactions` | read / `.update` | Communication history (append-only) | 3 |
| GET/POST/DELETE | `/api/v1/clients/:id/documents[/:fileId]`, `POST …/:fileId/download` | read / `.update` | Attach my uploaded file, list, detach, 5-minute download of clean files | 3 |
| GET | `/api/v1/clients/:id/activity` | read | Timeline (action codes, actor names, changed field names) | 3 |
| GET/POST/PATCH | `/api/v1/contract-templates[/:id]` | read / `contracts.template.manage` | Bilingual templates with `{{placeholders}}` | 4 |
| GET/POST | `/api/v1/contracts` | `contracts.contract.read` / `.manage` | Register (search, status, kind, clientId, expiringWithinDays, cursor) / create from template or blank (CT-/EL- numbers) | 4 |
| GET/PATCH | `/api/v1/contracts/:id` | read / `.manage` | One document with `actions` I may take / edit terms (draft only, `version`) | 4 |
| GET/POST | `/api/v1/contracts/:id/versions` | read / `.manage` | Text history / new version (draft only) | 4 |
| POST | `/api/v1/contracts/:id/{submit,approve,reject,send,sign,activate,terminate}` | per action (approve/reject: `.approve`, not the submitter) | State machine (docs/modules/contracts.md §4); invalid ⇒ 409 `invalid_transition` | 4 |
| POST | `/api/v1/contracts/:id/signed-copy/download` | read | 5-minute link to the clean signed copy | 4 |
| GET/POST | `/api/v1/projects` | `projects.project.read` (project scope) / `.create` | List (search, status, clientId, mine, cursor; team members see only theirs) / create (P- numbers, budget revision 1, manager on team, contract must be the same client's) | 5 |
| GET/PATCH | `/api/v1/projects/:id` | read / `.manage` (project scope) | One project with `actions` and `nextStatuses` / edit details (`version`; closed projects refused) | 5 |
| POST | `/api/v1/projects/:id/status` | `.manage` | planned → active ⇄ on_hold → completed, open → cancelled; invalid ⇒ 409 `invalid_transition` | 5 |
| PUT | `/api/v1/projects/:id/members` | `.manage` | Replace the team (manager always kept; active members of this company) | 5 |
| GET/POST | `/api/v1/projects/:id/budget` | read / `projects.budget.update` | Revision history / new revision with reason (append-only) | 5 |
| GET | `/api/v1/projects/:id/hours` | read | Budgeted, allocated, remaining, logged, approved, billable + warning | 5 |
| GET/POST/DELETE | `/api/v1/projects/:id/documents[/:fileId]` (+ `/download`) | read / `.manage` | Project documents (clean files only, 5-minute links) | 5 |
| GET | `/api/v1/projects/:id/activity` | read | Timeline from the audit trail | 5 |
| GET/POST | `/api/v1/tasks` | `tasks.task.read` (own) / `tasks.task.manage` (project) | List (search, projectId, clientId, status, state, priority, assignee=me, overdue, cursor; scope-filtered) / create with allocations in one transaction (T- numbers) | 6 |
| POST | `/api/v1/tasks/allocation-preview` | `tasks.allocation.manage` | Budget remaining after + each person's open workload; nothing saved | 6 |
| GET/PATCH | `/api/v1/tasks/:id` | read / manage | One task with `actions`, `nextStatuses`, `blockedBy` / edit (`version`) | 6 |
| POST | `/api/v1/tasks/:id/status` | `tasks.task.work` (own) | Workflow; blocked tasks can't start; cancel/reopen need manage | 6 |
| PUT | `/api/v1/tasks/:id/allocations` | `tasks.allocation.manage` | Replace people + hours; over budget ⇒ 409 `over_budget` unless `override` + `overrideReason` with `projects.budget.override` | 6 |
| PUT | `/api/v1/tasks/:id/dependencies` | manage | Blocked-by list (same project, no loops) | 6 |
| GET/POST | `/api/v1/tasks/:id/comments` | read / work | Append-only comments | 6 |
| GET/POST/DELETE | `/api/v1/tasks/:id/documents[/:fileId]` (+ `/download`) | read / work | Task documents | 6 |
| GET | `/api/v1/tasks/:id/activity` | read | Timeline | 6 |
| GET | `/api/v1/timesheets/mine?week=` | `time.entry.create` (own) | My week (Sunday–Saturday) with entries, day totals, `canSubmit` | 7 |
| POST | `/api/v1/timesheets/:id/submit` | own | Submit my week; project managers notified | 7 |
| POST/PATCH/DELETE | `/api/v1/time-entries[/:id]` | own | Log time on a task I'm assigned to (≤ 24 h a day, duplicate guard with `confirmDuplicate`) / correct or delete drafts and rejected entries | 7 |
| GET | `/api/v1/approvals/time` | `time.timesheet.approve` | Submitted entries I may decide (projects I manage; Owner/CEO all; never mine) | 7 |
| POST | `/api/v1/time-entries/{approve,reject}` | approve | `{ ids }` / `{ ids, reason }` | 7 |
| POST | `/api/v1/time-entries/:id/reopen` | approve | Send an approved entry back with a reason (audited) | 7 |
| GET/POST | `/api/v1/timer`, `/api/v1/timer/stop` | own | My running timer / start on a task / stop → draft entry | 7 |
| GET | `/api/v1/time/summary?from&to&membershipId` | `time.entry.read` (own; others need company) | Per day, per project, billable share | 7 |
| GET | `/api/v1/tasks/:id/time` | task read | Allocated vs logged vs approved per person | 7 |
| GET/POST | `/api/v1/people` | `people.employee.read` (own) / `people.employee.manage` | Directory (scope-filtered) / create a member's employee record (E- numbers) | 8 |
| GET | `/api/v1/people/candidates` | manage | Active members without a record | 8 |
| GET/PATCH | `/api/v1/people/:membershipId` | read / manage | One person (`details` null unless allowed) / edit employment (history written) | 8 |
| POST | `/api/v1/people/:id/status` | manage | Lifecycle; "left" needs a date and suspends access | 8 |
| GET/PUT | `/api/v1/people/:id/private` | `people.employee.read_restricted` (own) | Encrypted private details; reads audited | 8 |
| GET/POST/DELETE | `/api/v1/people/:id/emergency-contacts[/:id]` | restricted | Encrypted emergency contacts | 8 |
| GET | `/api/v1/people/:id/history`, `/checklist` (+ POST, PATCH `/:itemId`) | details level / manage | Employment history; on/offboarding checklists | 8 |
| GET/POST/DELETE | `/api/v1/people/:id/documents[/:fileId]` (+ `/download`) | details level / manage | Confidential documents only for restricted readers | 8 |
| GET/POST/PATCH | `/api/v1/departments`, `/api/v1/teams` (+ PUT `/teams/:id/members`) | read / `people.org.manage` | Organisation | 8 |
| GET/POST/PATCH | `/api/v1/leave/types[/:id]` | `leave.request.create` / `leave.policy.manage` | Company leave policies (defaults flagged `toVerify`; `confirmVerified` clears it) | 9 |
| GET/PUT | `/api/v1/leave/holidays?year=` | create / policy | Public holidays of a year | 9 |
| GET | `/api/v1/leave/balances?membershipId&year` | own (others by read scope) | Accrued, adjustments, taken, pending, balance per type | 9 |
| POST | `/api/v1/leave/adjustments` | policy | Balance adjustment with a note | 9 |
| GET/POST | `/api/v1/leave/requests` (+ `/preview`) | create | Mine / approvals / one person; apply (overlap, balance, document checks) | 9 |
| POST | `/api/v1/leave/requests/:id/{approve,reject,withdraw,cancel}` | approve (team) / own | Workflow; deduction and restoration once each (ledger unique key) | 9 |
| GET | `/api/v1/leave/calendar?from&to` | `leave.request.read` | Approved and pending leave + holidays (≤ 92 days) | 9 |
| GET/PATCH | `/api/v1/attendance/settings` | `attendance.check` / `attendance.manage` | Web check-in allowed, rotation, minimum gap | 10 |
| GET/POST/PATCH | `/api/v1/attendance/sites[/:id]` | check / manage | Sites (kiosks) | 10 |
| GET | `/api/v1/attendance/sites/:id/code` | manage | Current rotating kiosk code + seconds left | 10 |
| GET/POST/PATCH | `/api/v1/attendance/shifts[/:id]`, PUT `/assignments/:membershipId` | check / manage | Shifts and assignment | 10 |
| POST | `/api/v1/attendance/check` | check (own) | `{ code }` from the kiosk, or web if allowed; kind alternates; server time; replay-protected | 10 |
| GET | `/api/v1/attendance/me`, `/summary?from&to&membershipId`, `/today` | check / `attendance.read` | My day; period days with late/early/absent/leave and logged hours; who is in | 10 |
| GET/POST | `/api/v1/attendance/corrections` (+ `/:id/{approve,reject}`) | check / `attendance.correction.approve` | Correction requests and decisions (never one's own) | 10 |
| GET | `/api/v1/org-chart` | read | Reporting lines of people I may see | 8 |
| GET | `/api/v1/workload?projectId=` | allocation.manage on the project, or company read | Open tasks / hours / overdue per person | 6 |
| GET | `/api/v1/notifications?limit=&cursor=` | Member | My notifications here, newest first `{ items, nextCursor }` | 1.5a |
| GET | `/api/v1/notifications/unread-count` | Member | `{ count }` | 1.5a |
| POST | `/api/v1/notifications/:id/read` | Member | Mark one of mine read (anyone else's ⇒ 404) | 1.5a |
| POST | `/api/v1/notifications/read-all` | Member | Mark all of mine read | 1.5a |
| GET | `/api/v1/audit-events?limit=&cursor=` | `audit.event.read` | Newest first; `nextCursor` | 1.3b |
| GET | `/api/v1/docs/openapi.json` | Public, **dev/test only** | Generated OpenAPI 3.1 document | 1.3b |
| GET | `/api/v1/tenant` | Public, tenant host | Public profile of the company owning the host: `{ slug, name: { en, ar }, defaultLocale }` (`tenantPublicProfileSchema`). Unknown/unverified/suspended host ⇒ 404. Database unavailable ⇒ 503. | 1.2 |
