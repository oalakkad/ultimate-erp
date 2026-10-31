# Module spec: Reports, audit search & analytics (Phase 14)

Status: **Built 2026-10-31** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
One place where managers and executives answer questions across modules ("which projects lose money?", "who is over capacity?", "what is still owed?") with **defined calculations** over the same data the modules use, plus a searchable audit trail. Nothing is copied or pre-aggregated: every report is computed in the company's own transaction (forced RLS) when asked, so it can never show another company's rows or stale numbers.

## 2. Brief coverage
| Brief (Module M / N) | Phase 14 |
|---|---|
| Clients, projects, budget consumption, utilization, task performance, timesheets, attendance, leave, payroll, invoices, payments, receivables, revenue, profitability | ✅ 13 reports (§3) |
| Clearly defined calculations, consistent sources | ✅ each report carries its definition text (EN/AR) shown above the table and in this spec |
| Filters | ✅ period (from/to, ≤ 366 days), client, project where relevant |
| Secure exports | ✅ CSV (formula-injection-safe), audited `reports.report.exported`; payroll needs `exports.confidential` |
| Authorized for every record | ✅ each report requires its source module's permission; team / project scope reports only include people or projects in that scope |
| Audit search, filters, controlled access | ✅ `/audit-events` filters: action prefix, actor, target type, target id, request ID, date range; Audit log screen; CSV export audited (`audit.export`) |
| Audit records protected | ✅ already append-only (Milestone 1.3b trigger); no secrets in details |

## 3. Reports and their calculations
Money in KWD (3 dp, exact); hours as decimals (2 dp). "Period" = from/to inclusive (Kuwait dates).

| Key | Who | Rows | Calculation |
|---|---|---|---|
| clients | clients.client.read (company) | client | invoiced = Σ totals of non-void invoices issued in period; received = Σ recorded (not reversed) payments received in period; outstanding = current open balance |
| projects | projects.project.read (company; managers: projects they manage) | project | budget hours; allocated = Σ task allocations; approved = Σ approved time (all time); consumption = approved ÷ budget |
| profitability | billing.invoice.read (company) | project | invoiced (period) − approved expenses (period) = contribution; labour cost not included until payroll rules are verified (stated) |
| utilization | people.employee.read (company; team leads/managers: their team) | person | capacity = weekly hours ÷ work days × working days in period; logged = approved hours; billable = approved billable hours; utilization = billable ÷ capacity |
| tasks | tasks.task.read (company) | project | completed in period; on time = completed on/before due date; late; open overdue now; estimate vs actual hours of completed tasks |
| timesheets | time.entry.read (company; managers: their projects) | person × project | hours by status (submitted, approved, rejected) in period; approved billable |
| attendance | attendance.read (company; team) | person | present, absent, late, early, leave days; worked hours — the attendance module's own day rules |
| leave | leave.request.read (company; team) | person × type | approved days with start date in period |
| payroll | payroll.run.approve or payroll.run.prepare (company) + two-factor | run | period, status, test run, employees, gross, deductions, net |
| invoices | billing.invoice.read (company) | invoice | number, client, issue/due date, status, total, outstanding (issued in period) |
| payments | billing.invoice.read (company) | payment | date, invoice, client, method, amount, status (received in period) |
| receivables | billing.invoice.read (company) | client | not due, 1–30, 31–60, 61–90, 90+ days past due, total (today) |
| revenue | billing.invoice.read (company) | month | invoiced and received per month in period |

## 4. API
`GET /reports` (catalogue: the reports I may run), `GET /reports/:key?from&to&clientId&projectId` → `{ key, columns, rows, totals, generatedAt }` (values as strings), `GET /reports/:key/export.csv` (audited). `GET /audit-events?…filters` and `GET /audit-events/export.csv`.

## 5. Acceptance criteria
1. The catalogue lists only reports the person may run; running another → 403.
2. Numbers match the modules exactly on a seeded firm (invoice 725.000, payment 300.000 → client report invoiced 725.000 / received 300.000 / outstanding 425.000; profitability with a 40.000 expense → 685.000).
3. A manager's projects/timesheets reports contain only projects they manage; a team lead's utilization only their team; another company sees none of it.
4. CSV export is audited and safe against formulas; payroll export needs the confidential-export permission.
5. Audit search filters by action prefix, actor, target and dates; export is audited.

## 6. Test plan
API (`apps/api/test/reports.spec.ts`) for every criterion; journey EN + AR: Owner opens Reports, runs the clients report, sees the invoiced total, downloads CSV; opens the Audit log and filters by "billing".

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Computed on request (no warehouse); period limited to 366 days; up to 2 000 rows per report.
- Profitability excludes labour cost until payroll rules are verified, and says so on screen.
- Capacity uses each person's weekly hours and work days; public holidays and leave are not subtracted (stated in the definition).
- The scoped projects report is granted by managing projects (not by being on one), so employees get no empty report.

## 11. Results (2026-10-31)
- **API** (`apps/api/test/reports.spec.ts`, 4 tests against real Postgres + Mailpit): on a seeded firm the clients report shows invoiced 725.000 / received 300.000 / outstanding 425.000 and its totals; profitability 725.000 − 9.000 expenses = 716.000 (98.7 %); receivables 425.000; payments 300.000; revenue for the month; invoice register (INV-0001, partly paid); Arabic names with `locale=ar`; periods over 366 days refused; catalogue by role (employee none → 403 on run; manager no payroll; timesheets scoped for managers); another company sees no rows; CSV export formula-safe (`'=Al Noor…`), with a totals line, audited; audit search by action prefix, actor and date (old dates → none), `%` rejected, export audited, employees 403.
- **Web**: Reports catalogue grouped Finance / Work / People (only reports the person may run), report page with filters, the definition text, a scoped-report note, table with typed formatting and totals, revenue chart with peak annotation, CSV export; Audit log with area, dates and request reference filters, paging and CSV export; navigation group "Insights"; palette entries. EN + AR.
- **Not yet:** saved/scheduled reports and emailed report digests, charts on every report, staff cost in profitability (needs verified payroll rules).
