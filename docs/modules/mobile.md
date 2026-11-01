# Module spec: Mobile app (Phase 16)

Status: **Built 2026-11-01** (nonstop mode; Claude's decisions in §9, results in §10).

## 1. Purpose and fit
A React Native (Expo) app for the people who are *not at a desk*: check in by scanning the office QR code, see what needs them (notifications, tasks due), log hours and run the timer, apply for leave and see balances, approve the team's leave and attendance corrections. It is a second client of the **same API, identity, permissions and contracts** as the web app (brief §18 Phase 16: "reuse the backend and shared contracts rather than creating a separate implementation of business rules"). No business rule lives in the app: it shows what the server returns (`actions`, `nextStatuses`, `canSubmit`, balances) and sends the same requests the web sends.

## 2. Brief coverage (Phase 16 + "future mobile compatibility")
| Required | Phase 16 |
|---|---|
| Reuse backend, auth model, authorization, API contracts, validation, business logic | ✅ the app calls `/api/v1` with the Zod contracts from `packages/contracts`; the server decides every permission; the only server change is a **cookie-less session transport** (§4) that reuses the existing sessions |
| Do not assume React components can be reused | ✅ `apps/mobile` has its own native components; it shares only `packages/contracts` (shapes) and `packages/i18n` (texts, formatting) |
| Mobile UX for attendance | ✅ scan the kiosk QR with the camera → one tap records in/out; web check-in button when the company allows it; today's events, shift, two-week history |
| Notifications | ✅ list with unread marks, mark read / all read, deep links into the app's own screens (tasks, leave, time, attendance); push notifications deferred (§9) |
| Tasks | ✅ my open tasks, detail, status change among `nextStatuses`, comments |
| Leave | ✅ balances, my requests, apply with live preview (days, balance after, problems), withdraw; approvals for team leads / managers |
| Time | ✅ this week's timesheet, add an entry on an assigned task, start/stop the timer, submit the week |
| Other appropriate workflows | ✅ approvals (leave, attendance corrections); announcements appear as notifications |
| EN/AR with RTL | ✅ same catalogs as the web (`ui.*`), RTL layout through React Native's `I18nManager` + logical spacing only |
| Security | ✅ session state in the device's secure store (Keychain / Keystore), never in plain storage; company chosen through the same one-time hand-off ticket; sensitive roles still need the authenticator code; no company ID from the client (hosts) |

## 3. Architecture
```
phone ──HTTPS──▶ main host  https://erp.example/api/v1   sign-in, two-factor, companies, hand-off ticket
      ──HTTPS──▶ company    https://acme.erp.example/api/v1  everything else (company by Host, as on the web)
```
- **Transport.** Browsers hold cookies; the app cannot rely on a cookie jar (platform differences, `__Secure-` prefixes, two cookies during two-factor). So the API gains one generic mechanism: a request carrying the header **`X-Auth-State`** declares "I keep my own auth state". The server then (1) treats the header's content as the cookies for that request and (2) returns every cookie it *would* have set in a new `X-Auth-State` response header instead of `Set-Cookie`. The state is an opaque base64url JSON map of cookie name → value; cookies are already HMAC-signed by Better Auth, so a tampered state is simply an invalid session. The app stores one state per host (main, company) in the secure store.
- **CSRF.** Browsers never attach `X-Auth-State` on their own (a custom header needs CORS approval), so a request with it carries no ambient credential and the Origin check does not apply to it. Cookie requests keep the existing Origin check unchanged.
- **Company.** `GET /auth/companies` → `POST /auth/handoff` (ticket, 60 s, single use) → `POST /auth/handoff/redeem` on the company host with an empty state → a company session state. Same as the web's redirect, without the browser.
- **Data.** TanStack Query per screen; responses parsed with the contracts' schemas (an unexpected shape is an error, not a crash into undefined).
- **i18n.** `@ultimate-erp/i18n` `translate()` with the person's saved language (account `locale` after sign-in, device language before); RTL through `I18nManager.forceRTL` (native) / `document.dir` (web).

## 4. API change (the only server work)
- `X-Auth-State` request/response header (`packages/contracts` `AUTH_STATE_HEADER`), middleware `platform/request-context/header-session.middleware.ts`, registered before the Origin check; the Origin check skips header-state requests; CORS exposes the header.
- Validation: at most 8 KB, base64url JSON object, cookie names `[A-Za-z0-9_.-]`, values printable ASCII without `;` — otherwise 400 `BAD_REQUEST`.
- No change to sessions, lifetimes (30 min idle / 12 h absolute), rate limits, two-factor, hand-off or audit: they all run on the same code path.

## 5. Screens (apps/mobile)
Sign in → (two-factor: authenticator code or backup code) → Companies → tabs: **Home** (today's attendance with check in/out, timer, tasks due, unread count, leave balance), **Attendance** (scan, history, correction request), **Tasks** (my open tasks → detail → status / comments), **Time** (week, add entry, submit), **Leave** (balances, requests, apply, approvals), **Notifications**, **Account** (language, sign out, switch company). Every screen has loading / empty / error (with the request reference) / denied states.

## 6. Permissions
Nothing new. The app hides what the person cannot do (`/access/me`) for a clean screen; the server enforces everything. Approvals appear only with `leave.request.approve` / `attendance.correction.approve` at any scope.

## 7. Acceptance criteria
1. Sign-in with `X-Auth-State` returns the state in the header and **no** `Set-Cookie`; the state authenticates `/auth/me`; without it → 401; a tampered state → 401; a malformed header → 400.
2. Two-factor sign-in works entirely through the header (pending state → code → signed-in state).
3. Hand-off through the header: companies → ticket → redeem on the company host → `/access/me` on that host; the ticket cannot be used twice.
4. Sign-out through the header clears the session (state no longer contains it; `/auth/me` → 401).
5. A POST with a foreign `Origin` is still refused with cookies, and accepted with `X-Auth-State` (no ambient credential).
6. Cookie clients are unaffected (whole existing suite green).
7. The app's pure logic (state codec, API client with schema checks and error mapping, per-host state store, QR link parsing) is unit-tested; the app typechecks and bundles for web; a browser smoke on Expo web signs in against the real dev API.

## 8. Test plan
API integration `apps/api/test/mobile-session.spec.ts` (criteria 1–5); `pnpm check` (6); `apps/mobile` Vitest for `auth-state`, `api`, `scan-link`, `session-store` (7); `expo export --platform web` in the build; Playwright smoke `apps/web/e2e/mobile-web.spec.ts` against `expo start --web` (7) when a dev stack is running.

## 9. Decisions taken by Claude (nonstop mode, reviewable)
- **Expo SDK 58** (React Native 0.88, React 19.3) with React Navigation (stack + tabs) — the standard, best-documented stack; Expo Router not used (deep links are a small linking table instead; fewer moving parts).
- **Header-held auth state** instead of a new token system: no new tables, lifetimes or revocation paths to secure; one mechanism for session, two-factor-pending and trusted-device cookies.
- **Push notifications deferred**: they need an Expo/APNs/FCM account and credentials (owner action); the app shows in-app notifications and refreshes the unread count on focus.
- **No offline mode** (as attendance policy already says): the app needs a connection; failures show the request reference.
- **Camera**: `expo-camera` barcode scanning, QR only; the code is taken from the kiosk link (`/attendance/scan?code=…`) so the same QR serves web and app.
- **Web target kept** (`react-native-web`) so the app can be exercised in a browser in CI and by the owner without a phone; it is not a product surface.
- Native builds (`eas build`) and store submission are the owner's steps (Expo account, Apple/Google developer accounts) — documented in `docs/operations.md` §8.

## 10. Results (2026-11-01)
- **API**: `apps/api/test/mobile-session.spec.ts` — 4 tests against real Postgres + Mailpit: header sign-in returns the state and no `Set-Cookie`, the state authenticates `/auth/me`, no state → 401, tampered state → 401, malformed header → 400, sign-out empties the state; two-factor entirely through the header (pending state → code → signed in); companies → hand-off ticket → redeem on the company host → `/access/me` there, ticket single-use; a POST with a foreign Origin is refused with cookies and accepted with the header. Middleware unit tests (4): codec round-trip, empty jar, malformed inputs, Set-Cookie semantics (Max-Age=0 / past Expires remove). Whole API suite green (310).
- **App**: `apps/mobile` — sign-in (with server address), two-factor (authenticator / backup code, trust device), companies (hand-off), tabs Home / Attendance / Tasks / Time / Leave, stack screens Scan (camera on devices, code field in the browser preview), Correction, Task detail (status moves, timer, comments), Leave apply (live preview), Notifications (shared sentences, deep links), Account (language with RTL, switch company, sign out). Loading / empty / error (with reference) / denied states on every screen; EN + AR. Unit tests (13) for the API client, session store, scan-link and deep-link parsing, dates. Web export bundles (2,698 modules, ~15 s).
- **Browser journey** (`pnpm e2e:mobile`, EN + AR, ~30 s each): account and company created through the API with the header transport → the app signs in → two-factor → chooses the company → Home shows the person, the company (Arabic name in Arabic) and "not checked in" → web check-in → "In since …" → Attendance lists the event → Tasks empty state → Leave balances with "Apply" → Notifications → Account → sign out → a reload stays signed out.
- **Not yet:** push notifications, native builds / store submission (owner accounts), offline mode (by policy none), time approvals in the app (web only; the Home list points to the Time tab), expense claims in the app.
