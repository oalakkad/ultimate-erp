# Module spec: Invoicing & payments (Phase 12)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
Invoices to clients for fixed fees and approved billable time (Phase 7), linked to contracts (Phase 4) and projects (Phase 5); payments, credit notes, outstanding balances, overdue reminders, aging and revenue reports. Money is KWD with 3 decimals, computed in fils, never floats.

## 2. Brief coverage (Module K)
| Required | Phase 12 |
|---|---|
| Creation, numbering, client / contract / project association | ✅ drafts for a client, optional contract and project of **that** client (database keys); number `INV-0001` given **when issued** (no gaps from deleted drafts) |
| Line items, quantities, rates, discounts | ✅ lines with quantity × unit price, discount % per line |
| Taxes by configured rules | ✅ company tax settings (none active by default — Kuwait has no VAT today; flagged "to be verified") |
| Currency | ✅ KWD only for now (3 decimals); the currency is stored on every document |
| Issue and due dates; states | ✅ draft → issued → partially paid → paid; void; **overdue** is shown when the due date has passed with a balance |
| From approved billable time | ✅ draft lines from approved, billable, not-yet-invoiced time of a project at a given hourly rate; each entry can be invoiced only once (unique key) |
| PDF; secure delivery | ✅ print view (browser "Save as PDF", bilingual); server-side PDF and client delivery links are later (decision §10) |
| Payment recording, partial payments, outstanding | ✅ recorded payments (method, date, reference) — labelled **recorded**, distinct from provider-confirmed payments (no provider integrated yet) |
| Credit notes, controlled corrections | ✅ credit notes `CN-0001` reduce the balance; void only before any payment; payments reversed with a reason; issued documents are never deleted |
| Reminders, aging, revenue | ✅ daily 08:00 job reminds finance of overdue invoices (once a week per invoice); aging buckets; revenue by month (issued and received) |

## 3. Rules (amounts in fils, half-up per line)
line amount = qty × price; discount = amount × discount%; net = amount − discount; tax = net × rate% (if the line's tax is active); invoice total = Σ net + Σ tax; outstanding = total − (payments − reversed) − credit notes. Transitions are checked by the server and backed by database checks (issued documents can't return to draft; void needs a reason and no payments).

## 4. Data
`invoices`, `invoice_lines`, `invoice_time_entries` (time entry unique), `payments` (status recorded / reversed, source recorded / provider), `credit_notes`; settings in `company_settings` key `billing`. All forced RLS; issued invoices, payments and credit notes never deleted (draft invoices may be).

## 5. Permissions
| Permission | Owner | CEO | Manager | Finance |
|---|---|---|---|---|
| billing.invoice.read | company | company | project | company |
| billing.invoice.issue (drafts, issue, void, credit notes) | company | company | — | company |
| billing.payment.record (payments, reversals) | company* | company* | — | company* |
*Two-factor required (existing sensitive permission).

## 6. API
`GET/PATCH /billing/settings`, `GET/POST /invoices`, `POST /invoices/from-time`, `GET/PATCH/DELETE /invoices/:id` (drafts), `POST /invoices/:id/{issue,void}`, `POST /invoices/:id/payments`, `POST /payments/:id/reverse`, `POST /invoices/:id/credit-notes`, `GET /billing/aging`, `GET /billing/revenue?year`. Dashboard: `billing { outstanding, overdue }`.

## 7. Acceptance criteria
1. Draft with 2 lines (10 h × 25.000 with 10 % discount; fixed fee 500.000) → total 725.000; tax added only when a tax is active.
2. Issue → INV-0001, due date = issue + terms; issued invoices can't be edited or deleted.
3. Payment 300 → partially paid, outstanding 425; payment 425 → paid; overpayment refused; reversal reopens the balance.
4. Credit note reduces the balance; void only without payments and with a reason.
5. Draft from time takes approved billable entries once; a second draft can't take the same entries; deleting the draft releases them.
6. Overdue shown and reminded once a week; aging and revenue reports; manager sees only invoices of projects they manage; another company 404.

## 8. Test plan
Unit tests for the money maths; API integration for every criterion; journey EN + AR: Owner invoices the colleague's approved time from the Phase 7 step, issues it, records a partial payment, opens the print view.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Numbers on issue, per company, `INV-` and `CN-` sequences.
- Tax: no tax active by default; a company adds taxes in settings (flagged "to be verified by a Kuwaiti accountant").
- Payment terms default 30 days (setting).
- PDFs come from the print view for now (as contracts); server-generated PDFs and emailed client links are a later integration.
- Reminders go to the company's finance staff, not to clients, until client delivery exists.
- Voiding an issued invoice (only possible without payments or credit notes) releases its billed time so it can be invoiced again.

## 11. Results (2026-10-30)
- **API** (`apps/api/test/billing.spec.ts`, 7 tests against real Postgres + Mailpit): fil-exact line maths incl. half-up tax; draft 725.000 (10 h × 25 with 10 % + 500 fee) → INV-0001 on issue with due date +30; issued invoices can't be edited or deleted — **the database refuses deletion and a return to draft**; deleted drafts leave no gap; a project of another client is refused; partial payment 300 → outstanding 425, overpayment and future dates refused, void refused once money exists, credit note CN-0001, full payment → paid, reversal reopens the balance (twice → 409); **the app role can neither delete nor edit payments**; void needs a reason, void stays void (DB); approved billable time is billed once — second draft refused, deleting the draft or voiding the invoice releases it; only active configured taxes apply (unknown tax refused, 5 % → 5.000); managers see invoices of projects they manage only and can't record payments; employees 403; other company 404; overdue filter, weekly reminder to finance (two runs, one notification), aging buckets and client totals, revenue by month, dashboard receivables.
- **Web**: Invoices (list with search/status/overdue, aging, revenue, settings with taxes flagged for verification), New invoice (lines editor or draft from approved time at an hourly rate), invoice page (lines, totals, issue, record payment labelled "recorded by staff", reverse, credit note, void, delete draft), bilingual print view for PDF, client Invoices tab, sidebar, palette, dashboard Receivables card, overdue notifications. EN + AR.
- **Not yet:** server-generated PDF files and emailed client delivery links, payment-provider integration (KNET gateway), multi-currency.
