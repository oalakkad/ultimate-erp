# Module spec: Expenses (Phase 12b)

Status: **Built 2026-10-31** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
Staff spend money for the firm (travel, transport, meals, subcontractors, filing fees). They claim it back with receipts; a manager approves; finance records the reimbursement. Expenses on a project count toward its cost, and billable ones can be re-billed to the client on an invoice (Phase 12) — once. The brief asks for "pending expenses or approvals if expense management is implemented" on the dashboard (§ executive dashboard); the domain model (§7) planned this module.

## 2. Scope
| Item | Phase 12b |
|---|---|
| Claims with lines (date, category, description, amount KWD 3 dp, optional project, billable flag, receipt) | ✅ |
| Categories as company settings (bilingual, active flag) and "receipt required above" amount | ✅ defaults: travel, transport, meals, accommodation, subcontractor, government fees, office, other; receipt required above 5.000 KWD (setting) |
| Workflow draft → submitted → approved / rejected → reimbursed; rejected claims can be reopened as drafts | ✅ |
| Separation of duties: never decide or reimburse your own claim | ✅ API + database check |
| Approver: direct manager / team lead (team scope) or Owner, CEO, Finance (company) | ✅ |
| Reimbursement recorded by finance (date, method, reference) — "recorded", not a bank integration | ✅ |
| Re-billing: approved billable lines of a project added to a draft invoice at cost, each line at most once; voiding the invoice or deleting the draft releases them | ✅ |
| Project cost: approved expenses and billable share per project | ✅ project Expenses card |
| Notifications: submitted (to approvers), decided, reimbursed (to the claimant) | ✅ |
| Dashboard: claims waiting for me, amount awaiting reimbursement | ✅ |
| Audit of every step | ✅ |

## 3. Rules
- Amounts are KWD with 3 decimals, > 0, ≤ 100 000.000 per line; claim total = Σ lines (exact, in fils).
- Lines are editable only while the claim is a draft (database trigger). A line marked billable must name a project; the project must be one the claimant works on (member of its team or its manager), or any project for company readers.
- Submit needs ≥ 1 line and a receipt for each line above the "receipt required" amount; the number `EX-0001` is given on first submission.
- Approve / reject (reason required) only while submitted; reimburse only when approved; reimbursed is final.
- Approved or reimbursed claims are never deleted; drafts may be.

## 4. Data
`expense_claims` (number, claimant membership, title, status, total, decided by/at/note, reimbursed by/on/method/reference), `expense_lines` (claim, position, date, category code, description, amount, project, billable, receipt file), `invoice_expense_lines` (line unique — billed once). Settings in `company_settings` key `expenses`. All forced RLS.

## 5. Permissions
| Permission | Owner | CEO | Manager | Team leader | Employee | Finance | HR & payroll |
|---|---|---|---|---|---|---|---|
| expenses.claim.create | own | own | own | own | own | own | own |
| expenses.claim.read | company | company | team | team | own | company | — (own via create) |
| expenses.claim.approve | company | company | team | team | — | company | — |
| expenses.claim.reimburse | company | company | — | — | — | company | — |
| expenses.settings.manage | company | company | — | — | — | company | — |
Own claims are always readable by the claimant.

## 6. API
`GET/PATCH /expenses/settings`; `GET /expenses?view=mine|approvals|reimburse|project&projectId&status`; `POST /expenses`; `GET/PATCH/DELETE /expenses/:id`; `POST /expenses/:id/{submit,approve,reject,reopen,reimburse}`; `POST /expenses/:id/lines/:lineId/receipt` (5-minute download link); `GET /projects/:id/expenses` (cost summary). Invoices: `POST /invoices/from-time` gains `includeExpenses`.

## 7. Acceptance criteria
1. Employee drafts a claim with two lines (12.500 taxi, 40.000 filing fee on project P, billable, receipt) → total 52.500; submit gives EX-0001; a line above 5.000 without a receipt blocks submit.
2. Their manager (team scope) approves; the employee can't approve their own; someone outside the team gets 404; another company 404.
3. Rejected with a reason → reopen → edit → submit again keeps the same number.
4. Finance records the reimbursement → reimbursed (final); the database refuses line edits after submit and reimbursement of a non-approved claim.
5. Draft invoice from time with `includeExpenses` adds the billable line at 40.000 once; a second draft doesn't take it; voiding releases it.
6. Project expenses card shows approved 40.000, billable 40.000; dashboard shows waiting counts.

## 8. Test plan
API integration (`apps/api/test/expenses.spec.ts`) for every criterion; db isolation list extended; journey EN + AR: the colleague claims an expense with a receipt on the project and submits; the Owner approves and records the reimbursement.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Re-billing at cost (no mark-up) as a separate invoice line per expense line; a mark-up setting can come later.
- Reimbursement is recorded by finance outside the system (bank transfer, cash); paying through payroll is a later option.
- Default categories and the 5.000 KWD receipt threshold are company settings, not legal rules.
- HR & payroll do not see others' expense claims (finance does).

## 11. Results (2026-10-31)
- **API** (`apps/api/test/expenses.spec.ts`, 3 tests against real Postgres + Mailpit): exact totals (4.500 + 40.000 = 44.500); a line above the 5.000 threshold without a receipt blocks submission; someone else's file can't be my receipt; unknown category, billable without a project and a project I'm not on are refused; EX-0001 on submission; submitted claims can't be edited — **the database refuses line changes and deletion**; the line manager is notified; the claimant can't approve their own (403), people outside the team and other companies get 404; reject needs a reason; reopen → resubmit keeps the number; managers can't reimburse; **the database refuses a self-decision and leaving "reimbursed"**; reimbursement once (second → 409); claimant notified of decision and reimbursement; project cost (pending → approved, billable, invoiced); dashboard waiting and to-reimburse; draft invoice from time re-bills the billable expense at cost once; voiding releases it for re-billing.
- **Web**: Expenses page (my claims, to approve, to reimburse, all, settings with categories and receipt threshold), claim page (lines editor with category, project, bill-to-client and receipt upload; submit; approve; send back with reason; reopen; record reimbursement "recorded by staff"; receipt download), project Expenses card, dashboard Expenses card, invoice option "also re-bill expenses", bell texts, sidebar and palette. EN + AR.
- **Not yet:** mileage rates, per-diem rules, foreign-currency receipts, mark-up on re-billing, reimbursement through payroll, corporate cards.
