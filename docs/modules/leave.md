# Module spec: Leave management (Phase 9)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
People apply for leave; their team lead or manager approves. Approved leave reduces the right balance exactly once, appears on the team calendar, and (later) feeds attendance (Phase 10) and payroll (Phase 11, unpaid leave). Leave rules differ by country and contract, so **every rule is a company setting**. The values pre-filled for Kuwait are our best understanding and are shown everywhere as **"to be verified by a Kuwaiti lawyer/accountant"** — they are not legal advice (owner decision 2026-10-29).

## 2. Brief coverage (Module H)
| Required | Phase 9 |
|---|---|
| Leave types: annual, sick, unpaid; configurable policies | ✅ company leave types with entitlement, accrual, paid / unpaid, half-day, document rule; four pre-filled types, each flagged "to be verified" |
| Leave balances; accrual | ✅ balance = accrued entitlement − approved leave ± adjustments, from a ledger; monthly or yearly accrual, pro-rated from the joining date |
| Applications, start / end dates, partial days | ✅ working days counted from the person's working days, minus company public holidays; half-day for single-day leave |
| Supporting documents | ✅ attach a virus-scanned file; required where the type says so (e.g. sick leave) |
| Approval and rejection; cancellation and withdrawal | ✅ pending → approved / rejected; withdraw while pending; cancel an approved leave before it starts (balance restored) |
| Overlapping leave validation | ✅ no two pending/approved requests of one person may overlap |
| Team calendar; history; notifications | ✅ calendar of approved and pending leave + holidays for people I may see; my history; approvers and applicants notified |
| Manager and CEO summaries | ✅ balances per person, on leave today, waiting for my approval (dashboard) |
| Consistent balances; no duplicate deductions; valid transitions | ✅ deduction and restoration are ledger rows unique per request (database), all inside one transaction with the person locked |

## 3. Data
| Table | Key columns |
|---|---|
| `leave_types` | tenant_id, id, code, name_en/ar, paid, deducts_balance, annual_days numeric(6,2), accrual (none / monthly / yearly), allow_half_day, requires_document, allow_negative, to_verify, archived_at |
| `public_holidays` | tenant_id, date, name_en/ar (company enters them: Islamic holidays move every year) |
| `leave_requests` | tenant_id, id, membership_id, leave_type_id, start_date, end_date, half_day (none / first / second), days numeric(6,2), reason, file_id, status (pending, approved, rejected, withdrawn, cancelled), decided_by, decided_at, decision_note, version |
| `leave_ledger` | tenant_id, id, membership_id, leave_type_id, year, kind (taken / restored / adjustment), days, request_id, note, created_by — **unique (request_id, kind)** |

## 4. Rules
- Working days = the person's working days (employee record) between start and end, minus public holidays; half-day = 0.5.
- Accrued in year Y: `yearly` → full annual days from the later of 1 January and the joining date (pro-rated by months for a mid-year joiner); `monthly` → annual days ÷ 12 per completed month worked in Y; `none` → annual days (a per-year allowance, e.g. sick leave); no balance for types that don't deduct (unpaid).
- Balance for Y = accrued + adjustments − taken + restored. A request for more than the balance is refused unless the type allows a negative balance.
- Leave spanning two years is split by year when deducted.
- Carry-over between years: not automatic; HR records it as an adjustment with a note (decision §10).

## 5. Permissions
| Permission | Owner | CEO | Manager | Team Lead | Employee | HR & payroll |
|---|---|---|---|---|---|---|
| leave.request.create (apply, withdraw, cancel my own) | own | own | own | own | own | own |
| leave.request.read | company | company | team | team | own | company |
| leave.request.approve | company | company | team | team | — | company |
| leave.policy.manage (types, holidays, adjustments) | company | company | — | — | — | company |
**team** = teams I lead + my direct reports (people.md §5). Nobody approves their own leave (API + database).

## 6. Workflow
`pending → approved | rejected`; `pending → withdrawn` (applicant); `approved → cancelled` (applicant before the start date, or an approver at any time, with a reason) — cancellation restores the balance once.

## 7. API
`GET /leave/types`, `POST/PATCH /leave/types[/:id]`, `GET/PUT /leave/holidays`, `GET /leave/balances?membershipId&year`, `POST /leave/adjustments`, `GET /leave/requests` (mine | approvals | person), `POST /leave/requests` (with `preview` to compute days and balance only), `POST /leave/requests/:id/{approve,reject,withdraw,cancel}`, `GET /leave/calendar?from&to`. Dashboard: `leave { onLeaveToday, waitingForMe }`.

## 8. Acceptance criteria
1. Default types exist, flagged "to be verified"; HR edits them; holidays entered.
2. 3 working days Sunday–Tuesday with a holiday on Monday = 2 days; half-day = 0.5; overlapping second request refused; more than the balance refused.
3. Team lead approves → balance reduced once (a second approval call and a direct duplicate ledger insert both fail); rejected leave doesn't deduct.
4. Cancel approved leave → balance restored once; withdraw pending; nobody approves their own; someone outside the team can't approve; other company 404.
5. Sick leave without a document refused when the type requires one.
6. Calendar shows approved and pending leave of my team and holidays.

## 9. Test plan
API integration for each criterion + db uniqueness; journey EN + AR: colleague applies for annual leave, Owner approves, balance and calendar update; axe on new screens.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Pre-filled types (all "to be verified by a Kuwaiti lawyer/accountant"): Annual leave 30 working days a year, accrued monthly; Sick leave 15 days a year, document required; Unpaid leave, no balance; Maternity leave 70 days, document required. These are starting points only.
- Weekends come from each person's working days (default Sunday–Thursday); public holidays are entered by the company each year.
- No automatic carry-over or expiry; HR uses adjustments with a note.
- Leave doesn't change the employee's status automatically.

## 11. Results (2026-10-30)
- **API**: `apps/api/test/leave.spec.ts` — 5 tests passing against real Postgres + Mailpit: four default types flagged "to be verified", only policy managers change them, confirming verification clears the flag; annual leave accrues monthly from the joining date; Sunday–Tuesday with a Monday holiday = 2 days, half-day = 0.5, half-day on several days refused, weekend-only refused, overlap 409, too little balance refused, sick leave without a document refused, team lead notified; team lead approves → balance deducted once, second approval 409, **a duplicate ledger row is refused by the database**, applicant notified; cancel before start restores once, second cancel 409; outside-the-team request invisible (404) to the lead; own request 403, and the database refuses a self-decision; rejection needs a note and deducts nothing; withdraw; other company 404; calendar shows the team's leave and holidays, only own leave to employees, everything to the Owner.
- **Web**: Leave page — My leave (balances, application form with live working-days and balance preview, document upload when required, my requests with withdraw/cancel), Approvals (approve, reject with note), Team calendar (4 weeks, holidays, pending vs approved), Policies (types with "to be verified" badges, edit incl. "verified by a Kuwaiti lawyer/accountant", public holidays per year). Sidebar, palette, dashboard Leave card, notifications. EN + AR.
- **Not yet:** balance adjustments screen (API exists: `POST /leave/adjustments`), automatic carry-over/expiry (decision §10), leave reducing capacity in utilisation, attendance link (Phase 10), unpaid leave in payroll (Phase 11).
