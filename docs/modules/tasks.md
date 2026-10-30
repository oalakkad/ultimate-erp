# Module spec: Tasks & hour allocation (Phase 6)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
Tasks are the work inside a project. Each task names who does it and how many hours each person is **allocated**. Allocations use up the project's budgeted hours (Phase 5), so this module enforces the budget: two people allocating at the same moment can never together exceed it. Timesheets (Phase 7) will log time against these tasks; invoices (Phase 12) bill approved time.

## 2. Brief coverage (Module E + "Required project and task budgeting workflow")
| Required | Phase 6 |
|---|---|
| Creation, assignment, multiple assignees | ✅ a task has 0…n assignees, each with allocated hours |
| Priority, status, due date | ✅ low / normal / high / urgent; §6 workflow; start + due dates |
| Description and attachments | ✅ description; documents (virus-scanned files service) |
| Comments and activity history | ✅ append-only comments; activity from the audit trail |
| Dependencies | ✅ "blocked by" tasks of the same project; no cycles; a task cannot start while a blocker is open |
| Estimated / budgeted / actual hours | ✅ estimate (planning aid) and allocations here; actual (approved) hours from Phase 7 — shown as 0 until then |
| Approval of logged time | Phase 7 (timesheets) |
| Recurring tasks | ⏸ not built: not justified yet (decision §10) |
| Notifications | ✅ assignees notified on assignment; daily overdue alerts |
| Filters and search; list / board / calendar | ✅ list with filters + search; board by status; calendar ⏸ (decision §10) |
| Workload monitoring | ✅ per person: allocated hours on open tasks (all projects), shown while allocating; capacity limits arrive with employee records (Phase 8) |
| Overdue alerts; audit history | ✅ |
| Workflow steps 1–12 | ✅ client → project → budget shown → task → people → hours each → remaining shown live → workload shown → validated → saved atomically → notified → dashboards updated |

## 3. Measures (continuing projects.md §3)
- **Estimated hours** — the task's own estimate; never counted against the budget.
- **Allocated hours** — the sum of allocations on tasks that are not cancelled. Completed tasks keep their allocations (the work was planned and done); cancelled tasks release them.
- **Remaining (unallocated)** = project budgeted − allocated.
- **Workload** of a person = their allocations on open (not completed, not cancelled) tasks.

## 4. Data
| Table | Key columns |
|---|---|
| `tasks` | tenant_id, id, project_id, number (T-0001 per company), title, description, status, priority, start_date, due_date, estimated_hours, completed_at, overdue_notified_on, version, created_by, timestamps |
| `task_allocations` | tenant_id, task_id, project_id, membership_id, hours numeric(10,2) ≥ 0 — PK (tenant, task, membership); FK (tenant, project, task) → tasks so the project can't be faked; FK (tenant, project, membership) → project_members (assignees must be on the team) |
| `task_dependencies` | tenant_id, task_id, blocked_by_task_id, project_id — both tasks in the same project (composite FKs), no self-reference |
| `task_comments` | tenant_id, id, task_id, author_user_id, body, created_at — append-only |
| `task_documents` | as project_documents |
All forced RLS; app role cannot update/delete comments.

## 5. Permissions
| Permission | Owner | CEO | Manager | Team Lead | Employee | Finance |
|---|---|---|---|---|---|---|
| tasks.task.read | company | company | company | project | own | company |
| tasks.task.manage (create, edit, dependencies, any status) | company | company | project | project | — | — |
| tasks.task.work (move my task through the workflow, comment) | company | company | project | project | own | — |
| tasks.allocation.manage (assignees + hours) | company | company | project | project | — | — |
| projects.budget.override (allocate beyond the budget, with reason) | company* | company* | — | — | — | — |
**own** = tasks I am assigned to; **project** = tasks of projects I manage or am on. *Two-factor required.

## 6. Workflow
`backlog → ready → in_progress → in_review → completed`; steps back allowed (`ready → backlog`, `in_progress → ready`, `in_review → in_progress`); `completed → in_progress` (reopen) with `tasks.task.manage`; any open status → `cancelled`. A task can't move to `in_progress` while a blocker is open. Tasks of a completed or cancelled project are read-only.

## 7. API
`GET /tasks` (projectId, clientId, status, priority, assignee=me|membershipId, overdue, search, cursor), `POST /tasks` (task + allocations in one transaction), `GET/PATCH /tasks/:id`, `POST /tasks/:id/status`, `PUT /tasks/:id/allocations` `{ allocations: [{ membershipId, hours }], override?, overrideReason? }`, `POST /tasks/allocation-preview` (what the allocation does to project remaining hours and each person's workload — no save), `GET/PUT /tasks/:id/dependencies`, `GET/POST /tasks/:id/comments`, task documents, `GET /tasks/:id/activity`, `GET /workload?projectId=` (per person). Project hours (`/projects/:id/hours`) now report real allocated hours. Dashboard: `tasks { open, overdue, mine }`, `projects.overBudget`.

## 8. Acceptance criteria
1. Project with 100 budgeted hours; allocate A 20, B 15, C 10 → allocated 45, remaining 55 (the brief's example), shown before and after saving.
2. An allocation beyond the remaining hours is refused (409 `over_budget`) unless someone with `projects.budget.override` confirms with a reason (audited).
3. Two simultaneous allocations that together exceed the budget: one succeeds, the other is refused (project row lock; tested with parallel requests).
4. Assignees must be on the project team; cancelled tasks release hours; completed keep them; budget revision below allocated refused.
5. Employee sees only tasks assigned to them, can move them through the workflow and comment, cannot edit allocations; another company: 404.
6. Dependencies: same project only, no cycles, blocked task can't start.
7. Assignees get a notification; when a task becomes overdue its assignees are alerted once (daily 08:00 Kuwait job; changing the due date re-arms the alert).

## 9. Test plan
API integration (example numbers, over-budget + override, parallel allocations, team rule, cancel releases, scopes per role, dependencies + cycle, status rules, comments append-only, overdue job), db constraints; journey EN + AR: create task from the project with two people's hours, see remaining, employee moves it on the board; axe on new screens.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Task titles are single free text (users write in their language); module texts are bilingual as always.
- Recurring tasks and a calendar view are not built now (low value before timesheets); listed as gaps.
- Workload limits: no capacity figure exists before employee records (Phase 8), so allocation shows each person's current open workload but never blocks on it.
- Over-budget allocations are blocked; only `projects.budget.override` holders (Owner/CEO, two-factor) can override with a recorded reason.
- Assignees must already be on the project team (keeps project scope meaningful).
- Team leads get project scope for tasks until teams exist (Phase 8).
- A person who has hours on any task of a project cannot be removed from that project's team (their work is recorded there).
- Overdue alert: once when a task becomes overdue (not every day); changing the due date re-arms it; tasks of completed/cancelled projects never alert.

## 11. Results (2026-10-30)
- **API**: `apps/api/test/tasks.spec.ts` — 10 tests passing against real Postgres + Mailpit: the brief's example (20 + 15 + 10 of 100 → 45 / 55) via preview and save, assignment notification; over-budget refused, Manager cannot override, Owner override needs a reason and is audited, dashboard "over budget"; **three simultaneous allocations of 40 h on a 100 h budget → exactly two succeed**; assignees must be on the team; budget can't drop below allocated; people with hours stay on the team; cancelling releases hours and freezes allocations; Employee sees only assigned tasks, can work and comment, can't cancel/edit/allocate; comments append-only (app role update → permission denied); other company 404; Manager not on the project can't allocate or create; workload per team; dependencies (blocked can't start, loop refused, self refused); status machine; closed project freezes tasks and silences alerts; overdue filter + search; overdue alert once, re-armed by a new due date.
- **Web**: Tasks page (list + board by status, search, open/closed, assigned to me, overdue), New task following the 12-step workflow with a live budget/workload box and Owner override with reason, task page (workflow buttons, details edit, people & hours dialog with preview, blocked-by, comments, documents, activity), project **Tasks** tab with team workload, sidebar + palette, dashboard "My work" card, notification texts. EN + AR.
- **Not built (decided):** recurring tasks, calendar view, drag-and-drop on the board (cards open the task; status moves there), workload capacity limits (Phase 8).
