# Module spec: Notifications & announcements (Phase 13)

Status: **Built 2026-10-31** (nonstop mode; Claude's decisions in §10, results in §11).

## 1. Purpose and fit
One notification centre for every module: the bell and panel (Milestone 1.5a) now honour each person's preferences, can send an email copy in the reader's language, and carry the missing event types (invoice issued, budget thresholds, announcements). Authorized people publish company announcements to everyone or to chosen roles, with protection against accidental mass delivery.

## 2. Brief coverage (Module L)
| Required | Phase 13 |
|---|---|
| Task assignments / deadlines | ✅ `tasks.assigned`, `tasks.overdue` (Phase 6) |
| Project budget thresholds | ✅ `projects.budget_threshold` when allocations cross 80 % or 100 % of budget hours (project manager, Owner, CEO) |
| Leave applications / decisions | ✅ `leave.*` (Phase 9) |
| Attendance exceptions | ✅ correction requested / decided (Phase 10) |
| Contract expiration | ✅ `contracts.renewal_due`, `contracts.expired` (Phase 4) |
| Invoice issuance / overdue | ✅ `billing.issued` (to the project manager), `billing.overdue` (Phase 12) |
| Payroll approvals | ✅ `payroll.submitted`, `payroll.payslip_ready` (Phase 11) |
| System security events | ✅ roles changed (mandatory in-app); new-device, lockout and password emails (Milestone 1.3a) are always sent and not switchable |
| Company announcements | ✅ bilingual announcements to everyone or chosen roles |
| In-app, read/unread, deep links | ✅ 1.5a; links are only paths in this company and the target page re-checks access |
| Preferences | ✅ per person, per company, per type: in the app on/off, email copy on/off |
| Email / delivery status / retries | ✅ email copies and announcement emails go through the transactional outbox (6 attempts, status recorded); publishers see queued / sent / failed counts |
| No leaks across companies or to unauthorized people | ✅ forced RLS on all new tables; recipients are chosen by the server from the company's own members |
| Permission-controlled, auditable, protected against mass delivery | ✅ `announcements.publish`; the publisher must confirm the exact recipient count from a preview; 10 announcements per company per day; every publish and every notification batch audited |

## 3. Preferences
- Stored only when changed (`notification_preferences`, key company + membership + type); defaults are **in the app on, email off**.
- **Mandatory in the app** (cannot be muted): `access.roles_changed` (security) and `announcements.published`. Email copies of them can still be switched on or off.
- Email copies go only to verified addresses, in each recipient's language (account locale), with a link to the company address.

## 4. Announcements
1. The publisher writes the title and text in English and Arabic and chooses the audience (no roles chosen = everyone in the company).
2. "Check recipients" asks the server how many active members match; the publish request must repeat that number (`confirmRecipients`). If membership changed in between, publishing is refused ("check the preview again").
3. On publish, in one transaction: the announcement row, in-app notifications in batches of 200 (the Notifier cap), optional emails recorded in `announcement_emails` (to report delivery status), and an audit event with the recipient count.
4. Everyone sees announcements addressed to them on the Announcements page; publishers also see all announcements and their delivery counts.

## 5. Data
`notification_preferences`, `announcements` (bilingual title/body, roles, email flag, recipient count, publisher, time), `announcement_emails` (links to `email_deliveries`). Migrations 0033 (tables) and 0034 (forced RLS, grants: announcements insert/select only).

## 6. Permissions
| Permission | Owner | CEO | HR & payroll | Others |
|---|---|---|---|---|
| announcements.publish | company | company | company | — |
Reading announcements and managing your own preferences needs only company membership.

## 7. API
`GET/PUT /notifications/preferences`; `GET /announcements`, `POST /announcements/preview` `{ roles }` → `{ recipients }`, `POST /announcements` (fields + `email` + `confirmRecipients`).

## 8. Acceptance criteria
1. A person mutes `tasks.assigned` in the app → no new notification of that type; asks for an email copy → the email arrives in their language. Asking to mute a mandatory type in the app is ignored (it stays on).
2. Preview with no roles counts every active member; publishing with a different count → 409; with the right count → everyone gets the notification, emails are queued when asked, the audit log records it, delivery counts appear for the publisher.
3. Targeted roles reach only those members; non-publishers get 403 on preview/publish and see only announcements addressed to them; another company sees nothing.
4. Allocations crossing 80 % and 100 % alert once each; issuing an invoice tells the project manager.
5. More than 10 announcements in 24 hours → 409.

## 9. Test plan
API integration (`apps/api/test/announcements.spec.ts`, real Postgres + Mailpit) for every criterion; db isolation list extended with the three tables; journey EN + AR: Owner checks recipients (2), publishes, the colleague sees it on the Announcements page, the Owner changes a preference in My account; axe on the new screens.

## 10. Decisions taken by Claude (nonstop mode, reviewable)
- Defaults: in-app on, email copies off (people opt in); security events and announcements can't be muted in the app.
- Publishers: Owner, CEO, HR & payroll.
- Mass-delivery protection: exact recipient-count confirmation + 10 per company per day.
- Announcements are not editable or deletable after publishing (they are a record of what was said).
- No SMS / push channels yet (push arrives with the mobile app, Phase 16).

## 11. Results (2026-10-31)
- **API** (5 tests, real Postgres + Mailpit): preferences with mandatory types and email copies in the reader's language with the company link; publish refused for employees (403) and with a stale count (409), mandatory even when muted, emails recorded and counted, audit; role targeting and cross-company isolation; the 11th announcement in a day refused; budget thresholds at 80 % / 100 % and invoice-issued notice.
- **Web**: Announcements page (list, publish card with recipient check), notification settings on My account, bell texts for the new types, sidebar and palette entry. EN + AR.
- **Not yet:** SMS / push channels, scheduled announcements, digest emails.
