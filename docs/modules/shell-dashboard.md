# Module spec: Executive shell & dashboard (Phase 2)

Status: **2a (shell) built and committed 2026-10-29; 2b (dashboard) next.** Nonstop mode (owner decision 2026-10-29): defaults chosen by Claude are listed in §6.

## 1. Purpose and fit
The first complete experience for a CEO / Owner (brief §18 Phase 2, Module A): one frame every module plugs into — navigation, search, notifications, profile, company switching — and a dashboard that shows **only real data** and gains cards as modules arrive.

## 2. Brief coverage (Phase 2 list)
| Required | Where | Status |
|---|---|---|
| CEO dashboard layout | 2b | ⏳ |
| Sidebar and navigation | `AppLayout`: only built modules; in-app navigation (no reloads; new-tab clicks still work) | ✅ 2a |
| Header and global search | Search box + **Ctrl K / ⌘ K command palette**: pages, actions (invite, two-factor, password, language, sign out), people; Arabic-aware matching | ✅ 2a (each module adds its records) |
| Notification center | Bell + panel | ✅ 1.5a |
| User profile and settings | My account: name, language, two-factor, **password change**, sessions | ✅ 2a |
| Company switcher | Sidebar header menu: my companies (secure hand-off) + "All my companies" | ✅ 2a |
| Dashboard cards, chart components | 2b | ⏳ |
| Activity feed, quick actions | 2b | ⏳ |
| Responsive behaviour | Phone: sidebar becomes a drawer behind a menu button (logical side: right in Arabic) | ✅ 2a |
| Loading, empty, error states | Every 2a screen | ✅ |
| Breadcrumbs (design-system §3) | `PageHeader` with "Home ›" | ✅ 2a |

## 3. 2a — what was built
- `packages/ui`: `Menu` (Radix dropdown), `PageHeader` with breadcrumbs, `Drawer side="start"`, `Dialog initialFocus`, `NavItem onClick`, `SearchBox` as a real button with `aria-keyshortcuts`.
- `apps/web`: `CommandPalette` (combobox + listbox, `aria-activedescendant`, focus stays in the field), `lib/commands.ts` (`filterCommands`, `normalize`: أ/إ/آ → ا, ى → ي, ة → ه, diacritics removed), `AppPageHeader`, company switcher, phone drawer, Ctrl K shortcut, Members `?invite=1`, account name + password cards, `useChangeLocale`, `lib/handoff.ts`.
- Security: the palette only lists what the person may do (UX only — the server checks every action); the members list in the palette loads only for people with `access.members.read`; password change re-checks the current password on the server and signs out other sessions.

## 4. 2b — dashboard plan
- **Widget registry** (`apps/web/src/dashboard/`): each module registers cards with a permission and a data hook; the dashboard shows those the person may see. Until a module exists, it has no card (no invented numbers — brief Module A).
- **Real cards now:** *Getting started* checklist from real state (company created, two-factor on, colleague invited, colleague joined); *Team* (active members, pending invitations — Owner/CEO); *Recent activity* feed from the audit log (`audit.event.read`), translated, linking to the record where one exists; *Quick actions* (invite, open palette, account).
- **API:** `GET /api/v1/dashboard/summary` — counts computed in the company's own transaction; each section present only if the caller holds its permission.
- **Charts:** reusable, accessible SVG bar / line / donut components in `packages/ui` (each with a data-table alternative and RTL support), shown in the gallery with clearly labelled example data; used by modules from Phase 3 on.
- **Filters:** date-range control (presets: this month, last 30 days, this quarter, year to date, custom) ready for module cards.

## 5. Tests
2a: unit (`commands.spec.ts`: matching, ordering, Arabic normalisation); browser journey EN + AR — Ctrl K → type "Members" → Enter → Members; breadcrumb back home; phone layout menu; password change; axe on palette, phone menu and My account. 2b: summary API permission and isolation tests; dashboard in the journey with axe; chart components unit-tested (accessible names, table alternative, RTL).

## 6. Decisions taken by Claude (nonstop mode, reviewable)
- Phase 2 split into 2a (shell) and 2b (dashboard).
- Global search starts as a client-side palette over pages, actions and people; a server search endpoint is added when there are searchable records (clients, Phase 3).
- Company switcher derives the main address by dropping the first label of the host (custom company domains will need a server-provided URL later).
- Shortcut label is not translated (key names); Apple devices show ⌘ K.
- Charts: own SVG components rather than a chart library (small, RTL-aware, accessible, no new dependency).
