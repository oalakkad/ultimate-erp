# Module spec: Payroll (Phase 11)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §10, results in §11). **Not for real payroll until a Kuwaiti lawyer/accountant has verified the rules.**

## 1. Purpose and fit
Monthly payroll from salary records, attendance (Phase 10) and leave (Phase 9), with explicit inputs (overtime hours, bonuses, advances, adjustments), a traceable calculation, separate preparation, approval and payment marking, payslips for employees and authorised exports.

## 2. Safety (brief "Payroll safety requirements")
- **Jurisdiction:** Kuwait (owner decision 2026-10-29: configurable rules, flagged). No tax, social-insurance (PIFSS), wage-protection, overtime or end-of-service formula is invented: every rate is a company setting. Rates that depend on the law start **switched off or at 0** with a "to be verified" flag; the few planning defaults (26 working days per month, 208 hours per month, overtime × 1.25) are flagged the same way.
- **Versioned rules:** every change creates a new rule-set version; each run keeps the version it used, and every payslip line keeps its inputs, rate and result (trace), so history never changes.
- **Separation of duties:** prepare (HR & payroll) → approve (CEO, never the preparer) → mark paid (approver, never the preparer). Database checks back this up.
- **No duplicates:** one run per company and month (unique key); one payslip per person per run; "paid" only once.
- **Not production-ready:** a run calculated with an unverified rule set is a **test run** — it can be approved for review but **cannot be marked paid**. The UI shows this on every payroll screen.
- **Access:** salaries and payslips only for payroll permissions; employees see only their own approved payslips; every view of salary data and every export is audited.

## 3. Calculation (pure, unit-tested; amounts in fils, KWD 3 decimals, rounded half-up per line)
For person *p* in month *m* with rule set *R* and salary record *S* (latest effective on or before the month's last day):
| Line | Formula |
|---|---|
| Basic | S.basic |
| Allowances | each S.allowance amount |
| Overtime | overtime hours (input) × S.basic ÷ R.monthlyHours × R.overtimeMultiplier — only if R.overtime.enabled |
| Bonus / adjustment (+) | inputs |
| Unpaid leave | − unpaid-leave working days in m × S.basic ÷ R.workingDaysDivisor — if R.unpaidLeave.enabled |
| Late arrivals | − late minutes in m × S.basic ÷ (R.monthlyHours × 60) — if R.lateDeduction.enabled (off by default) |
| Advance / adjustment (−) | inputs |
| Social insurance (employee share) | − R.socialInsurance.employeePercent % × S.basic — only if enabled and S.socialInsurance = true (off, 0 % by default) |
Gross = basic + allowances + additions; deductions = sum of negative lines; net = gross − deductions (never below 0: the run reports it instead).

## 4. Data
`payroll_rule_sets` (version, effective_from, rules JSON, to_verify), `salary_records` (person, effective_from, basic, allowances JSON, social_insurance flag), `payroll_runs` (period unique, status, rule_set_id, prepared_by, approved_by, paid_by, timestamps), `payroll_inputs` (run, person, kind, quantity/amount, note), `payslips` (run, person unique, gross, deductions, net, lines JSON trace). All forced RLS; payslips and runs never deleted.

## 5. Permissions
| Permission | CEO | HR & payroll | Employee |
|---|---|---|---|
| payroll.run.prepare (salary records, rules, inputs, calculate, submit) | company* | company | — |
| payroll.run.approve (approve, mark paid) | company* | — | — |
| payroll.payslip.read | company* | company | own (approved only; every role that can be an employee) |
| exports.confidential (CSV export) | company* | — | — |
*Two-factor required. The Owner role alone holds only "own" payslips; a company founder is Owner **and** CEO, so they can prepare and approve — but never approve or pay a run they prepared.

## 6. Run states
`draft → calculated ⇄ (recalculate) → submitted → approved → paid`; `draft | calculated | submitted → cancelled`. Recalculation only before submission; approval and payment by someone other than the preparer; payment only with a verified rule set.

## 7. API
`GET/POST /payroll/rules` (current + new version; `verified` flag), `GET/POST /payroll/salaries` (per person, history), `GET/POST /payroll/runs`, `GET /payroll/runs/:id` (payslips + totals + warnings), `PUT /payroll/runs/:id/inputs`, `POST /payroll/runs/:id/{calculate,submit,approve,pay,cancel}`, `GET /payroll/runs/:id/export` (CSV), `GET /payroll/payslips/mine`, `GET /payroll/payslips/:id`.

## 8. Acceptance criteria
1. Engine: basic 1,000.000 + housing 150.000, 4 overtime hours, 2 unpaid-leave days, 1 bonus 50.000 → lines and totals exactly as §3 with half-up rounding (unit tests incl. rounding edges).
2. One run per month; recalculation replaces payslips; inputs are explicit and traced.
3. Preparer can't approve or mark paid; approver can; test runs (unverified rules) can't be marked paid; paid only once.
4. Employees see only their own payslips and only after approval; others 404; salary reads and exports audited.
5. Rule changes create versions; an old run keeps its version and results.

## 9. Test plan
Unit tests for the engine; API integration for the workflow, permissions, duplicates and history; journey: HR (CEO in the test company) enters a salary, runs a test payroll, the colleague sees no payslip until approval.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Legal rates start disabled/0 and flagged; planning defaults flagged too. Real payroll requires an Owner/CEO to confirm the rule set as verified.
- Overtime hours are an explicit monthly input (attendance shows the data; no automatic legal overtime rule).
- End-of-service indemnity is not computed (final settlement is listed in the offboarding checklist); a later phase can add it as a verified rule.
- Wage Protection System files: not produced (format to be confirmed with the bank); CSV export instead.

## 11. Results (2026-10-30)
- **Engine** (`apps/api/src/modules/payroll/engine.spec.ts`, 6 unit tests): half-up rounding at the fil incl. negatives and ties; the spec example exactly (overtime 24.038, unpaid leave −76.923, net 1147.115); disabled rules produce no lines; late-minute deduction; social insurance only when enabled, with a rate, for eligible people; negative net reported and paid as 0; fractional inputs exact.
- **API** (`apps/api/test/payroll.spec.ts`, 4 tests against real Postgres + Mailpit): version 1 starts flagged with law-dependent rules off; changes create versions; employees get 403 on salaries and runs; salary reads audited without amounts; a run calculates traceable payslips (unpaid-leave days taken from approved leave, overtime and bonus from inputs) and a second run for the month is refused; preparer (HR) cannot approve; CEO approves; employees see only their own payslip and only after approval (others 404); **a test run cannot be paid — refused by the API and by the database**; payslips of an approved run can't be deleted even directly; CSV export only with `exports.confidential` (audited); after a CEO confirms verification the run is paid once (second payment 409, cancel after payment 409); a CEO who prepared a run cannot approve it; a newer rule version doesn't change an existing run; a cancelled month can be run again.
- **Web**: Payroll (runs, salaries with history, versioned rules with "to be verified"/"verified" and the verification confirmation), run page (status, test-run badge, totals, warnings, explicit inputs, calculate/submit/approve/pay/cancel, CSV export, payslips with line-by-line trace), My payslips; the "not verified" warning on every payroll screen. EN + AR.
- **Found by the browser journey and fixed:** only the Employee role could see its own payslips; every role that can be an employee now can ("own" scope — no extra two-factor requirement).
- **Not built:** end-of-service indemnity, Wage Protection System bank file, employer social-insurance share and PIFSS reports — all need verified rules/formats first.
