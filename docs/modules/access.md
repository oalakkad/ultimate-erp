# Module spec: Access (Milestone 1.3b)

Status: **Approved 2026-10-28 (Milestone 1.3b).** Owner decisions 2026-10-27: fixed system roles now (custom later); sensitive roles blocked until two-factor is set up, no trusted device for them; only Owner and CEO invite; one account may belong to several companies.

## 1. Purpose and fit
Answers "**what may this person do in this company?**". Connects identity (1.3a, global accounts) to tenancy (1.2, isolated companies): onboarding creates a company and its Owner; invitations bring people in; roles grant permission keys with scopes; every tenant route checks membership, two-factor policy and permission on the server. The audit log records who changed what. Every business module (Phase 3+) declares its permissions here and calls the same guard.

## 2. Brief coverage
| Brief requirement | How |
|---|---|
| §6 secure onboarding (register → profile → owner → domain → invite → roles) | `POST /api/v1/companies`: verified user creates tenant + subdomain (our own domain, so verified by construction) + Owner membership, one transaction |
| §6 email domain is not proof of membership | Only invitations create memberships; acceptance requires a signed-in account whose **verified** email equals the invitation's |
| §7 RBAC, permission checks at API/service layer, scopes, least privilege | Permission keys `module.resource.action` + scopes (`own`/`team`/`project`/`company`) in `packages/contracts`; `@RequirePermission()` enforced by `AccessGuard`; deny by default |
| §7 separation of duties, restricted admin ops, auditable permission changes | Nobody grants more than they hold; no one changes their own roles; only an Owner grants Owner; last Owner cannot be removed; every change audited |
| §7 CEO / platform / technical admin distinguished | Technical Admin tenant role has no business permissions; platform operator stays a separate DB role (1.2) |
| §8 MFA for sensitive roles | Roles holding sensitive permissions require `twoFactorEnabled`; otherwise every company route answers `403 MFA_REQUIRED`; trusted-device skipping refused for them |
| §10 N audit logs, protected from alteration | `audit_events`: app may INSERT/SELECT only; a trigger rejects UPDATE/DELETE for every role; written in the same transaction as the change |
| §14 API documentation | OpenAPI 3.1 generated from the same Zod schemas, `GET /api/v1/docs/openapi.json` (development only); a test fails if a route lacks a contract |

## 3. Roles (fixed in 1.3b; see permissions.md)
Owner, CEO, Manager, Team Leader, Employee, Finance, HR/Payroll, Technical Admin. Definitions (permission → scope) live in `packages/contracts/src/permissions.ts`, the single source for API, web and tests. **Sensitive** permissions (need MFA): role assignment, confidential exports, restricted employee data, payroll, payment recording/approval, audit read. A role is sensitive if it holds any of them (Owner, CEO, Finance, HR/Payroll).

## 4. Data (migration 0004/0005, tenant-owned, RLS forced)
| Table | Holds |
|---|---|
| `membership_roles` | (tenant_id, membership_id, role) — composite FK to memberships |
| `invitations` | email (lower), role, inviter membership (composite FK), SHA-256 of token, expiry (7 days), status `pending`/`accepted`/`revoked`, accepted membership |
| `audit_events` | occurred_at, actor user/membership, action, target type/id, request ID, IP, `details` (whitelisted, never secrets) |

Function `app.user_role_names(user)` (security definer): the distinct role names a user holds across active memberships — used only to refuse trusted devices for sensitive users; returns no tenant information.

## 5. API
| Method & path | Host | Requires | Purpose |
|---|---|---|---|
| POST `/companies` | any | session, verified email | Create company + subdomain + Owner (rate-limited 5/day/user) |
| GET `/access/me` | company | member | My roles and effective permissions here |
| GET `/members` | company | `access.members.read` | Members with roles and status |
| PUT `/members/:id/roles` | company | `access.roles.assign` | Replace a member's roles (rules §2) |
| POST `/members/:id/remove` | company | `access.members.manage` | Mark removed (history kept); not the last Owner, not yourself |
| POST `/invitations` | company | `access.members.invite` | Invite email + role; emails a link |
| GET `/invitations` | company | `access.members.invite` | Pending invitations |
| DELETE `/invitations/:id` | company | `access.members.invite` | Revoke |
| GET `/invitations/preview?token=` | company | — | Company name, role, expiry (email masked) |
| POST `/invitations/accept` | company | session | `{ token }` → membership |
| GET `/audit-events?limit=&cursor=` | company | `audit.event.read` | Newest first, cursor pagination |
| GET `/docs/openapi.json` | any | dev only | API documentation |

Sign-in on a company host succeeds only for an active member or someone with a pending invitation there (otherwise `403 FORBIDDEN`, session discarded). Non-members get `404` on company routes (does not confirm the company exists). New error code: `MFA_REQUIRED`.

## 6. Acceptance criteria
1. A verified user creates a company and is its Owner; an unverified or signed-out user cannot; reserved or taken slugs are refused.
2. A sensitive-role member without two-factor gets `MFA_REQUIRED` on every company route until it is set up; then access works.
3. Only Owner/CEO can invite; an invitation is accepted only by a signed-in account with the same verified email, once, before expiry, and not after revocation.
4. Nobody can grant a role with more permissions than their own, change their own roles, grant Owner unless Owner, or remove the last Owner.
5. Permissions are enforced on the server for every route; a member of company A has no access in company B (404).
6. Every membership, role and invitation change produces an audit event in the same transaction; audit events cannot be updated or deleted, even by the table owner.
7. Gaining a sensitive role cancels the user's trusted devices; sensitive users cannot newly trust a device.
8. Every route appears in the OpenAPI document.

## 7. Test plan
Integration (`apps/api/test/access.spec.ts`, real Postgres + Mailpit): onboarding, invitation lifecycle incl. wrong-email / unverified / expired / revoked / reused tokens, self-elevation and last-owner attempts, MFA block, cross-tenant member access, audit immutability (app and migrator), trusted-device refusal. Unit: permission evaluation and grant rules (`packages/contracts`), permission matrix vs. permissions.md. DB isolation suite extended automatically (catalog guard) for the new tables.

## 8. Implementation notes (found while building)
- **Owner could never appoint a CEO**: with "grant only what you hold", an Owner (no payroll in the matrix) could not grant CEO, and nobody else could either. Decision: Owner may grant any role to others; founder gets Owner + CEO; nobody changes their own roles (`canGrant`, `FOUNDER_ROLES`).
- **Concurrent role changes**: two Owners demoting each other at the same moment could both succeed (verified: `[200, 200]`, zero Owners) or deadlock. Role changes now take a per-company transaction lock and re-read the actor's roles inside it. The test forces true overlap by freezing writes to `membership_roles` until both requests wait.
- **Audit pagination** uses the UUIDv7 id as cursor (time-ordered, exact) instead of millisecond-rounded timestamps.
- Sign-in on a company host is limited to members and invitees (`SIGN_IN_POLICY` hook: identity declares it, access implements it — no circular dependency).
- Trusted devices are cancelled by deleting the user's Better Auth verification values; this also voids an unused password-reset link at that moment (acceptable at a privilege change).
- Windows PowerShell cannot resolve `*.localhost`; `pnpm http` (scripts/dev-http.mjs, development only) talks to company addresses with per-person cookie jars.

## 9. Out of scope
Custom roles, team/project-scoped resource checks (need teams/projects: Phases 5–8), company switcher UI (Phase 2), audit search UI (Phase 14), custom domains.
