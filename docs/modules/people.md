# Module spec: Employees & teams (Phase 8)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
A **member** (Phase 1.4) is someone who can sign in to the company. An **employee record** adds what HR needs: number, job title, department, manager, employment status and dates, work schedule, private details, emergency contacts, documents and history. Teams and the reporting line give the "team" permission scope its meaning (team leads, leave approval in Phase 9). Weekly contracted hours give capacity, so utilisation (Phase 7) and workload (Phase 6) can be compared against it.

## 2. Brief coverage (Module G + §8 "Financial and employee information")
| Required | Phase 8 |
|---|---|
| Profiles, identifiers | ✅ employee record per member, number `E-0001` |
| Departments, teams, job titles | ✅ bilingual departments and teams (with a lead and members); bilingual job title |
| Managers, reporting hierarchy | ✅ "reports to"; no loops; organisation view |
| Employment status; joining / leaving dates | ✅ onboarding → active ⇄ on leave → offboarding → left |
| Work schedules | ✅ working days (default Sunday–Thursday) and contracted weekly hours (capacity) |
| Company assignments; role and permission assignments | ✅ via memberships and Members (Phase 1.4); the employee page links to them |
| Documents | ✅ employee documents (virus-scanned, confidential = restricted readers only) |
| Emergency contacts with restrictions | ✅ restricted section |
| Employment history | ✅ append-only, written automatically on every change |
| Onboarding and offboarding | ✅ checklists started with the status; leaving sets the leave date and suspends sign-in on "left" |
| Access controls for personal records; not every manager sees everything | ✅ three levels: directory (basic), employment details, restricted private data — see §5 |
| Field-level restriction, short-lived links, no sensitive logging | ✅ private data encrypted in the database (AES-256-GCM, own key `DATA_ENCRYPTION_KEY`), never logged; every restricted read audited; 5-minute links |

## 3. Data
| Table | Key columns |
|---|---|
| `departments` | tenant_id, id, name_en, name_ar, archived_at |
| `teams` | tenant_id, id, name_en, name_ar, department_id, lead_membership_id, archived_at |
| `team_members` | tenant_id, team_id, membership_id |
| `employees` | tenant_id, membership_id (key), number, job_title_en/ar, department_id, manager_membership_id, status, employment_type, join_date, leave_date, weekly_hours numeric(5,2), work_days int[], version |
| `employee_private` | tenant_id, membership_id, sealed (encrypted JSON: civil ID, nationality, birth date, personal phone/email, address, bank, IBAN), civil_id_hash (keyed hash, unique per company), updated_by |
| `employee_emergency_contacts` | tenant_id, id, membership_id, name, relationship, phone |
| `employee_history` | tenant_id, id, membership_id, kind, from / to (field names and values of non-private fields), changed_by, created_at — append-only |
| `employee_documents` | tenant_id, membership_id, file_id, category, confidential |
| `employee_checklist_items` | tenant_id, id, membership_id, kind (onboarding / offboarding), title, done_at, done_by |

## 4. Levels of access
1. **Directory** (anyone who can read people at any scope): name, number, title, department, teams, manager, status.
2. **Employment details** (company readers, HR, the person themself, and their direct manager): type, dates, schedule, history, non-confidential documents, checklists.
3. **Restricted** (`people.employee.read_restricted`: Owner, CEO with two-factor, HR & payroll, the person themself): private details, emergency contacts, confidential documents. Each read is audited.

## 5. Permissions
| Permission | Owner | CEO | Manager | Team Lead | Employee | HR & payroll |
|---|---|---|---|---|---|---|
| people.employee.read | company | company | team | team | own | company |
| people.employee.read_restricted | company | company* | — | — | own | company |
| people.employee.manage (records, status, checklists, documents) | company | company | — | — | — | company |
| people.org.manage (departments, teams) | company | company | — | — | — | company |
**team** = members of teams I lead plus people who report to me. *Two-factor required.

## 6. Status
`onboarding → active`, `active ⇄ on_leave`, `active | on_leave → offboarding → left`, `onboarding → left` (did not start). "Left" needs a leave date, suspends the member's access to the company (sign-in elsewhere unaffected) and ends team memberships.

## 7. API
`GET /people` (search, departmentId, teamId, status), `POST /people` (create record for a member), `GET/PATCH /people/:membershipId`, `POST /people/:id/status`, `GET/PUT /people/:id/private` (restricted, audited), `GET/POST/DELETE /people/:id/emergency-contacts`, `GET /people/:id/history`, documents, `GET/PATCH /people/:id/checklist[/:itemId]`, `GET/POST/PATCH /departments`, `GET/POST/PATCH /teams`, `PUT /teams/:id/members`, `GET /org-chart`. Time summary gains capacity and utilisation.

## 8. Acceptance criteria
1. HR creates a record for a member → `E-0001`, onboarding checklist created, history "joined".
2. Directory shows basics to a team lead for their team only; employment details only to company readers, HR, the person and their manager; private data only to restricted readers, audited; another company 404.
3. Private data is not readable in the database without the key (stored sealed); duplicate civil ID refused.
4. Reporting line cannot loop; team lead and members; "team" scope reflects teams and direct reports.
5. Status changes write history; "left" requires a leave date, suspends access and clears teams.
6. Utilisation = approved hours / (weekly hours × weeks) when a record exists.

## 9. Test plan
API integration for each criterion, plus checks on the encryption round-trip and that the private fields are absent from the database text; journey EN + AR: Owner creates the colleague's employee record, a department and team, opens the organisation view; axe on new screens.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Employee records are created by HR for existing members (invite first); not every member must be an employee (e.g. external advisers).
- Private details are encrypted with a separate key `DATA_ENCRYPTION_KEY` (not the sign-in secret), so either can be rotated independently; losing that key loses the private data — keep it in the secret manager and backups.
- Default schedule: Sunday–Thursday, 40 contracted hours a week; both are per-employee values, not legal statements.
- Team scope = teams I lead + my direct reports (not the whole chain below me).
- Legal fields for Kuwait (civil ID format, PIFSS number) are free text now; validation rules come with payroll (Phase 11), marked "to be verified".
- The record of someone who has left is read-only (including private details); access to the company is suspended, not deleted.

## 11. Results (2026-10-30)
- **API**: `apps/api/test/people.spec.ts` — 6 tests passing against real Postgres + Mailpit: E-0001 + onboarding checklist + "joined" history, duplicate record 409, employee can't create, edits written to history with from/to; employee sees only themself, team lead sees their team (directory only — no details, no email, history and private 403), manager sees their report's employment details but not private data, other company 404; private details round-trip, **the database row contains neither the civil ID nor the IBAN**, reads audited, audit details never contain values, duplicate civil ID (spaces ignored) 409; reporting loop 409; departments, org chart; lifecycle onboarding → active → offboarding (checklist) → left (needs date) → access suspended (404 at the company) and teams cleared; nobody marks themselves as left; capacity 40 h and utilisation 20 % from 8 approved hours. Plus 3 unit tests for the field cipher (round-trip, wrong company / tampering / other key refused, keyed look-up hash).
- **Web**: People directory (search, department, status), New employee record, person page (overview, status with leave date, Employment edit incl. manager, department, type, weekly hours and working days, Documents, Checklists, History, Private with emergency contacts), Organisation (departments, teams with lead and members, reporting lines), sidebar + palette. EN + AR.
- **Not yet:** team-scope approval of time (time stays with project managers); legal field validation (civil ID format, PIFSS) with payroll; employee self-service edits beyond private details.
