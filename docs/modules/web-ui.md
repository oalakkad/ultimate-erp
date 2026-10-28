# Module spec: Web app & design system (Milestones 1.4a + 1.4b)

Status: **1.4a approved 2026-10-28. 1.4b built 2026-10-28, awaiting owner approval** (§8–§13). Owner decisions 2026-10-28: 1.4 split into 1.4a (look) and 1.4b (screens + E2E); sidebar shows only built modules; first-visit language = company default on a company address, browser language on the main address, saved user choice wins after sign-in.

## 1. Purpose and fit
The visual and interaction foundation every screen is built from, so the whole ERP looks and behaves like one premium product (brief §5) in English and Arabic (ADR-0006). 1.4a delivers the design system and a **gallery page** for the owner to review the look before any real screen is built on it (1.4b).

## 2. Brief coverage (§5 design system list)
| Required | 1.4a | Later |
|---|---|---|
| Color, typography, spacing, radii, shadows, layout, breakpoints, icon tokens | ✅ `packages/ui/src/styles/tokens.css` (values from design-system.md v0.2 / approved preview), light + dark | — |
| Buttons, inputs, selects/searchable dropdowns, cards, tabs, badges/status, dialogs, drawers, tooltips, toasts | ✅ | searchable combobox, date picker, money input → with the first module that needs them (Phase 3+) |
| Tables, pagination, filters, search, breadcrumbs | — | Phase 2–3 (first lists) |
| Empty, loading (skeleton), error (reference ID + retry), permission-denied states | ✅ | — |
| App frame, sidebar, top bar, profile card | ✅ layout components | wired to real data in 1.4b |
| EN/AR switch, full RTL, logical CSS only | ✅ (automated check bans physical properties) | — |
| Animations with reduced-motion; none on dense financial data | ✅ CSS transitions, `prefers-reduced-motion` | Motion library when a flow needs it |
| WCAG 2.2 AA | ✅ axe checks on the gallery in EN/AR × light/dark (Playwright) | every screen in 1.4b |

## 3. Architecture
- `apps/web`: React 19 + Vite 8 SPA, TanStack Router (code-based routes) + TanStack Query. No business logic; talks only to `/api/v1` through Vite's proxy (same origin, so host-only session cookies and company hosts like `acme.localhost:5173` work exactly as in production behind a reverse proxy).
- `packages/ui`: Tailwind CSS 4 with our tokens as CSS variables, Radix UI primitives for accessible behaviour (dialog, select, tabs, tooltip, toast), Lucide icons (directional ones mirror in RTL). Fonts self-hosted from `@fontsource` (SIL OFL) — no Google Fonts, works offline on-prem.
- `packages/i18n`: UI catalogs (EN reference + AR, machine-drafted, needs native review), ICU message format, number/date/money formatting (Western digits by default, KWD 3 decimals).
- Theme: system / light / dark, stored per browser; direction and language on `<html lang dir>`.

## 4. Data, dependencies, permissions
No data or API changes in 1.4a. The gallery uses clearly labelled example content (brief §3: prototype data allowed when isolated and identified). No permissions involved.

## 5. Acceptance criteria
1. The gallery renders every component in EN (LTR) and AR (RTL), light and dark, matching design-system.md v0.2.
2. Switching language flips layout direction without reload; directional icons mirror.
3. No physical CSS properties (left/right margins, paddings, positions, text-align) in `packages/ui` or `apps/web` (automated check).
4. axe reports no WCAG 2.2 A/AA violations on the gallery in all four combinations.
5. Every UI string comes from the catalogs; Arabic has every English key.
6. Keyboard: every interactive component reachable and operable, visible focus ring.

## 6. Test plan
Unit (Vitest + Testing Library, jsdom): components' accessible names/states, i18n formatting (money, dates, plurals), catalog parity, logical-CSS guard. Browser (Playwright, Chromium): gallery × {en, ar} × {light, dark} with axe; screenshots saved for owner review.

## 7. Implementation notes
- **Contrast fixes vs. the approved preview** (found by axe, WCAG 2.2 AA 4.5:1 for text): light `ink-3` #9893a1 → **#68636f** (4.8:1 on the page ground), `butter-ink` #8a6100 → #7a5600, `warn` #d99a0b → #b47e00, plus a `focus` ring colour. Dark `ink-3` #7d7786 → #948e9e (5.6:1 on dark cards).
- Lint now type-checks `.tsx` too and enforces React's rules of hooks; a test bans physical left/right CSS in `packages/ui` and `apps/web` (mutation-checked with a planted `ml-2`).
- Fonts are SIL OFL 1.1 (licence allow-list updated; licence texts must ship in THIRD_PARTY_NOTICES before release).
- Vite listens on IPv6 loopback (`::1`); browsers reach `localhost` and `<company>.localhost` automatically.

---

# Milestone 1.4b — real screens and the end-to-end journey

Owner decisions 2026-10-28: **sign in once on the main address, then a secure hand-off** to the company address (no second sign-in); **include a Members screen** (invite, roles, remove, pending invitations).

## 8. Purpose and fit
Turns the identity (1.3a) and access (1.3b) APIs into the screens people actually use on their first day: create an account, confirm the email, sign in (with two-factor), create a company, land in it, secure the account, invite colleagues, and let them join. Every later module plugs into the same app shell, guards and error handling.

## 9. Screens and flows
| Address | Screen | What it does |
|---|---|---|
| main + company | `/sign-up` | Name, email, password (12+ chars, breached-password check on the server). Goes to `/check-email`. |
| main + company | `/check-email` | "Check your email" + resend. Keeps `returnTo` so the "Back to sign in" link returns to an invitation. |
| main (link in email) | `/verify-email?token=` | Confirms the address, then offers sign-in. |
| main + company | `/sign-in` | Password step, then code step (authenticator or backup code, "trust this browser" when the role allows). Applies the account's saved language. Goes to `returnTo` (same-site paths only), else `/` on a company address or `/companies` on the main one. |
| main + company | `/forgot-password`, `/reset-password?token=` | Request link (same answer whether or not the email exists); check link, choose new password (signs out everywhere). |
| main | `/companies` | My companies (Open → hand-off) and "Create a company" (names EN/AR, web address, default language). Creating hands off straight into the new company. |
| company | `/handoff?ticket=` | Redeems the one-time ticket for a session on this address, then opens the app (ticket removed from history). |
| company | `/invitations/accept?token=` | Company, role, masked email, expiry. Signed out: sign in / create account with `returnTo`. Signed in: Accept. |
| company | `/` (app shell) | Sidebar shows **only built modules** (Dashboard; Members if `access.members.read`), My account, profile card with roles; top bar: theme, language, sign out. Dashboard is an honest empty state with "Invite colleagues". |
| company | `/members` | Members table; Invite dialog (role list limited by `canGrant`); pending invitations + revoke; change roles; remove (confirm). Buttons appear only when allowed. |
| company | `/account` | Profile + preferred language (saved to the account), two-factor (password → QR drawn locally + manual key + 10 backup codes → confirm code; turn off; new backup codes), signed-in sessions (sign out one / all others). |

Guards (in `AppLayout`): no company on this address → `/companies` or `/sign-in`; not signed in → `/sign-in?returnTo=…`; not a member → `/sign-in`; sensitive role without two-factor → `/account` with a required-notice (the server independently refuses everything else with `MFA_REQUIRED`).

## 10. Secure hand-off (how "sign in once" works)
Sessions are **host-only cookies**: a session on `localhost` is never sent to `acme.localhost` (and vice versa), so one company's address can never use another's session. To move between them:
1. On the main address the browser calls `POST /auth/handoff { tenantId }`. The server checks the user is an active member, creates a random ticket, stores only its **hash** in `handoff_tickets` (tenant-bound, RLS-protected), valid **60 seconds**, and returns `https://<company>/handoff?ticket=…`.
2. The company page calls `POST /auth/handoff/redeem { ticket }`. The server resolves the company **from the host**, atomically marks the ticket used (only if unused, unexpired and for this company), re-applies the company sign-in policy, creates a fresh session on this host and copies the original sign-in time (so the 12-hour absolute limit still counts from the real sign-in).
3. A reused, expired, or other-company ticket fails with `INVALID_TOKEN`; the page offers sign-in instead.

## 11. Data, dependencies, permissions, security
- **New API (1.4b):** `PATCH /auth/me`, `GET /auth/companies`, `POST /auth/handoff`, `POST /auth/handoff/redeem` (docs/api.md §10); table `handoff_tickets` + `sessions.authenticated_at` (migrations 0006/0007); function `app.user_companies(uuid)`.
- **Config:** `WEB_PUBLIC_URL` (web app base for email links and company addresses; falls back to `APP_PUBLIC_URL`), `PLATFORM_BASE_DOMAIN`. Origin check also accepts same-origin requests (Origin host = Host), which is how company subdomains call the API through the proxy.
- **Web libraries:** react-hook-form + Zod resolvers (the same contract schemas the API validates with), `qrcode` (QR drawn in the browser — the two-factor secret never goes to a third-party service).
- **Permissions:** the UI hides what you cannot do (`can`, `canGrant` from `@ultimate-erp/contracts`), but **only for convenience — the server checks every request**.
- **Errors:** the API sends codes only; every code has an EN and AR sentence (unit-tested), plus a short request reference for support.
- **Open redirects:** `returnTo` accepts only same-site paths and rejects `//`, backslashes, spaces and control characters (browsers drop tabs/newlines, which would otherwise turn `/\t/evil` into `//evil`). Unit-tested.

## 12. Acceptance criteria (1.4b)
1. A new person can sign up, confirm the email, sign in, create a company and arrive in it **without signing in twice**, in English and in Arabic.
2. A sensitive role (Owner, CEO, …) is taken to two-factor setup first and can complete it with an authenticator app (QR or manual key) and sees backup codes once.
3. The Owner can invite a colleague; the colleague opens the email link, creates an account, confirms the email, signs in and accepts, and lands in the company with only the screens their role allows.
4. Every screen has loading, empty and error states; errors are translated.
5. axe finds no WCAG 2.2 A/AA violations on any screen of the journey, in both languages.
6. Language choice is saved on the account when signed in.

## 13. Test plan and results
- **Unit (Vitest):** every error code translated EN/AR; `safeReturnTo` (open-redirect cases).
- **API integration:** hand-off suite in `apps/api/test/access.spec.ts` (6: happy path, single use, expiry, other company, non-member, sign-in time carried over).
- **Browser, full stack (`pnpm e2e:journey`, Playwright):** the whole journey of criteria 1–3 in EN and AR against the real API, Postgres and Mailpit (emails read from Mailpit, TOTP computed from the shown key), axe on 12 screens per language. Test emails are deleted afterwards; the test resets dev rate-limit counters (refuses non-local databases). Runs in CI (`journey` job).

## 14. Out of scope (later)
Data tables with sort/filter/pagination (Phase 2–3), charts, command palette, company settings screen, audit log screen, mobile navigation drawer polish, password change screen (API exists; screen with the account settings expansion).
