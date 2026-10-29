# Module spec: Clients / CRM (Phase 3)

Status: **Built and committed 2026-10-30** (nonstop mode; Claude's decisions in §9; results in §10).

## 1. Purpose and fit
Clients are the root of the business chain: contracts, engagement letters, projects, tasks, invoices and payments all belong to a client (brief Module B, §11). This module stores who the client is, who we talk to there, what was said, the documents they gave us, and a timeline — and lets every later module link to the right client.

## 2. Brief coverage (Module B)
| Required | Phase 3 | Later |
|---|---|---|
| Create and edit clients; company and contact information | ✅ bilingual legal name, type, CR number, industry, address, phone/email/website, account manager | — |
| Contacts and authorized representatives | ✅ contacts with position, email, phone, primary flag, **authorized representative** flag | — |
| Communication history | ✅ interactions: note / call / meeting / email (logged manually), linked to a contact | email integration |
| Client status | ✅ prospect → active → inactive; archive instead of delete | — |
| Notes and attachments | ✅ notes = interactions of kind *note*; documents via the 1.5b files service (virus-scanned) | — |
| Related contracts / engagement letters / projects / tasks / invoices & payments | tabs appear when those modules exist (owner decision: show only built modules) | Phases 4, 5, 6, 12 |
| Client activity timeline | ✅ from the audit trail of that client (created, edited, status, contacts, interactions, documents) | richer domain events |
| Search, filtering, sorting, export subject to permissions | ✅ search (names, CR number, email), status filter, sort by name / created / updated, cursor pagination, CSV export (permission) | saved views |
| Prevent accidental duplication | ✅ CR number unique per company (DB); same normalised name → warning that must be confirmed | fuzzy matching |
| Detail page with tabs | ✅ Overview, Contacts, Communication, Documents, Activity | Contracts, Projects, Financial |
| Dashboard (Module A: total active clients, new clients) | ✅ card: active clients, new this month | trends |

## 3. Data
| Table | Key columns |
|---|---|
| `clients` | tenant_id, id, `number` (C-0001, per company, gap-free sequence), type (`company`/`individual`/`government`), legal_name_en, legal_name_ar, name_key (normalised for duplicate checks), commercial_registration (unique per company when set), industry, email, phone, website, address_line, city, country (default KW), status (`prospect`/`active`/`inactive`), account_manager_membership_id, archived_at, version, created_by, timestamps |
| `client_contacts` | tenant_id, id, client_id (composite FK), name, position, email, phone, is_primary, is_authorized_representative, archived_at, timestamps |
| `client_interactions` | tenant_id, id, client_id, contact_id (optional, same client), kind (`note`/`call`/`meeting`/`email`), occurred_at, summary (≤ 4000 chars), created_by_user_id (member), created_at — append-only |
| `client_documents` | tenant_id, client_id, file_id (both composite FKs), added_by, created_at |
| `number_sequences` | tenant_id, name (`client`), next_value — shared by later modules (contracts, invoices) |
All forced RLS; every reference is a composite foreign key, so a contact/interaction/document can never point to another company's client.

## 4. Permissions (added to the matrix)
| Permission | Owner | CEO | Manager | Team Lead | Employee | Finance |
|---|---|---|---|---|---|---|
| clients.client.read | company | company | company | project* | project* | company |
| clients.client.create | company | company | company | — | — | — |
| clients.client.update (incl. contacts, interactions, documents) | company | company | company | — | — | — |
| clients.client.archive | company | company | — | — | — | — |
| clients.client.export | company | company | — | — | — | — |
\* project scope: clients of projects the person works on — effective once projects exist (Phase 5); until then they see none.

## 5. API
`GET /clients` (search, status, archived, sort, dir, limit, cursor) · `POST /clients` · `GET /clients/:id` · `PATCH /clients/:id` (with `version`; stale ⇒ 409) · `POST /clients/:id/archive` / `restore` · `GET /clients/export.csv` · contacts `GET/POST /clients/:id/contacts`, `PATCH /clients/:id/contacts/:contactId`, `POST …/archive` · interactions `GET/POST /clients/:id/interactions` · documents `GET/POST /clients/:id/documents` (body `{ fileId }` of a clean file I uploaded), `POST /clients/:id/documents/:fileId/download` · `GET /clients/:id/activity` · dashboard summary gains `clients { active, newThisMonth }`.

## 6. Security
Tenant RLS + composite FKs; permission per route; validation by shared Zod schemas (strict); optimistic concurrency on edits; CSV export escapes formula characters (`= + - @` → prefixed) and is audited; documents downloadable by anyone who may read the client, only when clean; activity shows action codes and actor names only.

## 7. Acceptance criteria
1. A Manager creates a client (EN + AR names); a second client with the same CR number is refused, with the same name needs confirmation.
2. List: search by Arabic or English name or CR number, filter by status, sort, paginate; empty / loading / error states.
3. Detail tabs work: edit overview (stale edit refused), add contacts (one primary, authorized representatives flagged), log interactions, attach a scanned document and download it, see the activity timeline.
4. Archive hides the client from the default list and pickers but keeps it readable; restore brings it back.
5. Export downloads a CSV (Excel-friendly, Arabic intact) for permitted roles only.
6. Employee: no Clients navigation and every client endpoint refused; another company: 404.
7. Dashboard shows active clients and new this month from real records; palette finds clients.

## 8. Test plan
API integration (CRUD, duplicates, concurrency, search/sort/pagination, contacts/interactions/documents, archive/restore, export escaping, permissions per role, cross-company 404); db isolation guard (new tables); web unit (CSV/format helpers where any); journey EN + AR: create client → contact → interaction → document → activity, list search, axe on every new screen.

## 9. Decisions taken by Claude (nonstop mode, reviewable)
- Permission matrix above (Finance reads clients; archive/export Owner + CEO).
- Client numbers `C-0001` per company, gap-free (row-locked sequence), never reused.
- Activity timeline built from the audit trail for now (target = client); a separate `activity_events` stream comes when cross-module timelines need it.
- Tabs for contracts/projects/financial appear with their modules, not as empty placeholders.
- Duplicate name check uses a normalised key (lower-case, Arabic letter variants unified, common legal suffixes such as W.L.L., K.S.C., ش.م.ك removed).

## 10. Results (2026-10-30)
- **Data:** migrations 0013 (tables) / 0014 (forced RLS, grants: clients/contacts no DELETE, interactions append-only, documents link removable, sequences update-only). Catalog guard covers the 5 new tables.
- **API:** `modules/clients` — 16 endpoints (§5), numbering with a row-locked sequence, duplicate checks (DB-unique CR number → 409 `duplicate`; normalised EN/AR name key → 409 `possible_duplicate` unless `confirmDuplicate`), optimistic concurrency (`version`), keyset pagination with an opaque cursor, literal search (no user wildcards), CSV export with formula neutralising + BOM (audited), documents via the 1.5b files service (only my own uploads, never infected; download for anyone who may read the client, clean files only), activity from the audit trail. Dashboard summary gained `clients { active, newThisMonth }` (Kuwait month).
- **Web:** Clients in the sidebar and palette (pages, "New client", recent clients searchable in EN/AR/CR), list (search, status filter, archived toggle, sortable headers with aria-sort, "Show more", export), new client with duplicate warning / "Create anyway", detail with Overview (edit, stale-edit handling), Contacts, Communication, Documents (upload → scan status refreshes until ready → download), Activity; dashboard Clients card.
- **Found and fixed while building:** Arabic hamza (ؤ) broke the legal-form list in the name key (unit test); the hidden file input lacked an accessible name (axe); the Arabic "Log" label (تسجيل) was ambiguous next to "Sign out" (تسجيل الخروج) → "حفظ في السجل".
- **Tests:** API 14 (`clients.spec.ts`) incl. Owner/Manager/Employee permissions, cross-company 404, duplicates, concurrency, search/sort/paging, contacts, interactions (wrong-client contact refused), documents, CSV injection (mutation-checked), dashboard counts; db 2 (composite FK, append-only); contracts 9 (name key, schema); journey EN + AR: create → contact → communication → real upload scanned clean by ClamAV → activity → Arabic search → duplicate warning, axe on 8 screens.
