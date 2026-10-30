# Module spec: Contracts & engagement letters (Phase 4)

Status: **Built and committed 2026-10-30** (nonstop mode; decisions §9; results §10).

## 1. Purpose and fit
Contracts and engagement letters define what the firm will do for a client, for how long and for how much. They belong to a client (Phase 3), will govern projects (Phase 5) and be billed by invoices (Phase 12). This module creates them from reusable bilingual templates, numbers them, versions their text, runs them through review and approval, records sending and signing, and warns before they expire.

## 2. Brief coverage (Module C)
| Required | Phase 4 |
|---|---|
| Contract and engagement letter creation | ✅ one register with a `kind` (`contract` / `engagement_letter`) |
| Reusable templates | ✅ bilingual templates (EN + AR) with placeholders: `{{client.name}}`, `{{client.number}}`, `{{document.number}}`, `{{start_date}}`, `{{end_date}}`, `{{value}}`, `{{payment_terms}}`, `{{company.name}}`, `{{today}}` |
| Document numbering | ✅ per company and kind, gap-free: `CT-0001`, `EL-0001` |
| Client association | ✅ required; composite foreign key; shown on the client page (Contracts tab) |
| States: draft, review, approved, sent, signed, active, expired, terminated | ✅ state machine (§4) enforced on the server |
| Start and end dates; value and payment terms | ✅ dates; value as `numeric(20,3)` + currency (KWD default); payment terms text |
| Version history | ✅ every text change in draft makes a new immutable version (EN + AR body, note, author) |
| Secure document storage; authorized downloads | ✅ signed copy and attachments through the virus-scanned files service; downloads by contract permission only |
| Renewal reminders; expiration alerts | ✅ daily job (08:00 Kuwait): notifies before the end date (`renewal_notice_days`, default 30) and marks active contracts expired after it |
| Approval workflows | ✅ submit → approve / reject; the approver must be a different person (separation of duties) |
| Electronic signatures | ❌ not claimed: "Signed" means a **counter-signed copy was uploaded** and is labelled so; an e-signature provider is a later integration |
| Link to projects and invoices | added by Phases 5 and 12 (`contract_id` on their records) |

## 3. Data
| Table | Key columns |
|---|---|
| `contract_templates` | tenant_id, id, kind, name, body_en, body_ar, archived_at, version, timestamps |
| `contracts` | tenant_id, id, kind, number, client_id, template_id, title_en, title_ar, status, start_date, end_date, value_amount numeric(20,3), currency, payment_terms, renewal_notice_days, current_version, submitted_by, approved_by, approved_at, sent_at, signed_at, signed_file_id, activated_at, terminated_at, termination_reason, renewal_notified_at, created_by, version (optimistic), timestamps |
| `contract_versions` | tenant_id, contract_id, version_no, body_en, body_ar, change_note, created_by, created_at — append-only |
All forced RLS; composite foreign keys to clients, templates, files and members. Checks: end ≥ start; value ≥ 0; approver ≠ submitter (DB check).

## 4. Status machine
`draft → in_review` (submit; needs a version) · `in_review → approved` (approve: `contracts.contract.approve`, not the submitter) · `in_review → draft` (reject, with reason) · `approved → sent` · `sent → signed` (signed copy file required) · `signed → active` (activate) · `active → expired` (daily job, or end date passed) · `signed | active → terminated` (reason). Text and terms can change only in `draft`.

## 5. Permissions
| Permission | Owner | CEO | Manager | Team Lead | Employee | Finance |
|---|---|---|---|---|---|---|
| contracts.contract.read | company | company | company | project | project | company |
| contracts.contract.manage (create, edit drafts, submit, send, record signed, activate, terminate) | company | company | company | — | — | — |
| contracts.contract.approve | company | company | — | — | — | — |
| contracts.template.manage | company | company | — | — | — | — |

## 6. API
Templates: `GET/POST /contract-templates`, `PATCH /contract-templates/:id`, `POST …/archive`. Contracts: `GET /contracts` (search, status, kind, clientId, expiringWithinDays, sort, cursor), `POST /contracts` (from a template or blank), `GET/PATCH /contracts/:id`, `GET /contracts/:id/versions`, `POST /contracts/:id/versions` (new text in draft), `POST /contracts/:id/{submit,approve,reject,send,sign,activate,terminate}`, `POST /contracts/:id/signed-copy/download`. Dashboard: `contracts { active, expiringSoon }`.

## 7. Acceptance criteria
1. Owner creates a bilingual template; a Manager creates an engagement letter from it for a client; placeholders are filled; number `EL-0001`.
2. Editing the text in draft creates version 2; versions list shows both; non-draft edits are refused.
3. The Manager submits; the same Manager cannot approve (403); the CEO/Owner approves; reject returns to draft with the reason.
4. Mark sent; "signed" requires an uploaded counter-signed copy (scanned clean before download); activate; terminate with a reason.
5. The daily job notifies before the end date once, and expires active contracts after it — only within each company.
6. Print view renders the current version in English and Arabic for "Save as PDF".
7. Employee: no access; other company: 404. Dashboard shows active and expiring-soon counts.

## 8. Test plan
API integration (templates, rendering, numbering, versions, every transition incl. refused ones, SoD, signed copy, termination, permissions, cross-company), job tests (renewal notification once, expiry, tenant isolation), db constraints, journey EN + AR (template → letter → submit → approve as Owner → send → upload signed copy → activate → print view), axe.

## 9. Decisions taken by Claude (nonstop mode, reviewable)
- One register with a `kind` instead of two modules (same lifecycle and fields).
- Approver ≠ submitter, enforced in the API and the database.
- PDF: print-optimised page (browser "Save as PDF" shapes Arabic correctly); server-side PDF generation comes with invoices (Phase 12).
- "Signed" = counter-signed copy uploaded; no e-signature claim.
- Renewal notice default 30 days; the daily job runs 08:00 Asia/Kuwait.
- Notification recipients: the contract's creator and the company's Owners/CEOs.

## 10. Results (2026-10-30)
- **Data:** migrations 0015/0016 — 3 tables with forced RLS; contracts never deleted; versions append-only; DB checks for dates, value, currency, notice days, **approver ≠ submitter**, signed ⇒ file; `app.active_tenant_ids()` (IDs only) for company-by-company jobs.
- **API:** `modules/contracts` (templates, contracts, versions, 7 transitions through one state machine, signed-copy download), shared `nextDocumentNumber` (clients use it too), `Notifier.notifySystem`, `JobQueue.schedule`; daily job `contracts.daily` at 08:00 Asia/Kuwait (worker). Notifications: submitted (to Owners/CEOs), approved / rejected (to the submitter), renewal due and expired (creator + Owners/CEOs). Dashboard `contracts { active, expiringSoon }`.
- **Web:** Contracts in sidebar and palette; register with kind/status/expiring filters and search; New document (client, template, terms); detail with workflow panel (only allowed actions, reason dialogs, signed-copy upload), terms editing in draft, bilingual text editor with version history; print view (browser Save as PDF); templates page; Contracts tab on the client page; dashboard card; notification texts.
- **Tests:** API 8 (`contracts.spec.ts`) incl. template rendering, numbering per kind, versions + draft-only, every transition and refused skips, SoD (mutation-checked: removing the app check leaves the DB check, the test still fails), signed copy rules, daily job (expire, remind once, per company), filters, dashboard, Employee 403, other company 404 / foreign client refused. Journey EN + AR: template → colleague promoted to Manager → Manager drafts from template and submits → Owner approves, sends, records signed copy, activates → print view; axe on 7 more screens (one real issue fixed: invalid definition-list markup).
