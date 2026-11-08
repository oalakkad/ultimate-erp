# Module spec: Executive shell & dashboard (Phase 2)

Status: **Phase 2 complete — 2a (shell) and 2b (dashboard) built and committed 2026-10-29.** Nonstop mode (owner decision 2026-10-29): defaults chosen by Claude are listed in §6.

## 1. Purpose and fit
The first complete experience for a CEO / Owner (brief §18 Phase 2, Module A): one frame every module plugs into — navigation, search, notifications, profile, company switching — and a dashboard that shows **only real data** and gains cards as modules arrive.

## 2. Brief coverage (Phase 2 list)
| Required | Where | Status |
|---|---|---|
| CEO dashboard layout | `routes/dashboard.tsx`: main column + side column, cards only for permitted sections | ✅ 2b |
| Sidebar and navigation | `AppLayout`: only built modules; in-app navigation (no reloads; new-tab clicks still work) | ✅ 2a |
| Header and global search | Search box + **Ctrl K / ⌘ K command palette**: pages, actions (invite, two-factor, password, language, sign out), people; Arabic-aware matching | ✅ 2a (each module adds its records) |
| Notification center | Bell + panel | ✅ 1.5a |
| User profile and settings | My account: name, language, two-factor, **password change**, sessions | ✅ 2a |
| Company switcher | Sidebar header menu: my companies (secure hand-off) + "All my companies" | ✅ 2a |
| Dashboard cards, chart components | Getting started (meter), Team tiles; `BarChart`, `LineChart`, `Meter` in `packages/ui` (gallery shows them with labelled example data) | ✅ 2b (business cards arrive with each module) |
| Activity feed, quick actions | Recent activity from the audit log (business events only, translated); quick actions by permission | ✅ 2b |
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

### 4a. Lists added 2026-11-08 (owner feedback: the dashboard was empty for managers and employees)
The summary now also returns four lists, each present only for the roles below and scoped like its module (`packages/contracts/src/dashboard.ts`, tests `apps/api/test/dashboard.spec.ts`):

| Section | Who gets it | What it holds |
|---|---|---|
| `myTasks` | anyone who can have tasks (same as `tasks`) | my open tasks (backlog, ready, in progress, in review) — overdue first, then soonest due, no due date last; at most 5; with the project's English and Arabic names |
| `myWeek` | people who log time (same as `time`) | my hours per day of the current Sunday–Saturday week (draft, submitted and approved count; rejected entries do not — same rule as "my hours this week"), plus my contracted weekly hours from my employee record (null without one) |
| `projectHealth` | Owner/CEO and Finance: every open project. Manager: only projects they lead or are on (the dashboard is about their own work, even though they may read all projects). Team leads and employees: none | open (planned, active, on hold), not archived projects: budget hours (null when 0), approved logged hours, hours allocated on tasks that are not cancelled, end date, client names; most of the budget used first, no budget last; at most 6 |
| `away` | people who may read leave for their team (team leads, managers) or the company (Owner, CEO, HR); not employees | approved leave overlapping today … today + 7 days of the people they may see; soonest first; at most 8; name and leave type in English and Arabic |

All four run inside the same company transaction as the rest of the summary; names are looked up afterwards through the identity service, the same as the activity feed.

## 5. Tests
2a: unit (`commands.spec.ts`: matching, ordering, Arabic normalisation); browser journey EN + AR — Ctrl K → type "Members" → Enter → Members; breadcrumb back home; phone layout menu; password change; axe on palette, phone menu and My account. 2b: summary API permission and isolation tests; dashboard in the journey with axe; chart components unit-tested (accessible names, table alternative, RTL).

## 6. Decisions taken by Claude (nonstop mode, reviewable)
- Phase 2 split into 2a (shell) and 2b (dashboard).
- Global search starts as a client-side palette over pages, actions and people; a server search endpoint is added when there are searchable records (clients, Phase 3).
- Company switcher derives the main address by dropping the first label of the host (custom company domains will need a server-provided URL later).
- Shortcut label is not translated (key names); Apple devices show ⌘ K.
- Charts: own SVG components rather than a chart library (small, RTL-aware, accessible, no new dependency).

## 7. 2b — results (2026-10-29)
- **API:** `GET /api/v1/dashboard/summary` (`modules/dashboard`): `setup` (needs `access.members.invite`), `team` (`access.members.read`; pending invitations only with invite permission), `activity` (`audit.event.read`; last 8 business events, actor names only — no audit details, which can hold email addresses). Computed in the company's own transaction.
- **Charts:** `packages/ui/src/components/charts.tsx`. Series colours `--series-1…8` in tokens (validated with the dataviz validator on our card surfaces: light all checks pass with a contrast WARN for slots 3–5 → every chart ships a table view and labels; dark all pass). Columns ≤ 24 px with 4 px rounded tops and 2 px gaps; 2 px lines with ringed end-dots; hairline grid; legend for 2+ series; values at column caps (single series) or line ends (≤ 4 non-colliding series); per-column tooltip and line crosshair on hover **and keyboard** (arrow keys); "Show as table" on every chart; RTL mirrors the x order and axis side; tooltip positioned with logical CSS only. Rendered and reviewed in EN light / AR dark — fixed two clipping issues (edge x-labels, RTL end-values) found by looking.
- **Deferred:** date-range filter control — added with the first module whose card needs a period (Phase 3+), so it is built against real data rather than a placeholder.
- **Tests:** API (3: Owner sees real progress/team/activity, Employee sees no sections, other company never counted); ui charts (7: scale, labelled keyboard-reachable bars, legend rule, table view, focus tooltip, RTL mirroring, line keyboard crosshair); journey checks progress "2 of 4", the activity line, quick action → Members, axe on the dashboard; gallery axe in EN/AR × light/dark with the charts.
