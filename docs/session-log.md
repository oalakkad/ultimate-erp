# Session Log

Hand-off notes between working sessions. **Newest entry first.** Every session ends by adding an entry; every session starts by reading the newest entry, then `project-status.md` and `requirements-checklist.md`.

Each entry: date · what was done · state of the repo (commits, uncommitted work, running services) · verification results (real numbers) · decisions made · open items / waiting on owner · exact next step.

---

## 2026-10-30 — Session 6 (continued): Phase 10 (Attendance) built + committed

### Hand-over 10 (A–H)
- **A Built:** kiosk sites showing a rotating, HMAC-signed QR (new every 30 s), one-tap scan page, web check-in (company setting), automatic in/out alternation with a minimum gap, shifts with grace and break, per-day late / early / worked / absent / leave / holiday, comparison with logged time, who-is-in board, correction requests with approval, dashboard card, notifications. See `docs/modules/attendance.md` §9.
- **B Files:** contracts `attendance.ts`, permissions (+4 attendance), notifications (+2), dashboard (`attendance`); db `schema/attendance.ts` (incl. general `company_settings`), migrations 0027/0028 (incl. `app.attendance_corrections_guard`), isolation list; api `modules/attendance/` (service with `KioskCodes`, controller), dashboard, `test/attendance.spec.ts`; web `routes/attendance/` (attendance, kiosk, scan), router (kiosk outside the frame), app-layout, dashboard, notification bell, dependency `qrcode` 1.5.4 (MIT, already in the lockfile), i18n `attendance` EN/AR; journey Phase 10 steps; `waitForSteadyApi` now waits for 8 healthy seconds.
- **C Architecture:** kiosk (admin session) → signed code → phone (member session) → check → append-only events → per-day computation from events + shift + employee schedule + approved leave + holidays + time entries.
- **D Security:** codes bound to company, site and window, constant-time comparison, replay table with unique key, server time only; events insert-only for the app; corrections can't be self-approved (API + trigger); team scope per person; no IP or location stored.
- **E Tests:** `pnpm check` **356** passed (api 232, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (one earlier run failed only because the API restarted several times after the pre-build — the wait is now stricter); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). Found during testing: an identical Arabic/English label and a weak cross-company test (both fixed).
- **F Verify:** project-status "How to verify Phase 10".
- **G Open:** location verification (decided not needed), payroll use of the summary (Phase 11), mobile app (Phase 16).
- **Repo state:** committed ("Phase 10"); `pnpm dev` running; dev DB migrated to 0028. Not pushed.
- **H Next:** Phase 11 Payroll — rules as company settings flagged "to be verified by a Kuwaiti lawyer/accountant"; preparation and approval by different people; payslips; no real payroll before verification.

---

## 2026-10-30 — Session 6 (continued): Phase 9 (Leave management) built + committed

### Hand-over 9 (A–H)
- **A Built:** company leave types (four Kuwait defaults flagged "to be verified by a Kuwaiti lawyer/accountant"), public holidays, ledger-based balances with monthly/yearly accrual from the joining date, applications counting working days minus holidays (half days, documents), approval by team lead/manager/Owner/CEO/HR, reject with note, withdraw, cancel with restoration, overlap check, team calendar, notifications, dashboard Leave card. See `docs/modules/leave.md` §11.
- **B Files:** contracts `leave.ts`, permissions (+`leave.request.create`, `leave.request.read`, `leave.policy.manage`), notifications (+4), dashboard (`leave`); db `schema/leave.ts`, migrations 0025/0026 (incl. `app.leave_requests_guard`), isolation list; api `modules/leave/` (service, controller), dashboard, `test/leave.spec.ts`, access test update; web `routes/leave/leave.tsx`, router, app-layout, dashboard card, notification bell; i18n `leave` EN/AR; journey Phase 9 steps.
- **C Architecture:** employee record (schedule, joining date) + leave type (policy) + holidays → working days; approval writes ledger rows (one per year of the leave) inside one transaction with the person's employee row locked; balances are always computed from policy + ledger.
- **D Security:** forced RLS on 4 new tables; ledger append-only for the app and unique per (request, kind, year) so a request can't be deducted or restored twice even in a race; database trigger blocks self-decisions; team scope checked per request; supporting documents must be my own uploads.
- **E Tests:** `pnpm check` **351** passed (api 227, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (first run); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). The catalog test caught one untranslated Arabic label (fixed).
- **F Verify:** project-status "How to verify Phase 9".
- **G Open:** adjustments screen (API exists), carry-over/expiry rules, leave reducing capacity, attendance and payroll links (Phases 10–11). **Owner action:** have a Kuwaiti lawyer/accountant review the four default leave types before real use.
- **Repo state:** committed ("Phase 9"); `pnpm dev` running; dev DB migrated to 0026. Not pushed.
- **H Next:** Phase 10 Attendance (check-in/out with a rotating signed QR code, per brief Module I and "QR code security").

---

## 2026-10-30 — Session 6 (continued): Phase 8 (Employees & teams) built + committed

### Hand-over 8 (A–H)
- **A Built:** employee records (E-0001) for members with job title, department, manager, employment type, dates, weekly hours and working days; lifecycle onboarding → active ⇄ on leave → offboarding → left with checklists; departments, teams (lead + members), reporting lines; documents (confidential flag); private details and emergency contacts encrypted at rest; append-only history; capacity/utilisation in time summaries. Web: People, person page, Organisation. See `docs/modules/people.md` §11.
- **B Files:** contracts `people.ts`, permissions (+`people.employee.manage` (two-factor), +`people.org.manage`), `time.ts` (capacity); db `schema/people.ts`, migrations 0023/0024, isolation list; api `platform/crypto/field-cipher.ts` (+spec), config `DATA_ENCRYPTION_KEY`, `modules/people/` (service with `teamScopeOf`, controller), time service (capacity), `test/people.spec.ts`, config/logger spec updates; web `routes/people/` (list, detail, organisation), shared `DocumentsTab` takes a schema, router, app-layout; i18n `people` EN/AR; journey Phase 8 steps.
- **C Architecture:** membership (sign-in, roles) → employee record (HR) → teams / reporting line → "team" scope for later modules (leave approvals use `teamScopeOf`).
- **D Security:** forced RLS on 9 new tables; private data sealed with AES-256-GCM bound to the company, separate key, keyed hash for civil-ID uniqueness, never logged (audit records field names only), every restricted read audited; employment details limited to company readers, HR, the person and their manager; leaving suspends company access; only an Owner ends an Owner's/CEO's employment and never the last Owner.
- **E Tests:** `pnpm check` **346** passed (api 222, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (two locator fixes in the new steps, no product defects); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only).
- **F Verify:** project-status "How to verify Phase 8".
- **G Open:** time approval by team leads (time stays with project managers); Kuwaiti legal field validation (Phase 11); self-service edits beyond private details.
- **Repo state:** committed ("Phase 8"); `pnpm dev` running; dev DB migrated to 0024. **Local `.env` changed:** a random dev-only `DATA_ENCRYPTION_KEY` was added (not committed). Not pushed.
- **H Next:** Phase 9 Leave management (leave types and balances as company settings flagged "to be verified", requests, approval by team lead/manager, calendar, integration with timesheets/capacity).

---

## 2026-10-30 — Session 6 (continued): Phase 7 (Timesheets & time tracking) built + committed

### Hand-over 7 (A–H)
- **A Built:** time entries on tasks the person is assigned to, a timer, weekly timesheets (Sunday–Saturday), submit → approval by each project's manager (Owner/CEO anywhere) with send-back and correction, reopen of approved time with a reason, duplicate and 24-hour-a-day guards, billable defaults from the project, period summaries, planned vs actual per task; projects now show real logged / approved / billable hours. Web: My time, Time approvals, task "Planned vs actual", sidebar, palette, dashboard Time card, notifications. See `docs/modules/timesheets.md` §11.
- **B Files:** contracts `time.ts`, permissions (+`time.entry.read`), notifications (+3), dashboard (`time`); db `schema/time.ts`, migrations 0021/0022 (incl. `app.time_entries_guard` trigger), isolation list; api `modules/time/` (service, controller), projects service (real time totals), tasks service (keep people with logged time), dashboard, `test/time.spec.ts`, access test update; web `routes/time/` (my-time, approvals, task-time), router, app-layout, task detail, dashboard, notification bell; i18n `time` EN/AR; journey Phase 7 steps + `waitForSteadyApi` (fixes a start-up race after the pre-build).
- **C Architecture:** allocation → time entries (composite FK: only assignees log time) → timesheet of the same person (composite FK) → project totals. Approval is per entry, so one week can go to several project managers.
- **D Security:** forced RLS on 3 new tables; database trigger keeps entries inside their week, blocks self-decisions and deleting submitted/approved entries; API re-checks approver scope per entry; approved time locked; reopen audited with reason.
- **E Tests:** `pnpm check` **337** passed (api 213, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (one earlier failure was the API restarting after the pre-build; fixed with a steady-API wait); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). The catalog test caught an untranslated Arabic label (fixed).
- **F Verify:** project-status "How to verify Phase 7".
- **G Open:** overtime (Phase 11), profitability (11/12), utilisation vs capacity (8), UI to browse approved entries for reopening (API exists), monthly summary screen.
- **Repo state:** committed ("Phase 7"); `pnpm dev` running; dev DB migrated to 0022. Not pushed.
- **H Next:** Phase 8 Employee & team management (employee records with restricted fields, teams, capacity → team scopes and utilisation).

---

## 2026-10-30 — Session 6 (continued): Phase 6 (Tasks & hour allocation) built + committed

### Hand-over 6 (A–H)
- **A Built:** tasks (T-0001, priority, dates, estimate, workflow backlog → ready → in progress → in review → completed / cancelled, dependencies, comments, documents, activity) and per-person hour allocations checked against the project budget inside one transaction with the project row locked, Owner/CEO override with a reason; live preview of remaining hours and workload; workload per person; assignment + overdue notifications (daily 08:00 Kuwait job `tasks.daily`); project allocated hours and "over budget" now real. Web: Tasks list + board, New task (12-step workflow), task page, project Tasks tab, sidebar, palette, dashboard "My work". See `docs/modules/tasks.md` §11.
- **B Files:** contracts `tasks.ts`, permissions (+3: tasks.task.read/manage/work; team lead allocation now project scope), notifications (+2), dashboard (`tasks`, `projects.overBudget`); db `schema/tasks.ts`, migrations 0019/0020, `jobs.ts` (`tasks.daily`), isolation list; api `modules/tasks/` (service with `TasksDailyHandler`, controller), projects service (real allocated hours, team-removal guard), dashboard, worker registration, `test/tasks.spec.ts`, small updates to projects/access/contracts permission tests; web `routes/tasks/` (list, new, detail, shared, project-tab), router, app-layout, project detail tab, dashboard card, notification bell texts; i18n `tasks` EN/AR; journey Phase 6 steps.
- **C Architecture:** project → tasks → allocations (composite FKs: an allocation's project must be its task's project, and the person must be on that project's team). Every allocation change locks the project row first, so concurrent requests are checked one after another against the same budget. Timesheets (Phase 7) will log time against task allocations.
- **D Security:** forced RLS on 5 new tables; comments append-only for the app role (tested); scope checks per task (own = assigned, project = on the team); override needs a two-factor permission + reason (audited); other companies 404.
- **E Tests:** `pnpm check` **329** passed (api 205, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed on the first run; `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only). Found and fixed during testing: the overdue job would have alerted on tasks of cancelled projects.
- **F Verify:** project-status "How to verify Phase 6".
- **G Open:** recurring tasks, calendar view, board drag-and-drop (decided not now); workload capacity limits (Phase 8); actual/approved hours (Phase 7); palette does not search tasks by title yet.
- **Repo state:** committed ("Phase 6"); `pnpm dev` running; dev DB migrated to 0020. Not pushed.
- **H Next:** Phase 7 Timesheets & time tracking (log time against allocations, submit/approve/reject, actual vs allocated vs billable).

---

## 2026-10-30 — Session 6: Phase 5 (Projects & budgeting) built + committed

### Hand-over 5 (A–H)
- **A Built:** projects per client (optional contract of the same client), P-0001 numbering, manager + team, status machine (planned → active ⇄ on hold → completed; open → cancelled; closed = frozen), budget hours/amount with append-only revisions (reason, who, when), hours summary (budgeted / allocated / remaining / logged / approved / billable + 80 %/100 % warnings), documents, activity, project-scoped access. Web: list, new, detail, client Projects tab, sidebar, palette, dashboard card, EN + AR. See `docs/modules/projects.md` §11.
- **B Files:** contracts `projects.ts`, `permissions.ts` (project read/manage scopes), `dashboard.ts`; db `schema/projects.ts`, `contracts.ts` (tenant+client+id key), migrations 0017/0018, isolation list; api `modules/projects/` (service, controller), access guard minimum scope (`RequirePermission(p, scope)`), dashboard section, `test/projects.spec.ts`; web `routes/projects/` (list, new, detail, client-tab, shared), `lib/session.ts` `canAny`, router, app-layout, client detail tab, dashboard, client `DocumentsTab` made generic (`basePath`); i18n `projects` EN/AR; journey Phase 5 steps.
- **C Architecture:** client → project (→ contract of the same client via composite FK). The guard lets project-scope roles through; the service then checks "manager or team member" on the specific project and answers 404 otherwise. Tasks (Phase 6) and timesheets (Phase 7) will feed the hour measures through `ProjectsService.hours`.
- **D Security:** forced RLS on 4 new tables; budget history insert-only for the app role (tested: permission denied on update); team members must be active members of this company; server re-checks permission + state on every change; no client-supplied company IDs.
- **E Tests:** `pnpm check` **320** passed (api 196, db 39, contracts 36, web 23, ui 16, i18n 10); `pnpm e2e:journey` 2 passed (first attempt failed because the API was restarting after the check's rebuild; second run found one ambiguous locator in my new step, fixed; third run 2 passed); `pnpm e2e` 6 passed; `pnpm security` clean (accepted esbuild moderate only).
- **F Verify:** project-status "How to verify Phase 5".
- **G Open:** allocated/logged/approved/billable are 0 until Phases 6–7; dashboard "over budget" count with Phase 6; palette does not search projects by name yet; "engagement" label setting not built; Team leads/Employees cannot yet open the client/contract of their projects (Phase 6).
- **Repo state:** committed (see git log, "Phase 5"); `pnpm dev` running in the background; dev DB migrated to 0018. Not pushed.
- **H Next:** Phase 6 Tasks & hour allocation (concurrency-safe allocations against the project budget).

---

## 2026-10-30 — Session 5 (continued): Phase 4 (Contracts & engagement letters) built + committed

### Hand-over 4 (A–H)
- **A Built:** see `docs/modules/contracts.md` §10.
- **B Files:** contracts `agreements.ts`, permissions (+4), notifications (+5 types), dashboard; db `schema/contracts.ts`, migrations 0015/0016, `jobs.ts` (`contracts.daily`); api `modules/contracts/`, `platform/database/numbering.ts`, Notifier `notifySystem`, `TenantDatabase.activeTenantIds`, `JobQueue.schedule`, worker registration, dashboard section, `test/contracts.spec.ts`; web `routes/contracts/` (list, new, detail, print, templates, client-tab, shared), router, nav, palette, client tab, dashboard card, notification texts; ui Dialog description type.
- **C Architecture:** client → contracts (composite FK); one state machine (`TRANSITIONS`) drives both the API checks and the `actions` the UI shows; the daily job iterates companies by ID and works inside each with RLS.
- **D Security:** separation of duties in API + DB; transitions re-check permission + source state server-side; signed copy must be my own clean upload; documents never deleted; print view uses the same authorised API; "Signed" is never presented as an e-signature.
- **E Tests:** `pnpm check` **308** passed; journey EN + AR 2 passed; gallery 6; `pnpm security` clean.
- **F Verify:** project-status "How to verify Phase 4".
- **G Open:** server-side PDF (Phase 12 with invoices); e-signature provider (integration, later); projects/invoices links come with Phases 5/12. Dev processes: same orphan note as Phase 3 (a fresh `pnpm --filter @ultimate-erp/api dev` serves :3000 next to the old vite on :5173).
- **H Next:** Phase 5 Projects / engagements & budgeting.

---

## 2026-10-30 — Session 5 (continued): Phase 3 (Clients / CRM) built + committed

### Hand-over 3 (A–H)
- **A Built:** the clients module end to end. See `docs/modules/clients.md` §10.
- **B Files:** contracts `clients.ts` (+spec), `permissions.ts` (+4 permissions, matrix in permissions.md), `dashboard.ts`; db `schema/clients.ts`, migrations 0013/0014, isolation tests; api `modules/clients/` (service, controller), dashboard clients section, `test/clients.spec.ts`, `test/support/people.ts` (shared helpers, used by the client suite); web `routes/clients/` (list, new, detail, tabs, client-form, keys), router, app-layout (nav + palette), dashboard card, `lib/api.ts` (FormData), `lib/use-debounced.ts`; i18n `clients` section EN/AR.
- **C Architecture:** client → contacts / interactions / documents (files service) / activity (audit trail). Later modules link through composite foreign keys `(tenant_id, client_id)`.
- **D Security:** RLS on 5 new tables, composite FKs (a contact of client A can't be used for client B), append-only history, permission per route (Employee 403, other company 404), literal search, CSV injection neutralised (mutation-checked), only my own clean uploads can be attached, downloads by client permission.
- **E Tests:** `pnpm check` passed with **300** (api 176, db 39, contracts 36, web 23, ui 16, i18n 10); journey EN + AR 2 passed (real ClamAV scan); gallery 6 passed; `pnpm security` clean.
- **F Verify:** project-status "How to verify Phase 3".
- **G Open / environment notes:** the access and files suites still have their own copies of the people helpers (move them to `support/people.ts` when next touched). **Dev processes:** my first `pnpm dev` (started 2026-10-29 19:17) left orphans after a TaskStop: vite on :5173 (pid 22084), a concurrently tree (pid 9528) with a parked API watcher (3488) and worker watcher (12732). Stopping them was blocked by the safety check, so a fresh `pnpm --filter @ultimate-erp/api dev` (API :3000 + worker) runs next to them. **The owner should close stray node processes** (Task Manager, or restart the PC) before the next `pnpm dev`.
- **H Next:** Phase 4 Contracts & engagement letters (bilingual templates, PDF, numbering, versions, approval/sign-off, linking to clients).

---

## 2026-10-29 — Session 5 (continued): Phase 2b (dashboard) built + committed — Phase 2 complete

### Hand-over 2b (A–H)
- **A Built:** the dashboard from real records only: getting-started progress (company, two-factor, invitation, colleague joined), Team tiles (active members, pending invitations), Recent activity (translated business events from the audit log), quick actions, each shown only with the permission. Reusable accessible charts `BarChart`, `LineChart`, `Meter`, demonstrated in the gallery with labelled example data.
- **B Files:** contracts `dashboard.ts`; api `modules/dashboard/dashboard.controller.ts` (service + controller + module); ui `charts.tsx` (+ `charts.spec.tsx`), `tokens.css` `--series-1…8`; web `routes/dashboard.tsx` (rewritten), `routes/gallery.tsx` (Charts section), router (`/members?invite`); i18n dashboard and gallery texts EN/AR; journey dashboard steps and screenshots.
- **C Architecture:** one summary endpoint; each module will add its own section (permission-gated) and card. Charts take translated labels and a value formatter, so money stays a formatted string (KWD 3 decimals) at the edge.
- **D Security:** sections are computed server-side per permission inside the tenant transaction; the activity feed sends actor names and action codes only (audit details can contain email addresses).
- **E Tests:** `pnpm check` passed with **275** (api 162, db 37, contracts 27, web 23, ui 16, i18n 10); journey EN + AR passed; gallery 6 passed (axe incl. charts); `pnpm security` clean. The palette was validated with the dataviz validator on our surfaces. Rendered screenshots were reviewed and fixed for two clipping issues and one ARIA issue (labels on role-less SVG marks).
- **F Verify:** project-status "How to verify Phase 2b".
- **G Open:** the date-range filter is deferred to the first module card that needs a period (Phase 3+); there is no drill-down yet because there are no business records yet.
- **H Next:** Phase 3 Clients / CRM. Write `docs/modules/clients.md` from brief Module B (+ §11 connections, §13 data), pick defaults, then build: data model + RLS, API, list (table with sort/filter/search/pagination — the first real data table), detail with activity timeline, documents via the 1.5b files, dashboard card, palette search, tests, journey.

---

## 2026-10-29 — Session 5 (continued): Phase 2a (shell) built + committed

### Hand-over 2a (A–H)
- **A Built:** command palette (Ctrl K / ⌘ K) over pages, actions and people with Arabic-aware matching; company switcher; phone navigation drawer; breadcrumbs (`PageHeader`); in-app navigation without reloads; My account name editing and password change; palette "Invite a colleague" opens the Members invite dialog.
- **B Files:** ui `menu.tsx`, `shell.tsx` (PageHeader, NavItem onClick, SearchBox button), `overlays.tsx` (Drawer side, Dialog initialFocus); web `components/command-palette.tsx`, `components/page-header.tsx`, `components/app-layout.tsx` (rewritten), `lib/commands.ts` (+spec), `lib/handoff.ts`, `app/switches.tsx` (`useChangeLocale`), `routes/account.tsx`, `routes/members.tsx`, `routes/dashboard.tsx`; i18n `palette` section + shell/account keys; spec `docs/modules/shell-dashboard.md`.
- **C Architecture:** commands are built in `AppLayout` from the person's access and data; modules will add their own pages, actions and searchable records. The switcher uses the 1.4b hand-off.
- **D Security:** the palette and switcher only offer what the person may do (UX only; the server still checks everything); password change re-checks the current password and signs out other sessions.
- **E Tests:** `pnpm check` passed with **265** (api 159, db 37, contracts 27, web 23, i18n 10, ui 9); journey EN + AR passed twice; `pnpm e2e` 6 passed; `pnpm security` clean (except the accepted esbuild moderate). axe found 2 real issues, now fixed: the switcher's accessible name didn't match its visible text, and focus didn't start in the palette field. The journey's axe helper now names the failing elements and waits for colour transitions.
- **F Verify:** project-status "How to verify Phase 2a".
- **G Open:** the main-address derivation assumes `<slug>.<main>` hosts (custom domains later); member results in the palette open the Members list (no per-person page until Phase 8).
- **H Next:** Phase 2b per `shell-dashboard.md` §4.

---

## 2026-10-29 — Session 5 (continued): 1.5a committed, nonstop mode, Milestone 1.5b built + committed

### Owner direction
"next, do all at once, finish the whole project". Owner chose **Nonstop, you pick defaults** and **Kuwaiti rules as configurable settings, flagged "to be verified"**. CLAUDE.md, memory (`nonstop-build-mode.md`) and project-status Decisions are updated. From now on: build → `pnpm check` + `pnpm security` (+ browser tests) → hand-over A–H here → commit → next milestone, without waiting.

### Hand-over 1.5b (A–H)
- **A Built:** file uploads (content-type allow-list by magic bytes, 25 MB limit, private S3 storage under a per-company prefix, ClamAV scan in the worker, downloads only when clean via 5-minute signed attachment links, uploader-only access for now); error reports in the Sentry protocol (own sender, off unless `SENTRY_DSN`, scrubbed); slow-request log; Docker images (API/worker, web with nginx) + on-prem compose example; ClamAV in dev compose.
- **B Files:** `packages/db/src/schema/files.ts`, migrations 0011/0012, `jobs.ts` (`file.scan` queue); `apps/api/src/platform/files/` (object-storage, virus-scanner, file-types), `platform/monitoring/monitoring.ts`, `platform/request-context/slow-request.middleware.ts`, `modules/files/` (service + controller), `AuditLog.recordSystem`, `worker.module.ts` (file.scan handler); contracts `files.ts` + error `FILE_NOT_READY` (EN/AR); `infra/docker/*`, `infra/compose/compose.prod.example.yaml`, `.dockerignore`; tests `files.spec.ts`, `monitoring.spec.ts`, support `storage.ts`, `tcp-relay.ts` (shared with jobs.spec).
- **C Architecture:** upload → API checks type and size → S3 put + `files` row + `file.scan` job in one transaction → worker streams the object to clamd → `clean`, or `infected` (object deleted, audited), or `scan_failed` after retries → download link only for `clean`. The scan job carries `tenantId` and runs inside `withTenant`.
- **D Security:** type comes from the bytes, not the name (a disguised .exe is refused); no SVG/HTML/archives/macro Office files; the storage key is random and DB-forced under the company prefix; links are attachment-only, short-lived and tamper-proof (signature); every other member or company gets 404; reports carry IDs only. **Licence gate caught** `@sentry/node` 11 pulling an FSL-1.1 (non-open-source) package, so the SDK was replaced by our own sender.
- **E Tests:** `pnpm check` passed: api 159, db 37, contracts 27, web 18, i18n 10, ui 9 = **260**. Browser 8 passed. `pnpm security`: licences OK (320), no leaks, only the accepted esbuild moderate. Mutation checks: type check, scanner verdict, email scrubbing. Images built and started locally.
- **F Verify:** project-status "How to verify Milestone 1.5b".
- **G Open:** OpenTelemetry traces deferred to Phase 15 (ESM loader hook); no upload UI until Phase 3; ClamAV needs ~1 GB RAM and 1–2 min to start (`pnpm dev` now waits for it after `services:up` restarts it); the CI `images` and `journey` jobs have not run on GitHub yet (no remote).
- **H Next:** Phase 2 (executive shell & dashboard). Plan it from roadmap + brief, pick defaults, build.

---

## 2026-10-29 — Session 5: Milestone 1.5a built, awaiting owner approval

### Where we are
The owner said "continue" after the gaming pause. Claude restarted Docker Desktop and finished 1.5a. **Everything is built and verified but NOT committed**; the owner tests it and approves. After "approved": commit "Milestone 1.5a: background jobs and notifications", then plan **1.5b** (files with ClamAV, monitoring configurable and off by default, Dockerfiles). Its decisions were already made on 2026-10-28; still present the short plan before building.

### What was done this session
- Fixed the paused compile error (identity emails return `Promise<void>` again).
- Worker added to `pnpm dev` (api `dev` script: tsc, api, worker) and to the CI `journey` job. Identity and access tests start a worker in-process (`createWorker`).
- `apps/api/test/jobs.spec.ts`: 5 outbox tests, with a real SMTP outage simulated by a switchable relay. Mutation-checked: the rollback test and the encryption test each fail when their protection is removed.
- Notifications: `platform/notifications/notifier.ts` (send side, cap 200, audited), `modules/notifications/` (4 endpoints), hooked into invitation accept (Owners/CEOs) and role change (that member). Tests in `access.spec.ts`; the audit test now expects `notifications.notification.sent` events.
- **Bug found by the database guard:** the notification link rule rejected `/`. Fixed in migration 0010.
- Web: `components/notification-bell.tsx` (bell, unread count every 60 s, panel, mark read / all, "Show older"), hidden while two-factor setup is required. Members shows "Email not delivered" on a failed invitation. EN/AR texts added. The journey now checks the bell (axe on the panel).
- Docs: platform-jobs.md (status, corrections: 6 attempts in total; cross-tenant job test deferred to the first company-data job; §9 results), api.md, testing.md, database.md (job queue section), README (worker; `db:generate --name=` without `--`), checklist, roadmap, project-status.

### Verification (real results, 2026-10-29)
- `pnpm check`: passed. api 148, db 37, contracts 27, web 18, i18n 10, ui 9 = **249**.
- `pnpm e2e:journey`: **2 passed** (EN, AR). `pnpm e2e`: **6 passed**.
- `pnpm security`: licences OK (294 packages), no leaks. Audit: only the accepted moderate esbuild advisory.

### Repo state
- Last commit `f1f9276` (1.4b). All 1.5a work is uncommitted: migrations 0008–0010, new deps pg-boss (api, db), the new files above.
- Dev DB migrated to 0010. `pnpm dev` is running in the background (started by Claude: API :3000, worker, web :5173). Docker Desktop is running.
- The dev DB has more `e2e-*` companies and `@example.test` accounts from journey runs (harmless).

### Waiting on owner
Test 1.5a (project-status.md "How to verify Milestone 1.5a") and approve.

---

## 2026-10-28 — Session 4 (continued): 1.4b approved + committed, 1.5a planned

### Where we are
Owner said "next" → 1.4b committed `f1f9276`. Milestone 1.5 planned and split. Owner decisions: split 1.5a/1.5b; monitoring configurable + off by default; ClamAV scanning; notification bell in 1.5a. Spec written: `docs/modules/platform-jobs.md`. **Building 1.5a.**

### Build plan (continue from the first unticked item)
- [x] pg-boss 12.38.0 dependency; schema `pgboss` created by migrator; erp_app grants; migration for `notifications` (RLS) + `email_deliveries`.
- [x] API platform/jobs: JobQueue.enqueue(tx) in caller's transaction; payload encryption (HKDF from AUTH_SECRET); worker entry `apps/api/src/worker.ts`; `pnpm dev` runs it.
- [x] Email via job (identity + invitation emails), retries 5 × backoff, delivery status; invitations list shows delivery.
- [x] Notifier + notifications API; types member_joined, roles_changed; audit; cap 200.
- [x] Web: bell + panel; Members shows email failed. i18n EN/AR.
- [x] Tests (spec §8), journey extended; docs; hand-over A–H (see Session 5 entry).

### Paused mid-build (owner asked to stop Docker)
- Done, uncommitted: pg-boss 12.38.0 (api + db). `packages/db/src/jobs.ts` (queues installed by the migrator, erp_app gets row privileges only, `transactionExecutor` = pg-boss `fromDrizzle`). Tables `notifications` (RLS) + `email_deliveries` (global), with migrations 0008/0009 applied to the dev DB. db tests: **37 passed**, including the new queue-privilege and notification-isolation tests.
- API, written but **not compiling yet**: `platform/jobs/` (JobQueue, PayloadSealer, JobsModule), `platform/mail/email-outbox.ts` (EmailOutbox + EmailDeliveryHandler), `worker.ts`, `worker.module.ts`, `worker-bootstrap.ts`. Identity emails and invitations now use EmailOutbox; invitations carry a `delivery` status (contract updated).
- **Next fix:** `IdentityEmails` methods now return `Promise<string>`, but Better Auth callbacks and `identity.service.ts` expect `Promise<void>`. Wrap them (`.then(() => undefined)`) or change the methods back to `Promise<void>`. The other typecheck errors (`auth.api.verifyTOTP` etc.) are knock-on effects of the `auth.ts` plugin type breaking, so re-check after that fix.
- Then: add the worker to the api `dev` script, start the worker in the identity/access tests (`createWorker`), and write the outbox/retry/rollback/encryption tests. Spec correction: `retryLimit` 5 means 6 attempts in total.
- README fix needed: with pnpm 12, use `pnpm db:generate --name=…` (no `--`).
- Docker Desktop and `pnpm dev` were stopped at the owner's request. To resume: start Docker Desktop, then `pnpm dev`.

### Repo state
Last commit `f1f9276` (1.4b). Everything above is uncommitted.

---

## 2026-10-28 — Session 4 (continued): Milestone 1.4b built, awaiting owner approval

### Where we are
1.4a approved and committed `b875341`. **Milestone 1.4b is built and verified, NOT committed**, and waits for the owner to test and approve. After "approved": commit 1.4b, then plan Milestone 1.5 (worker, files, notifications, monitoring). Present that plan with its owner decisions before building it.

### Build plan
- [x] API: `WEB_PUBLIC_URL` for email links; same-origin check for company web origins.
- [x] API: `sessions.authenticated_at`, `handoff_tickets`, `GET /auth/companies`, `POST /auth/handoff` + `/redeem`, `PATCH /auth/me` (migrations 0006/0007).
- [x] Web: API client, translated error codes, react-hook-form + contract schemas, QR via `qrcode` (drawn locally).
- [x] Web screens: all listed in `modules/web-ui.md` §9 (auth pages, companies, hand-off, invitation, shell, dashboard, members, account). MFA-required → `/account`.
- [x] E2E `apps/web/e2e/journey.spec.ts` (EN + AR, axe on 12 screens each); CI `journey` job added.
- [x] Docs: web-ui.md §8–§14, api.md, testing.md, README, checklist, roadmap, compliance, project-status.

### Changes made late in this session (beyond the plan)
- `safeReturnTo` hardened: also rejects backslashes, spaces and control characters. Before this, `/\t/evil.example` would have become `//evil.example`, an open redirect. Unit-tested.
- Sign-in navigates to `returnTo` as an href, so the invitation token in the query string survives.
- Duplicate toast provider removed (`UiProvider` already provides one).
- `LanguageSwitch` saves the choice to the account (`PATCH /auth/me`) when signed in.
- Removed the 1.4a placeholder `routes/home.tsx`. `/gallery` stays.
- Playwright projects: `ui` (`pnpm e2e`) and `journey` (`pnpm e2e:journey`, needs `pnpm dev`).

### Repo state
- Last commit `b875341` (1.4a). All 1.4b work is uncommitted (API, db migrations 0006/0007, contracts, i18n, ui fields, web app, e2e, CI, docs).
- Local `.env`: added `WEB_PUBLIC_URL=http://localhost:5173` (also in `.env.example`).
- Dev DB: migrations 0006/0007 applied (`pnpm db:setup`). Contains `e2e-*` companies and `*@example.test` accounts from journey runs. Mailpit was cleaned by the tests.
- `pnpm dev` was started by Claude in the background (API :3000, web :5173) and may still be running.

### Verification (real results, 2026-10-28)
- `pnpm check`: passed. Tests: api 127, db 32, contracts 27, web 18, i18n 10, ui 9 = **223**.
- Browser: `playwright test` → **8 passed** (6 gallery + journey EN + journey AR). The journey passed on 2 consecutive runs.
- `pnpm security`: licence check passed (284 packages), no leaked secrets. Audit: only the accepted moderate esbuild advisory GHSA-67mh-4wv8-2f99.

### Waiting on owner
- Test 1.4b by hand (project-status.md "How to verify Milestone 1.4b") and approve.
- Known gaps (project-status Known issues): no password-change screen yet, phone-width layout not tuned, bundle > 500 kB.

### Next step
Owner approval → `git add -A && git commit` "Milestone 1.4b: screens and end-to-end journey" → plan Milestone 1.5.

---

## 2026-10-28 — Session 4: 1.3b committed, Milestone 1.4a design system built

### Where we finished
1.3b approved ("go next") and committed `4ae3f76`. **Milestone 1.4a (design system) is built and verified, awaiting the owner's review of the gallery. NOT committed.** Do not start 1.4b until approved.

### Decisions (owner, 2026-10-28)
- 1.4 split into 1.4a (look) and 1.4b (screens + E2E). Sidebar shows only built modules. First-visit language: company default on a company address, browser language on the main address; saved choice wins.
- Mine (documented): light `ink-3` → #68636f, `butter-ink` → #7a5600, `warn` → #b47e00, dark `ink-3` → #948e9e — required by axe for WCAG AA contrast; OFL-1.1 approved for fonts.

### Done
- Spec `docs/modules/web-ui.md`. New `packages/ui` (tokens.css from the approved preview, index.css with Tailwind 4 @theme, components: button, fields, data-display, overlays, states, shell), `apps/web` (Vite 8, TanStack Router/Query, i18n/theme providers with localStorage guarded, home page, `/gallery`), `packages/i18n` UI catalogs (`en-ui.ts`, `ar-ui.ts` machine-drafted) + `format.ts` (ICU translate, formatMoney from decimal strings, formatDate in Asia/Kuwait, latn digits).
- Lint covers `.tsx` with strict TS + react-hooks; logical-CSS guard test (mutation-checked). Playwright + axe (`apps/web/e2e/gallery.spec.ts`), CI `e2e` job, `pnpm e2e`.
- Visual check of screenshots by me: matched v0.2; fixed invisible skeletons and monospace "Ctrl K".

### State
- Uncommitted: all 1.4a work. `pnpm dev` started by me (background) and left running for the owner: API :3000, web :5173 (listens on ::1). Docker had stopped mid-session (restarted; containers auto-restarted).
- Chromium for Playwright installed in the user profile (`ms-playwright`).

### Verification (last run)
- `pnpm check`: 199 passed (i18n 10, contracts 27, ui 9, db 32, api 121). `pnpm e2e`: 6 passed, axe clean EN/AR × light/dark. `pnpm security`: 1 moderate (accepted), 253 licences OK, no leaks.

### Next step
Owner opens http://localhost:5173/gallery (switch language/theme), gives feedback on the look; on approval (+ commit) → 1.4b plan: auth/onboarding screens on the real API, invitation accept, sessions, app shell, translated error codes, origin check must allow `*.localhost:5173` company origins (currently only APP_PUBLIC_URL + CORS_ORIGINS), Playwright journey via Mailpit in EN and AR.

---

## 2026-10-27 — Session 3 (continued): Milestone 1.3b Access built

### Where we finished
**Milestone 1.3b (Access) is built and verified, awaiting the owner's review and approval. NOT committed** (last commit `253b180` = 1.3a). Do not start 1.4 until the owner approves 1.3b.

### Done
- Spec `docs/modules/access.md` first; permissions.md matrix extended (access.members.read/invite/manage, access.roles.assign) and now machine-checked.
- `packages/contracts`: `permissions.ts` (permissions, scopes, 8 fixed roles, sensitive set, effectivePermissions, hasPermission, isSensitive, canGrant, FOUNDER_ROLES), `access.ts` (slug rules + reserved list, request/response schemas), error `MFA_REQUIRED`.
- DB: migrations 0004 (membership_roles, invitations, audit_events) + 0005 (forced RLS, grants, append-only trigger incl. TRUNCATE, `app.user_role_names()`); isolation guard generalized (key containing tenant_id).
- API: `platform/audit` (same-transaction AuditLog), `platform/openapi` (`@ApiContract`, generator, `/api/v1/docs/openapi.json` dev-only), `TenantDatabase.newTenantId()`, `pg-error.ts`, config `PLATFORM_BASE_DOMAIN`; `modules/access` (AccessGuard, AccessService with advisory-lock-serialized role changes, CompaniesService, InvitationsService, AuditEventsService, MembershipSignInPolicy via identity's `SIGN_IN_POLICY` hook); identity: `completeSignIn` (policy, trusted-device refusal for sensitive roles), `revokeTrustedDevices`, `userSummaries`, `userIdByEmail`; i18n: invitation email + role names.
- Every existing route annotated with `@ApiContract` (~34).
- Dev helper `pnpm http` (scripts/dev-http.mjs, `.dev-cookies/` git-ignored) because PowerShell cannot resolve `*.localhost`.

### Findings worth remembering
- Owner could never appoint a CEO under strict "grant ⊆ own" (Owner lacks payroll) → Owner grants any role to others; founder = Owner + CEO; no self-change.
- Concurrency: without serialization two Owners demoting each other both succeed (`[200,200]`, zero Owners) — proven with a forced-overlap test (table lock + polling pg_stat_activity as superuser; non-superusers can't see others' wait states).
- Audit cursor by UUIDv7 id (timestamps lose microseconds in JS).
- Mutation checks (each made its test fail): invitation email match, MFA block, role-change lock, canGrant, missing @ApiContract.

### State
- Uncommitted: all 1.3b work. Dev DB migrated (0004/0005 applied with `pnpm db:setup`) and contains rehearsal data (`rehearsal-*`). Owner's `pnpm dev` was running and auto-reloaded. Rehearsal emails and cookie jars deleted; owner's Mailpit has only their own 2 emails.

### Verification (last run)
- `pnpm check`: **184 passed** (i18n 4, contracts 27, db 32, api 121). `pnpm security`: 1 moderate (accepted), licences OK (156), no leaks.
- Cold PowerShell rehearsal with `pnpm http`: create company → sign-in on company host → MFA_REQUIRED → enable + confirm 2FA → members 200 → invite → invitee signs up, signs in on company host, accepts → roles employee → members 403 → audit lists events.

### Next step
Owner tests (needs an authenticator app on the phone for two-factor; the secret can be typed in manually from the `totpUri`), approves 1.3b, says whether to commit → Milestone 1.4 plan (design system & shell).

---

## 2026-10-27 — Session 3 (continued): 1.3a approved + committed, 1.3b planned

### Where we finished
**Milestone 1.3a approved by the owner and committed `253b180`.** Milestone 1.3b plan presented and the owner's decisions recorded (project-status "Decisions 2026-10-27"). Building 1.3b starts now: first `docs/modules/access.md`.

### Decisions (owner, 2026-10-27)
- Fixed system roles now (Owner, CEO, Manager, Team Leader, Employee, Finance, HR/Payroll, Technical Admin); custom roles later.
- Sensitive roles blocked until two-factor is set up; no trusted device for them.
- Only Owner and CEO can invite; invitations expire after 7 days; verified matching email required.
- One account can belong to several companies.
- Defaults: audit log readable by Owner/CEO, kept indefinitely pending legal retention; OpenAPI docs dev-only.

### State
- Clean working tree after commit `253b180` (plus this entry). Owner's `pnpm dev` may be running. My orphan node processes from 19:56 (local) still exist; harmless, gone after a reboot.
- Verification at commit: `pnpm check` 134 passed (i18n 4, contracts 5, db 32, api 93); `pnpm security` 1 moderate (accepted), licences OK, no leaks.

### Next step
Write `docs/modules/access.md` (spec), then implement 1.3b: onboarding (tenant + subdomain + Owner membership, reserved slugs), invitations, RBAC permission keys + scopes in `packages/contracts`, server-side authorization guard, self-elevation and last-owner protection, MFA enforcement for sensitive roles, tenant sign-in requiring active membership, append-only audit log (DB-enforced), OpenAPI. Tests incl. invalid/expired/mismatched invitations, self-elevation, permission matrix, audit immutability, cross-tenant. Hand over in §22 A–H.

---

## 2026-10-27 — Session 3: owner re-testing Milestone 1.3a

### Where we finished
Milestone 1.3a still **awaiting owner approval**, uncommitted (last commit `097350e`). No code changes.

### Done
- Docker Desktop was not running after a reboot; started it. The dev containers came back on their own (`restart: unless-stopped` confirmed working).
- Re-ran from scratch: `pnpm check` **131 passed** (i18n 4, contracts 5, db 32, api 90); `pnpm security` 1 moderate (accepted), licences OK (156), no leaks.
- Rehearsed the owner's PowerShell steps cold with `rehearsal…@example.com` addresses (so `omar@example.com` stays unused): sign-up → email → verify → sign-in → me → sessions → 6 wrong passwords (5× INVALID_CREDENTIALS, then RATE_LIMITED) → lock email. All correct.
- Found a display pitfall: PowerShell shows `signe...` / blank lines when several result types print in one go. Owner steps now pipe to `ConvertTo-Json` / `Format-List`.
- API dev server stopped so the owner can run `pnpm dev`; Docker services left running.

- Owner's step 5 returned UNAUTHENTICATED. Cause (checked in DB + Mailpit, not guessed): omar@example.com was never verified — the owner clicked **my rehearsal emails** (same subject) left in the Mailpit inbox, which verified the rehearsal accounts instead. Deleted the rehearsal emails; owner continues from step 3. My mistake.

- Second retry still EMAIL_NOT_VERIFIED: the owner's email was still unopened (browser likely showing the stale Mailpit list). Found a real bug: the HTML email showed the link as plain text (not clickable). Fixed: `renderHtml()` in `platform/mail/mailer.ts` (escaped text, clickable links, RTL for Arabic) + `mailer.spec.ts` (3 tests). Typecheck + lint pass.
- While editing, the mailer briefly had a syntax error; the owner's auto-reloading `pnpm dev` stopped listening (port 3000 down). My earlier dev run (started 19:56 local) also left orphan node processes after TaskStop; stopping them was (rightly) blocked as a permission decision for the owner.

- Owner restarted `pnpm dev` (first command was sent before the server was ready), resent verification, clicked the new clickable link, signed in: DB confirms omar@example.com verified + 1 active session (steps 1–5 passed). Steps 6–7 (sign-out, lockout) handed to the owner.

### Notes for next session
- Suggest the owner enables Docker Desktop → Settings → General → "Start Docker Desktop when you sign in".
- After rehearsing steps, clean up what the owner will see (e.g. delete rehearsal emails from Mailpit).
- Don't edit code while the owner's dev server is running without warning them; prefer making edits in one valid step.
- TaskStop of `pnpm dev` can leave child node processes behind on Windows; check with Get-NetTCPConnection -LocalPort 3000 before handing over.

### Next step
Wait for the owner's test results and approval of 1.3a (and whether to commit), then plan 1.3b.

---

## 2026-10-25 — Session 2 (continued): Milestone 1.3a Identity built

### Where we finished
**Milestone 1.3a (Identity) is built and verified, awaiting the owner's review and approval. NOT committed** (last commit `097350e` = 1.2). Do not start 1.3b until the owner approves 1.3a.

### Done
- Spec `docs/modules/identity.md` written first (purpose, brief §8 coverage, data, API, security, acceptance criteria, test plan) and updated with implementation notes.
- DB: migrations `0002_identity_tables` (accounts, sessions, verifications, two_factors, used_totp_codes, user_known_devices, rate_limit_buckets; users + image/two_factor_enabled/locale) and `0003_identity_security` (least-privilege grants, triggers). New catalog guard: tables without tenant_id must be on a reviewed allow-list.
- New `packages/i18n` (EN/AR email catalogs; AR machine-drafted, needs native review; key/placeholder parity tests).
- API platform: `Mailer` (SMTP, bilingual), `RateLimiter` (Postgres fixed windows, hashed keys, Retry-After), `ZodValidationPipe` (strict), origin-check (CSRF), `NoStoreInterceptor`, client IP from socket, query-string redaction in request logs.
- API identity module: Better Auth 1.7.13 (handler not mounted; telemetry off; hashed verification identifiers; generateId=false → uuidv7), 18 endpoints under `/api/v1/auth`, SessionGuard (12 h absolute lifetime), TOTP replay ledger, new-device and lockout notices, breached-password checker (HIBP range, fails open, switchable).
- Lint: business modules may not import identity tables; identity module is the reviewed exception for the unscoped DB handle.

### Findings worth remembering
- Better Auth: TOTP codes reusable within the window (we added a ledger); its rate limiter doesn't apply to `auth.api` calls; telemetry on by default; tokens stored plain by default; `@Header` can't decorate a class in Nest 12.
- Request logs included `?token=` — fixed platform-wide; verified live (only the pre-fix line contains a token).
- `nodemailer` is MIT-0 → added to licence allow-list. Moderate esbuild advisory accepted (security.md §2b).
- Mutation checks: disabling replay protection, lockout, absolute lifetime, or the CSRF check each made its test fail.

### State
- Uncommitted: all 1.3a work. Local `.env` got AUTH_SECRET, APP_PUBLIC_URL, SMTP_HOST, SMTP_FROM, PASSWORD_BREACH_CHECK (via env:init). Docker services running (auto-restart). API stopped.

### Verification (last run)
- `pnpm check`: **131 passed** (i18n 4, contracts 5, db 32, api 90), 0 failed. `pnpm security`: 1 moderate (accepted), licences OK (156 packages), no leaks.
- Live PowerShell walkthrough (owner can repeat): sign-up → 202; sign-in before verify → EMAIL_NOT_VERIFIED; email in Mailpit; open link → ok; sign-in → signed_in; me; sessions; sign-out; me → UNAUTHENTICATED.

### Next step
Owner reviews 1.3a (hand-over A–H). After approval (+ commit if asked): Milestone 1.3b — plan + decisions first: onboarding (company + subdomain + Owner membership), invitations (verified matching email), RBAC permission keys + scopes from permissions.md, MFA required for sensitive roles (and no trusted device for them), append-only audit log, OpenAPI.

---

## 2026-10-25 — Session 2 (continued): 1.2 approved and committed, 1.3 planned

### Where we finished
**Milestone 1.2 approved by the owner (tested it themselves) and committed `097350e`.** Milestone 1.3 plan presented and the owner's decisions recorded. **Next: start Milestone 1.3a when the owner says go.** Nothing uncommitted except this log entry.

### Decisions (owner, 2026-10-25)
- Split 1.3 → **1.3a Identity** (sign-up, email verification, login, password reset, TOTP MFA + recovery codes, sessions, rate limits, remembered device, breached-password check, new-device notice, strict validation, `users` row rules) and **1.3b Access** (self-service onboarding, invitations, RBAC + scopes, MFA enforcement for sensitive roles, audit log, OpenAPI). See roadmap.
- Company creation: self-service for anyone after email verification.
- MFA: required for sensitive roles; optional for others; tenant may require for all.
- Defaults accepted without objection: passwords ≥ 12 chars + breached check (switchable off for offline on-prem); session idle 30 min / absolute 12 h; remembered device skips MFA prompt only, 30 days, never for sensitive roles.

### Findings
- Better Auth advisory check: latest **1.7.13**; ADR-0004's minimum 1.6.11 is no longer safe (GHSA-qq9h-g4jm-xgf3, high, fixed 1.6.22). ADR-0004 amended; email-OTP / magic-link sign-in will not be enabled.

### State
- Docker services running with `restart: unless-stopped`; dev DB seeded (acme, globex). API not running.

### Next step
Milestone 1.3a: first write `docs/modules/identity.md` (purpose, data, dependencies, permissions, acceptance criteria, test plan, brief §8 coverage), verify Better Auth 1.7.13 docs for NestJS/Express + Drizzle adapter + twoFactor plugin + uuid ids mapped onto our `users` table, then implement with tests (expired/reused OTP and reset tokens, throttling, session revoke/fixation, unverified email blocked) and hand over in §22 A–H format.

---

## 2026-10-25 — Session 2: owner re-verification of Milestone 1.2

### Where we finished
Milestone 1.2 still **awaiting owner approval**, uncommitted. No code changes this session.

### Done
- Re-ran verification for the owner. First attempt: db tests "31 skipped" because **Docker Desktop was not running** after a restart (not a code problem). Started Docker, re-ran: `pnpm check` **80 passed** (5 + 31 + 44), `pnpm security` clean (no vulnerabilities, 124 packages licence-OK, no leaks).
- Gave the owner a step-by-step self-check (pnpm check, pnpm security, db:seed + dev, browser URLs, `curl.exe` spoof test, verbose isolation tests).

- **Owner hit a bug following my steps:** `pnpm db:seed` failed with `ECONNREFUSED 127.0.0.1:5432` — after the Docker restart the dev containers were stopped (tests passed because they use their own containers), and my steps ran the seed before anything started the services. Fixed:
  - `infra/compose/compose.dev.yaml`: `restart: unless-stopped` on all three services (verified in `docker inspect`).
  - `pnpm db:seed` now runs `services:up` → `db:setup` → seed; `services:up` runs `init-env` itself; `pnpm dev` simplified accordingly.
  - New `packages/db/src/cli/run.ts`: CLI commands print one plain sentence for known problems (DB unreachable, bad password, missing DB/tables) instead of a stack trace. Verified with services stopped.
  - Re-verified: owner's exact command `pnpm db:seed` in PowerShell from stopped containers → services started, roles, migrations, both demo tenants, exit 0. `pnpm check` 80 passed; `pnpm security` clean.

### Notes for next session
- On Windows PowerShell `curl` is an alias for Invoke-WebRequest; tell the owner to use `curl.exe`.
- If tests show "skipped" or Docker connection errors, check Docker Desktop first.
- When giving the owner manual steps, run them myself first in PowerShell from a cold state (services stopped).

### Next step
Wait for the owner's result and approval of 1.2 (and whether to commit). Then Milestone 1.3 plan (see Session 1 entry).

---

## 2026-10-24 — Session 1: Phase 0 approval → Milestone 1.1 → brief review → Milestone 1.2

### Where we finished
**Milestone 1.2 (Tenancy & isolation) is built and verified, awaiting the owner's review and approval.** Do not start Milestone 1.3 until the owner approves 1.2 (brief §3 Rule 1, §22).

### Done this session
1. **Milestone 1.1 — Skeleton** (approved by owner, committed `c3d09be`): pnpm 12 + Turborepo monorepo, TypeScript 6.0.3 strict, ESLint/Prettier, Vitest; Docker Compose (Postgres 18.6, RustFS, Mailpit); NestJS 12 API with validated config, redacted Pino logs, correlation IDs, standard errors, Helmet, CORS allow-list, body limit, `/health` + `/health/live`; CI workflow.
2. **Brief compliance review + follow-up** (in `c3d09be`): CI `security` job (pnpm audit, licence allow-list, gitleaks — verified with a planted token); fixed high CVE in multer via pnpm override; created `requirements-checklist.md`, `testing.md`, `api.md`; evidence register; security/domain/architecture/roadmap gaps filled (Milestone 1.5 added, expenses as Phase 12b).
3. **Owner saved the full brief** as `docs/product-brief.md` (§1–25). Checklist now covers §22–25 too.
4. **Milestone 1.2 — Tenancy & isolation** (NOT committed yet):
   - `packages/db`: Drizzle 0.45.4 schema (`users`, `tenants`, `tenant_domains`, `memberships`), migrations `0000_foundation_tables.sql` (generated) and `0001_foundation_security.sql` (roles' grants, ENABLE+FORCE RLS, policies, `updated_at` triggers, `app.current_tenant_id()`, `app.resolve_tenant_by_host()`), `withTenant`, `assertSafeAppRole`, admin bootstrap/migrate, dev seed, Testcontainers helper.
   - DB roles: `erp_migrator` (owner), `erp_app` (API, no BYPASSRLS), `erp_platform` (NOLOGIN, tenant directory only).
   - API: `TenantDatabase` (only data path), `DatabaseRoleCheck` (refuses superuser/BYPASSRLS → 503), tenancy module (host → tenant middleware on all routes except health, `@CurrentTenant()`, `GET /api/v1/tenant`).
   - Lint: `import-x/no-cycle` (needed `importX.flatConfigs.typescript.settings` — without it the rule silently did nothing) and `no-restricted-imports` for business modules.
   - Docs: new `database.md`; ADR-0003 implementation notes; compliance evidence; testing, api, README, roadmap, checklist updated.

### State of the repo
- Branch `main`. Last commit `c3d09be` (1.1). **All Milestone 1.2 work is uncommitted** — commit after owner approval if they ask ("commit only when the owner asks").
- Owner's local `.env` was updated: `DATABASE_URL` now uses `erp_app`; `DATABASE_MIGRATOR_URL` and `DATABASE_ADMIN_URL` added.
- Docker services (postgres, object-storage, mailpit) were left **running**; dev DB has roles, migrations and the demo tenants `acme` / `globex` seeded. API dev server is stopped.
- No GitHub remote yet, so CI has never run on GitHub.

### Verification (last run, 2026-10-24)
- `pnpm check`: format ✅, lint ✅, typecheck ✅, tests **80 passed** (contracts 5, db 31, api 44), 0 failed.
- `pnpm security`: no known vulnerabilities; licence check passed (124 production packages); gitleaks no leaks.
- Mutation check: replacing the isolation policy with `USING (true)` made 10 isolation tests fail (then restored).
- Live: `acme.localhost:3000/api/v1/tenant` → Acme; `globex.localhost` → Globex; unknown host → 404; `X-Forwarded-Host` spoof ignored; `/health` up.

### Decisions made this session (all recorded in docs)
- TypeScript 6.0.3 not 7 (typescript-eslint support); NestJS 12 ESM; Drizzle stable 0.45 not 1.0-rc; RustFS instead of MinIO (ADR-0002 amendments).
- Expenses module included as Phase 12b (owner: "do whatever").
- `users` is global, no RLS yet — decide row rules with Better Auth in 1.3.
- Companies and memberships are never deleted (status instead).

### Open items / waiting on owner
- **Approve Milestone 1.2** (manual verification steps in the 1.2 hand-over / `project-status.md`).
- Whether to commit 1.2 once approved.
- GitHub remote (so CI runs).
- Legal review items (compliance.md ⚖️), trademark search, platform domain name — not blocking yet.

### Next step (after approval)
Milestone 1.3 — Identity & access: Better Auth ≥ 1.6.11 (verify latest + advisories first), sign-up, email verification via Mailpit, login, TOTP MFA + recovery codes, password reset, sessions list/revoke, remembered devices, rate limits, suspicious-login notices; company onboarding (creates tenant + subdomain + owner membership); invitations (verified email must match); RBAC with permission keys + scopes from `permissions.md`; append-only audit log; OpenAPI generation; strict request validation; decide `users` row rules. Start by writing the 1.3 plan + decisions for the owner (brief §22), and check `requirements-checklist.md` rows tagged 1.3.
