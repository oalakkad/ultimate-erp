# Module spec: Timesheets & time tracking (Phase 7)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
People record the hours they actually worked on their tasks. Each project's manager approves (or sends back) the time logged on their project. Approved time becomes the project's **actual** hours: it consumes the budget (Phase 5), shows planned vs actual per task (Phase 6), feeds invoices (billable hours, Phase 12), payroll/overtime (Phase 11) and reports (Phase 14).

## 2. Brief coverage (Module F)
| Required | Phase 7 |
|---|---|
| Manual time entry; task-linked | ✅ every entry is on a task the person is assigned to (database key) |
| Start/stop timer | ✅ one running timer per person; stopping creates a draft entry |
| Employee timesheets; weekly and monthly summaries | ✅ weekly timesheet (Sunday–Saturday, Kuwait week); summary for any period (per day, per project, billable / non-billable) |
| Submission and approval workflows | ✅ submit the week → each project's manager (or Owner/CEO) approves or rejects entries; never one's own |
| Billable and non-billable | ✅ per entry; defaults from the project's billing method (non-billable projects → non-billable) |
| Rejected-entry correction | ✅ rejected entries (with reason) are edited and the week resubmitted |
| Overtime | ⏸ Phase 11 (payroll), as a configurable company rule; summaries show daily totals now |
| Budget consumption; planned vs actual | ✅ project hours: logged / approved / billable now real; task page: allocated vs actual per person |
| Employee utilization | ✅ billable share of approved hours per person; utilisation against capacity with Phase 8 |
| Profitability | ⏸ needs cost rates (Phase 11/12) |
| Prevent accidental duplicates | ✅ identical entry (task, date, hours, description) refused unless confirmed; a day can't exceed 24 h |
| Audit when approved time is modified | ✅ approved entries are locked; an approver can reopen one with a reason (audited), sending it back for correction |

## 3. Measures (completing projects.md §3)
- **Logged** = entries in draft, submitted or approved (rejected excluded).
- **Approved (actual)** = approved entries. **Billable** = approved and billable.
- Budget consumption = approved / budgeted; the 80 % / 100 % warnings now use max(allocated, approved).

## 4. Data
| Table | Key columns |
|---|---|
| `timesheets` | tenant_id, id, membership_id, week_start (a Sunday), status (draft, submitted, approved, rejected), submitted_at, version — unique per person and week |
| `time_entries` | tenant_id, id, timesheet_id, membership_id, project_id, task_id, work_date (inside the week), hours numeric(5,2) 0 < h ≤ 24, billable, description, status (draft, submitted, approved, rejected), rejection_reason, decided_by, decided_at, version — FK (tenant, membership, timesheet) → its person's timesheet; FK (tenant, task, membership) → the task allocation (only assignees log time) |
| `time_timers` | tenant_id, membership_id (PK), project_id, task_id, started_at — FK to the allocation |
Forced RLS on all. A person who logged time on a task can't be removed from it.

## 5. Permissions
| Permission | Owner | CEO | Manager | Team Lead | Employee | Finance |
|---|---|---|---|---|---|---|
| time.entry.create (my own time, timer, submit) | own | own | own | own | own | own |
| time.entry.read | company | company | project | own | own | company |
| time.timesheet.approve | company | company | project/team | team | — | — |
Manager "project" approval = projects they **manage** (the project's manager). Team scope starts with teams (Phase 8). Nobody approves their own time (API + DB check).

## 6. Workflow
Timesheet: `draft → submitted`; after decisions: all approved → `approved`, any rejected → `rejected` (editable) → resubmit → `submitted`. Entries: `draft → submitted → approved | rejected → (edit) → submitted`. Approved entries are read-only except "reopen with reason" by an approver (→ rejected, audited). A submitted or approved week takes no new entries.

## 7. API
`GET /timesheets/mine?week=` (the week containing the date; empty if none), `POST /time-entries`, `PATCH/DELETE /time-entries/:id`, `POST /timesheets/:id/submit`, `GET /approvals/time` (entries waiting for me), `POST /time-entries/approve` `{ ids }`, `POST /time-entries/reject` `{ ids, reason }`, `POST /time-entries/:id/reopen` `{ reason }`, `GET/POST /timer`, `POST /timer/stop`, `GET /time/summary?from&to&membershipId`, `GET /tasks/:id/time` (allocated vs actual per person). Dashboard: `time { thisWeekHours, waitingForMe }`.

## 8. Acceptance criteria
1. An assignee logs 3.5 h on a task; someone not assigned can't; more than 24 h in a day refused; an identical second entry needs confirmation.
2. Submit week → project manager notified → approves → project approved and billable hours update; non-billable project entries are non-billable.
3. Reject with reason → person notified, edits, resubmits → approved.
4. Nobody approves their own time; a Manager can't approve time on projects they don't manage; another company 404.
5. Approved entries can't be edited; reopen with reason is audited and returns the entry for correction.
6. Timer start/stop creates a draft entry with the elapsed hours.
7. Summary for a period: per day, per project, billable vs non-billable; task shows allocated vs actual.

## 9. Test plan
API integration for each criterion + db constraints (entry must match allocation and its week); journey EN + AR: Owner logs time on the Phase 6 task and submits; the Manager approves; project hours show approved time; axe on new screens.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Kuwait work week: weeks run Sunday–Saturday (company setting later).
- Approval per entry by the project's manager (or Owner/CEO); one timesheet can span several projects and approvers.
- Only people allocated to a task can log time on it (keeps planned vs actual meaningful).
- Overtime and profitability wait for payroll/cost rates (Phases 11–12); no legal overtime values are assumed here.
- Hours are entered with up to 2 decimals; the timer rounds elapsed time up to the next minute.

## 11. Results (2026-10-30)
- **API**: `apps/api/test/time.spec.ts` — 8 tests passing against real Postgres + Mailpit: assignee logs 3.5 h; outsider (not assigned) 422; future date 422; > 24 h single entry and > 24 h day refused; identical entry needs confirmation; Sunday week + 7-day totals; someone with logged time stays on the task; non-billable project forces non-billable; timer start / second start 409 / stop → 1.5 h draft; submit → week locked → manager notified → approval list → approve → timesheet approved, person notified, project logged/approved/billable 6/6/6, task planned vs actual; approved entry can't be deleted; reopen with reason → rejected, audited, approved hours back to 0; reject needs a reason, person notified, corrects (→ draft), resubmits, approved; own time never approved (API 403 + database trigger), Owner told when the manager logs on their own project; non-managing manager and employees can't approve; another company 404; summary per day/project with billable share 37 %; others' summaries need company read; entry kept inside its week (database trigger).
- **Web**: My time (week navigation, 7-day totals, log-time form on my open tasks with duplicate confirmation, entries with status, correction dialog, delete, submit week, timer), Time approvals (grouped by person, select, approve, send back with reason), task page "Planned vs actual" with "Log time", sidebar + palette, dashboard Time card, notification texts. EN + AR.
- **Not yet (honest gaps):** overtime (Phase 11, configurable), profitability (needs cost rates), utilisation against capacity (Phase 8), a screen listing approved entries to reopen (API exists; reopening from the UI comes with reports in Phase 14), monthly summary screen (API supports any period).
