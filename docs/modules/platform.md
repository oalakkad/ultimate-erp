# Module spec: Platform console (Phase 17)

Status: **Built 2026-11-01, documented 2026-11-03** (owner request; Claude's decisions in §9, results in §10).

## 1. Purpose and fit
The person who runs the installation (the founder of the SaaS, or the IT lead of an on-premises customer) needs to see **which companies use the system** and to **stop a company** when necessary (unpaid subscription, abuse, a request from the firm) — without becoming a member of every company and without seeing their business data. Brief §486 asks for a deliberately designed, audited platform role with no unrestricted "Super Admin"; `permissions.md` §2 lists the Platform Operator with "no business data by default". This module is that role's first, smallest form: a **directory and an on/off switch**, nothing more.

It sits outside every company: it lives on the main address (`erp.example.com/platform`), never on a company address, and it never opens a company's transaction.

## 2. Scope
| In | Not in (deliberately) |
|---|---|
| Overview numbers for the whole installation: companies (active, suspended, new in 30 days), people with active memberships, accounts, sign-ins in the last 7 days, stored file volume | Any business data: clients, contracts, projects, hours, invoices, salaries, files' contents or names |
| Company directory: name (EN/AR), address, status, language, created, owners (name + email), active members, pending invitations, last activity (newest audit event), stored file volume; search by name / address / owner email; filter by status | "Log in as" a company or a person, support access into a company (needs a separate, tenant-approved, time-boxed design — `security.md` §1 R14) |
| Suspend / reactivate a company with a required reason | Deleting companies (companies are never deleted, see project-status "Confirmed decisions") |
| The founders' own audit list (who, when, which company, from → to, reason) | Plans, subscription billing, quotas (no billing provider yet) |
| Granting / revoking a founder from the server's command line | Granting through the web or API |

## 3. Data
- `platform_operators` (global, migration `0038`): one row per founder — `user_id` (primary key), `role` (`founder` only), `granted_at`, `granted_by` (`cli`).
- `platform_audit_events` (global, `0038`): append-only — `occurred_at`, `actor_user_id`, `action` (`platform.company.suspended` / `platform.company.reactivated`), `target_tenant_id`, `request_id`, `ip_address`, `details` (`{ from, to, reason }`).
- Both tables are **global** (no `tenant_id`) and are registered in the global-table review of `packages/db` `isolation.spec.ts`.
- A suspended company is simply `tenants.status = 'suspended'`; the existing host resolution only accepts active companies, so its addresses stop answering at once and it disappears from its members' company lists. Reactivation restores everything; nothing is deleted.

## 4. Security and permissions
- **Who:** only accounts with a row in `platform_operators`. The founder is **not a company role** and gives no permission inside any company (`permissions.md` §2).
- **Granted only from the command line** on the server: `pnpm platform:founder <email>` (and `--revoke`), which connects as the migrator role. The application's database role (`erp_app`) may *read* `platform_operators` but cannot insert, change or delete rows (tested: 42501). There is no API or screen to grant it, so nobody can promote themselves through the application.
- **The gate (`PlatformGuard`) on every route**, in this order: signed in (else 401) → on the main address, not a company address (else 404) → is an operator (else 404, so a normal user cannot even learn the console exists) → **two-factor turned on** (else 403 `MFA_REQUIRED`).
- **The only cross-company read path** is four `SECURITY DEFINER` database functions (migration `0039`): `app.is_platform_operator`, `app.platform_companies`, `app.platform_overview`, `app.platform_set_company_status`. Each checks the operator itself (so misuse from application code still returns nothing), runs with a fixed `search_path`, and returns directory facts only. Execution is revoked from `PUBLIC` and granted to `erp_app` alone. The service never reads business tables and never sets a company context.
- **Audit:** every suspension and reactivation writes a platform audit event with the reason, the founder, the request reference and the client address. The table is append-only (update / delete / truncate rejected by trigger, tested).
- **Reason** is required (1–1000 characters, validated by the shared contract; missing → 422).
- Details in `security.md` §2f.

## 5. API (main address only)
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/platform/me` | `{ founder }` — whether this signed-in account may open the console here (any signed-in account may ask; the web uses it to show the link) |
| GET | `/api/v1/platform/overview` | Installation-wide numbers (§2) |
| GET | `/api/v1/platform/companies?search=&status=` | Directory (§2), newest first |
| GET | `/api/v1/platform/companies/:id` | One company |
| POST | `/api/v1/platform/companies/:id/status` | `{ status: "active" \| "suspended", reason }` → the company; audited when the status changes |
| GET | `/api/v1/platform/audit-events` | The founders' actions, newest first (last 200) |

File sizes are strings (bytes), dates ISO 8601, as everywhere in the API. Contracts: `packages/contracts/src/platform.ts`.

## 6. Screen
`apps/web/src/routes/platform.tsx`, route `/platform` on the main address. Overview tiles; searchable company table (owners, people, pending invitations, last activity, created, status) with a status filter; a suspend / reactivate dialog that requires a reason; the founders' audit list. A "Platform console" link appears on the Companies page **only** when `/platform/me` says `founder: true`. Without two-factor the page shows the translated "two-factor required" error (set it up under My account). Loading, empty, error (with request reference) states; EN + AR with RTL (`ui.platform.*`).

## 7. Command line
```
pnpm platform:founder someone@example.com            # grant (the account must exist — sign up first)
pnpm platform:founder someone@example.com --revoke   # revoke
```
Needs `DATABASE_MIGRATOR_URL` (in `.env` locally; on a server, run it inside the API image — `operations.md` §9). Messages: granted / already has it / revoked / did not have it / no such account (exit code non-zero).

## 8. Acceptance criteria
1. A normal signed-in account gets 404 on every `/platform/*` route and `founder: false` from `/platform/me`; anonymous → 401.
2. The app role cannot insert into `platform_operators` (database error 42501).
3. A granted founder without two-factor gets 403 `MFA_REQUIRED`; with two-factor, the console works.
4. On a company address the console answers 404 even for a founder.
5. The directory shows every company with owners, people, pending invitations and last activity, and **no business data** (a client name created in a company does not appear anywhere in the responses; the founder gets 404 on that company's `/clients`).
6. Suspending makes the company's address answer 404 and removes it from its members' company lists; a reason is required (422 without); reactivating restores both.
7. Both actions appear in the platform audit with reason and actor; deleting an audit row fails (42501 / trigger).
8. The page works in EN and AR, the link shows only for founders, and axe finds no WCAG 2.2 AA violations on the page and the dialog.

## 9. Decisions taken by Claude (nonstop mode, reviewable)
- **Directory only, no business data** — the console answers "who uses the system and are they active", never "what is in their books".
- **No support access into companies** in this phase. If support ever needs to look inside a company, it will be a separate feature: requested by the founder, approved by that company's Owner, limited in time, and audited on both sides.
- **Granting only from the server's command line** (no API, no screen).
- **Two-factor is mandatory** for the console, with no "trusted device" shortcut beyond what sign-in already allows.
- Suspension is reversible and is the only action; there is no delete.

## 10. Results (2026-11-01)
- **API** `apps/api/test/platform.spec.ts` — 2 tests against real Postgres: criteria 1–7 (non-operator 404 and `founder: false`; anonymous 401; app role cannot insert operators, 42501; granted without two-factor → 403 `MFA_REQUIRED`; company host → 404; directory with members / pending invitations / owners / last activity and no client name; founder 404 on a company's `/clients`; suspend → company host 404 and gone from members' lists; reason required 422; reactivate restores; both actions audited with reason and actor; audit delete refused).
- **Database** `packages/db` — 39 passed (the two new global tables registered in the global-table review).
- **Browser** `apps/web/e2e/platform.spec.ts` — EN and AR passed against the dev stack: founder granted through the real CLI, console opened from the Companies page, suspend and reactivate with reasons, axe clean on the page and the dialog. Screenshots `apps/web/e2e/screenshots/platform-{en,ar}.png`.
- **Not yet:** plans / subscription billing, support access (see §9), notification e-mail to a company's Owners when it is suspended.
