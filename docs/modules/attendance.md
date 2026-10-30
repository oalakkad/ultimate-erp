# Module spec: Attendance (Phase 10)

Status: **Built 2026-10-30** (nonstop mode; Claude's decisions in §8, results in §9).

## 1. Purpose and fit
People check in and out; the system compares that with their shift to show late arrivals, early departures and absences, alongside approved leave (Phase 9), public holidays and logged time (Phase 7). Payroll (Phase 11) reads the same summary. Every record is auditable and corrections go through an approval.

## 2. Brief coverage (Module I + "QR code security")
| Required | Phase 10 |
|---|---|
| QR check-in and check-out | ✅ a kiosk screen at the office shows a **rotating, server-signed QR code** (new every 30 s); people scan it with their signed-in phone |
| Web attendance | ✅ a "Check in / out" button, if the company allows it (setting) |
| Mobile attendance | later (Phase 16 app uses the same API) |
| Approved manual corrections | ✅ correction requests with a reason → approved by team lead / manager / HR → recorded as a "manual" event |
| Shift management; work schedules | ✅ shifts (start, end, grace minutes, break minutes) assigned per person; working days from the employee record |
| Late arrivals, early departures, absence, breaks | ✅ computed per day against the shift; absence = working day without check-in, not on leave, not a holiday; the shift's break is deducted from worked time |
| Summaries; timesheet and payroll integration | ✅ per-person period summary (worked vs logged hours, late / early / absent counts); "who is in today" board |
| No static QR; expiring signed codes; rotation; replay protection; authenticated check-ins; server time | ✅ HMAC-signed codes bound to site and 30-second window, accepted only in the current or previous window, one use per person per window, only by signed-in members, time always from the server |
| Location verification | not used: the QR is shown only at the physical kiosk (decision §10) |
| Offline, device failure, corrections, disputes | ✅ policy: no offline check-ins; if the kiosk or phone fails, the person files a correction; a rejected correction shows the reviewer's note and can be raised again (dispute) |
| Auditable | ✅ events are append-only; corrections and setting changes are in the audit log |

## 3. Data
| Table | Key columns |
|---|---|
| `attendance_settings` | tenant_id (key), allow_web, rotation_seconds (30), min_minutes_between (1) |
| `attendance_sites` | tenant_id, id, name_en/ar, archived_at |
| `shifts` | tenant_id, id, name_en/ar, start_time, end_time, grace_minutes, break_minutes, archived_at |
| `shift_assignments` | tenant_id, membership_id (key), shift_id |
| `attendance_events` | tenant_id, id, membership_id, kind (in / out), at (server time), method (qr / web / manual), site_id, correction_id — append-only |
| `attendance_code_uses` | tenant_id, membership_id, site_id, window — unique (replay protection) |
| `attendance_corrections` | tenant_id, id, membership_id, date, kind, time, reason, status (pending / approved / rejected), decided_by, decided_at, note |

## 4. Permissions
| Permission | Owner | CEO | Manager | Team Lead | Employee | HR & payroll |
|---|---|---|---|---|---|---|
| attendance.check (my own check-ins, corrections) | own | own | own | own | own | own |
| attendance.read | company | company | team | team | own | company |
| attendance.correction.approve | company | company | team | team | — | company |
| attendance.manage (settings, sites, shifts, kiosk) | company | company | — | — | — | company |
Nobody approves their own correction (API + database).

## 5. API
`GET/PATCH /attendance/settings`, `GET/POST/PATCH /attendance/sites`, `GET /attendance/sites/:id/code` (kiosk: current code + seconds left), `GET/POST/PATCH /attendance/shifts`, `PUT /attendance/assignments/:membershipId`, `POST /attendance/check` `{ code? }` (QR or web), `GET /attendance/me` (today's events + next action), `GET /attendance/summary?from&to&membershipId`, `GET /attendance/today` (board), `GET/POST /attendance/corrections`, `POST /attendance/corrections/:id/{approve,reject}`. Dashboard: `attendance { inNow, lateToday }`.

## 6. Acceptance criteria
1. A kiosk code checks a person in; the same code again (same person, same window) is refused; a code two windows old or forged is refused; without signing in nothing works.
2. Check-in / out alternate automatically; two events within a minute are refused.
3. Web check-in works only when the company allows it.
4. Shift 08:00–16:00, grace 10 min, break 60 min: in 08:25, out 15:30 → late 25, early 30, worked 6 h 5 min; a working day with nothing (no leave, no holiday) is "absent"; approved leave days show "leave".
5. Correction request → team lead approves → manual event appears and the day is recomputed; own correction can't be approved; rejection keeps the note.
6. Team lead sees their team on "today"; employees only themselves; another company 404.

## 7. Test plan
API integration for each criterion (time-dependent cases use events inserted at fixed past times), signature unit tests; journey EN + AR: Owner opens the kiosk, the colleague checks in with the code link, Owner sees them "in" on the board; axe on new screens.

## 8. Decisions taken by Claude (nonstop mode, reviewable)
- 30-second rotation, current + previous window accepted (covers scanning at the boundary); codes are signed with a key derived from the server secret, never stored.
- No GPS: presence comes from the kiosk at the office; IP addresses are not stored (data minimisation).
- Web check-in is allowed by default (setting) because firms work at client sites; companies that need proof of presence switch it off.
- People without a shift are recorded but never "late" or "early"; absence still uses their working days.
- No offline mode; corrections cover outages.
- Settings are stored in a general `company_settings` table (key `attendance`), which payroll rules will reuse.

## 9. Results (2026-10-30)
- **API**: `apps/api/test/attendance.spec.ts` — 5 tests passing against real Postgres + Mailpit: kiosk code (only managers can display it) checks a person in by QR at the site; the same code again → 409 `code_used`; a tampered code and a code two windows old → `invalid_or_expired`; a code signed for one company never verifies for another; not signed in → 401; web check-in and out alternate, a double tap within a minute → `too_soon`, web off → `qr_required`, only managers change settings; a shift day 08:25–15:30 against 08:00–16:00 / 10 grace / 60 break → late 25, early 30, worked 365 min; empty working day absent; approved leave day "leave"; Friday a day off; summaries respect team scope; correction → team lead approves → manual event, day recomputed, second decision 409, future correction refused, own correction 403, reject needs a note, **the database refuses a self-decision and the app can't delete events**; today board shows the lead's team, employees only themselves; dashboard "in now".
- **Web**: Attendance — My attendance (today's events, check in/out, two-week table with late/early/worked vs logged, correction requests), Today board, Corrections to review, Setup (web check-in setting with the offline/dispute policy, sites with "Open kiosk", shifts, shift assignment); kiosk page (full-screen rotating QR image, refreshes as each code expires); scan page (one tap records). Sidebar, palette, dashboard card, notifications. EN + AR.
- **Not yet:** location verification (decided not needed), monthly payroll export (Phase 11 reads the summary), mobile app (Phase 16).
