# Module spec: Web app & design system (Milestone 1.4a)

Status: **Approved 2026-10-28 (Milestone 1.4a).** Owner decisions 2026-10-28: 1.4 split into 1.4a (look) and 1.4b (screens + E2E); sidebar shows only built modules; first-visit language = company default on a company address, browser language on the main address, saved user choice wins after sign-in.

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

## 8. Out of scope (1.4b and later)
Real screens (sign-up, sign-in, two-factor with QR, onboarding, invitations, sessions), app shell on live data, E2E journey via Mailpit, data tables, charts.
