# Module spec: Projects / engagements & budgeting (Phase 5)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
A project (shown as an "engagement" to audit firms) is the unit of work for a client: who leads it, who works on it, when, and within what budget of hours and money. Tasks and hour allocations (Phase 6), timesheets (Phase 7) and invoices (Phase 12) all hang off a project, so the budget defined here is the limit everything later is checked against.

## 2. Brief coverage (Module D)
| Required | Phase 5 |
|---|---|
| Belongs to a client; related contract | ✅ client required; optional contract that **must belong to the same client** (DB composite key) |
| Name and reference; description | ✅ bilingual name, number `P-0001`, description |
| Project manager; team members | ✅ manager (a member) + team list (members) |
| Start / end dates; status | ✅ `planned → active ⇄ on_hold → completed`, any open state → `cancelled` |
| Approved budget; budgeted hours; financial budget | ✅ budget hours + budget amount (KWD, 3 decimals) with an append-only **revision history** (reason, who, when) |
| Actual hours | defined in §3; real values arrive with timesheets (Phase 7) — shown as 0, never estimated |
| Billing method | ✅ fixed price, time & materials, retainer, non-billable |
| Related tasks | Phase 6 |
| Project documents; activity | ✅ documents (virus-scanned files service); activity from the audit trail |
| Performance dashboard | ✅ project summary: budget vs allocated vs actual (live values as Phases 6–7 land), warnings at 80 % / 100 % |
| Prevent invalid allocations; warnings near limits | budget can never drop below hours already allocated (enforced from Phase 6); 80 % / 100 % warnings |

## 3. Hour measures (defined once, never mixed — brief "Required … budgeting workflow")
| Measure | Meaning | Source |
|---|---|---|
| **Budgeted hours** | the approved limit for the project | latest budget revision (this phase) |
| **Estimated hours** | a task's own estimate (planning aid only) | tasks (Phase 6) |
| **Allocated hours** | hours planned for a named person on a task | allocations (Phase 6); remaining = budgeted − allocated |
| **Logged hours** | time entered on timesheets, submitted or not | timesheets (Phase 7) |
| **Approved (actual) hours** | logged hours on approved timesheets | timesheets (Phase 7) |
| **Billable hours** | approved hours marked billable | timesheets (Phase 7) → invoices (Phase 12) |

## 4. Data
| Table | Key columns |
|---|---|
| `projects` | tenant_id, id, number, client_id, contract_id (FK with client_id → contract of the same client), name_en, name_ar, description, manager_membership_id, status, start_date, end_date, billing_method, budget_hours numeric(10,2), budget_amount numeric(20,3), currency, budget_revision, archived_at, version, created_by, timestamps |
| `project_members` | tenant_id, project_id, membership_id, added_by, added_at (PK tenant+project+membership) |
| `project_budget_revisions` | tenant_id, project_id, revision_no, budget_hours, budget_amount, reason, changed_by, created_at — append-only |
| `project_documents` | tenant_id, project_id, file_id, added_by, created_at |
All forced RLS, composite FKs; `contracts` gains a unique key (tenant_id, client_id, id) for the same-client rule.

## 5. Permissions
| Permission | Owner | CEO | Manager | Team Lead | Employee | Finance |
|---|---|---|---|---|---|---|
| projects.project.read | company | company | company | project | project | company |
| projects.project.create | company | company | company | — | — | — |
| projects.project.manage (details, team, status, documents) | company | company | project | — | — | — |
| projects.budget.update | company | company | project | — | — | — |
| projects.budget.override (reduce below allocated) | company* | company* | — | — | — | — |
**Project scope** = projects the person manages or is a team member of. The guard now accepts a minimum scope per route; the service checks the specific project.

## 6. Status machine
`planned → active`, `active → on_hold`, `on_hold → active`, `active → completed`, `planned|active|on_hold → cancelled`. Completed and cancelled projects are read-only (budget and team frozen).

## 7. API
| Route | Permission (minimum scope) | Notes |
|---|---|---|
| `GET /projects` | read (project) | search, status, clientId, `mine=true`, cursor; project-scope holders always get only their projects |
| `POST /projects` | create (company) | revision 1 "Initial budget"; manager + memberIds become the team |
| `GET /projects/:id` | read (project) | 404 when not visible; `actions` / `nextStatuses` say what this person may do |
| `PATCH /projects/:id` | manage (project) | optimistic `version`; refused on completed/cancelled |
| `POST /projects/:id/status` | manage (project) | §6 machine |
| `PUT /projects/:id/members` | manage (project) | replaces the team; manager always kept; active members of this company only |
| `GET / POST /projects/:id/budget` | read / budget.update (project) | history newest first / new revision with reason; below-allocated needs `override` + budget.override |
| `GET /projects/:id/hours` | read (project) | the six measures of §3 + warning (none / approaching ≥ 80 % / exceeded > 100 %) |
| `GET / POST /projects/:id/documents`, `DELETE …/:fileId`, `POST …/:fileId/download` | read / manage (project) | same rules as client documents (clean files only, 5-minute link) |
| `GET /projects/:id/activity` | read (project) | from the audit trail; field names and status/budget from→to only |
Dashboard: `projects { active, endingSoon }` (ending within 30 days) for company-wide readers. "Over budget" joins it in Phase 6, when allocations exist.

## 8. Acceptance criteria
1. A Manager creates a project for a client with a linked contract of **that** client (another client's contract is refused); number `P-0001`; revision 1 records the initial budget.
2. Budget change creates revision 2 with reason and author; history lists both; negative or invalid values refused.
3. Team: add/remove members (active members only); the manager is always on the team.
4. Status follows §6; completed/cancelled are read-only.
5. A Manager who does not lead/belong to a project cannot change it; an Employee sees only projects they are on; another company: 404.
6. Client page shows a Projects tab; dashboard shows active projects; palette finds projects.

## 9. Test plan
API integration (creation, contract-of-same-client, numbering, revisions, members, status machine, scope rules per role, cross-company), db constraints; journey EN + AR: create project from the client, add the colleague to the team, revise budget, start it; axe on new screens.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- "Engagement" is a display label (later company setting); the data model is "project".
- Billing methods: fixed price, time & materials, retainer, non-billable.
- Budget changes never edit in place: each is a revision with a reason.
- Project-scope access implemented now (guard minimum scope + per-project check); clients/contracts project-scope reading for team leads/employees follows in Phase 6 together with task assignment (they will then see the client and contract of their projects).

## 11. Results (2026-10-30)
- **API**: `apps/api/test/projects.spec.ts` — 12 tests, all passing against real Postgres + Mailpit: numbering + revision 1 + manager on team; validation (hours format, date order); same-client contract rule (422 `not_of_client` from the DB key); unknown manager refused; Employee cannot create; Employee sees only their projects (others 404, no actions); Manager can view but not change projects they don't work on, can manage their own; cross-company 404 and outsider can't join the team; status machine + closed projects frozen; optimistic version 409; team replace keeps manager; budget revision with reason, history, hours measures, activity from→to; app role cannot rewrite budget history (permission denied); dashboard counts.
- **Web**: Projects list (search, status, "only mine"), New project (client → that client's contracts, manager, team, billing, budget), detail (hours card with meter + warnings, details edit, budget tab with revise dialog + history, documents, activity, status card with confirmation for final states, team card with edit dialog), client **Projects** tab, sidebar + palette entries, dashboard card. EN + AR.
- **Not yet** (honest gaps): allocated / logged / approved / billable hours are 0 until Phases 6–7; the palette opens the Projects page but does not search projects by name yet; "engagement" label setting not built.
