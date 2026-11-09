# Design System

Status: **Direction v0.2 approved by owner (2026-10-24); v0.3 motion & audit rules added 2026-10-31 at the owner's request (§5–§6). Implemented in Milestone 1.4a** (`packages/ui`, gallery at http://localhost:5173/gallery). **v0.4 "liquid glass" adopted 2026-11-08 at the owner's request (§7) — it supersedes the v0.3 ban on glass and the boxed app frame.**
Live reference: https://claude.ai/artifact/Ffk4Wtd2i9PGtVEK6FHA8H (private to the owner).

v0.1 ("calm precision", neutral slate + teal) was rejected as too generic. v0.2 follows the owner's reference shots: vibrant, friendly, card-based.

## 1. Direction: soft cards, bold numbers, people first

- The app sits in a **rounded frame** on a soft grey ground. Content lives on white cards with large radii.
- **Pastel widget tiles** (mint, blush, lilac, butter, sky) group information and give each area a recognizable color.
- **Deep plum** marks "where you are" (active nav, today's date) and the main action on a screen. One plum action per area.
- **Heavy numbers**: KPIs and money in extra-bold, tabular figures, KWD with three decimals.
- **People everywhere**: avatars (uploaded photos in the product, gradient initials as fallback), check-in/out in the sidebar profile card, approvals with faces.
- **Expressive greeting**: an italic serif display face for the user's name only. Never for body text or data.
- **Friendly motion**: tiles lift on hover, approved items slide away, rings and bars ease in. Respects `prefers-reduced-motion`; financial figures never animate.
- Light and dark themes; English (LTR) and Arabic (RTL).

## 2. Tokens

### Color (light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| ground | #e7e9ef | #08070a | behind the app frame |
| frame | #f5f6f9 | #111014 | app canvas |
| card | #ffffff | #19171d | cards, inputs |
| line / line-2 | #eceef3 / #e1e4ea | #25222a / #2e2a34 | borders |
| ink / ink-2 / ink-3 | #17141b / #5b5764 / #68636f (was #9893a1; darkened for WCAG AA 4.5:1) | #f3f0f6 / #b4aebd / #948e9e | text levels |
| plum | #3b1f3e | #e4c9ea | active nav, primary button, today |
| mint (bg / ink / solid) | #e2f5e9 / #1d7a46 / #34b46c | #12291c / #6fd69a / #34b46c | positive, collected, check-in |
| blush | #fde7ea / #b52f49 / #ea5f78 | #31181e / #f59aab / #ea5f78 | outstanding, alerts, check-out |
| lilac | #ede9fc / #5a45c2 / #8c78ee | #221d3a / #b6a8ff / #8c78ee | invoiced, filters, utilization |
| butter | #fdf2d2 / #7a5600 (was #8a6100, contrast) / #f0b93a | #2e2510 / #f2c14e / #f0b93a | leave, near-limit |
| sky | #e2eefd / #1d62b6 / #4f97ec | #13223a / #8cc0ff / #4f97ec | timesheets, planned |
| status good / warn / bad | #1f9d55 / #b47e00 (was #d99a0b, contrast) / #d63c4f | #3ccb78 / #f2b632 / #f06a7c | always with icon + label |

Chart series (validated for color-blind separation with the dataviz palette validator): collected #1baf7a / #199e70, invoiced #7b5cd6 / #9178ea. Collected sits below 3:1 contrast on white, so charts always carry a legend and tooltips.

### Typography

| Role | English | Arabic |
|---|---|---|
| UI and body | Plus Jakarta Sans 400–800 | Readex Pro 300–700 |
| Display (greeting name only) | Instrument Serif italic | Amiri bold |

All four are SIL Open Font License and are **self-hosted** in the product (no Google Fonts dependency, so on-prem installs work offline).

### Shape and spacing

- Radius: frame 30, card 20, tile 16, control 12, pills full.
- Spacing on a 4px base; card padding 20; grid gap 18.
- Elevation: cards flat with hairline border; popovers and hovered tiles get a soft tinted shadow.
- Icons: Lucide (ISC license), 18px, stroke 1.8; directional icons mirror in RTL.

## 3. Components (Milestone 1.4 scope)

App frame, sidebar (logo, tenant, profile + check-in/out card, grouped nav with badges, locked items for restricted modules), top bar (search with Ctrl K, messages, notifications, user menu), greeting header, mini stat cards with delta chips, card with header action, pastel money tiles, quick-action tiles, ring chart, smooth area/line chart with crosshair tooltip, pill-column chart, progress bars with status color, status chips, filter chips, approval rows, mini calendar with event dots, event tiles, buttons (primary plum, ghost), inputs, selects, searchable combobox, date picker, money input (KWD, 3 decimals), dialogs, drawers, toasts, tables, empty/error/permission-denied states, skeleton loaders.

## 4. Rules for every module

- Use `packages/ui` only; new patterns are added there first.
- Every page has loading (skeleton), empty, error (with reference ID and retry) and permission-denied states.
- Pastel colors identify areas and data; status colors (good/warn/bad) only for state, never alone.
- One plum primary action per area.
- Lists: search, filters, sort, column control, pagination; state kept in the URL.
- Destructive or financial actions require a confirmation that states the consequence.
- Keyboard reachable, visible focus, WCAG 2.2 AA contrast for text in both themes.
- No stock photos or third-party illustrations without a commercial license on file.

## 5. Motion & finish (v0.3, 2026-10-31)

The owner asked for a livelier, more polished app ("animations, glossy, charts that appear") and, in the same breath, for an audit of whether the result looks AI-generated or professional. v0.3 answers both: **motion that explains, not motion that decorates.**

Kept (in `packages/ui/src/styles/motion.css`):
- **Arrivals**: cards rise 8px and fade in once (320ms); lists and number rows stagger by 60ms.
- **Charts draw**: bars grow from the baseline, lines draw left-to-right (right-to-left in Arabic), meters fill; then a small annotation pops in over the peak — "Best month · Oct · KWD 70.000" — computed from the data (`highlight` prop), never invented.
- **Feedback**: toasts spring in; the primary button presses down; skeletons shimmer; linked tiles lift 2px on hover/focus.
- **Finish**: cards carry a faint top highlight and a crisp 1px top edge (light from above), not a gradient wash.

Rejected after audit (they read as "AI template", see §6): animated gradient-mesh ("aurora") backgrounds, frosted glass panels, pointer-following glow, light sweeps across buttons, floating illustrations with sparkles, pulsing "live" dots, any looping motion on work screens.

Rules: every animation is short and runs once; content is fully visible without it (keyframes animate *from* hidden); `prefers-reduced-motion` turns it all off; money values never count up or move; hover effects only on things you can click.

## 6. Design audit — avoiding the "AI-generated" look (2026-10-31)

Signals that make an interface read as generated, and what we do instead:

| Tell | Instead |
|---|---|
| Many identical cards, each with the same two coloured tiles, most showing 0 | One "Needs your attention" list with only non-zero items; at most 4 key numbers in a full row |
| Colour used for decoration (every tile a different pastel) | Colour carries meaning: blush = overdue/late, butter = waiting on you, lilac = information; numbers stay neutral |
| Card header link repeating the card title ("Projects … Projects") | The whole row or number is the link |
| Gradient blobs, glass, glow, sparkles, pulsing dots | Flat surfaces, one light source, real data annotations |
| Flat list of 17 navigation links | Grouped navigation: Main, Work, People, Finance |
| Vague labels ("Active", "Your company is ready") and stale copy | Specific labels ("Active projects"), sentences that state a fact ("2 invoices are overdue") |
| Charts with no story | Title states the period; description states the totals; one annotation marks the peak |

Every new screen is checked against this table before hand-over.

## 7. v0.4 — Liquid glass (owner decision 2026-11-08)

The owner found v0.3 "plain, nothing special" and asked for an iOS-style, glassy look that fills the screen, sharing reference shots (pastel tile dashboards, frosted panels, pill-column charts). This reverses the §5–§6 rejection of glass; the rest of §6 (colour with meaning, no zero-filled cards, specific labels, charts with a story) still applies.

- **Wallpaper**: a soft pastel mesh (lilac, peach, mint, sky radial gradients) fixed behind the app; a deep plum/indigo mesh in dark mode (`--wallpaper`).
- **Glass surfaces** (`.ui-glass`): `--card` is translucent (white 66 % / dark 62 %), blurred 22 px with 170 % saturation, a light 1 px edge and a two-sided inner highlight ("liquid edge", technique from the 21st.dev Liquid Glass Card, without its Chromium-only SVG displacement filter). Popovers, menus, dialogs, drawers and chart tooltips use `.ui-glass-pop` (90 % opaque) so text over content stays readable. `prefers-reduced-transparency` turns glass into solid surfaces.
- **Layout**: the app fills the window — no boxed frame. The sidebar is a floating glass panel (sticky, full height); the active item is a plum pill with a soft shadow. Search, icon buttons and the language/theme toggles are glass pills in the top bar.
- **Shape**: card radius 26, tile 20, pills fully round.
- **Dashboard**: a greeting with the person's name in the display face and today's date; key numbers as pastel-washed glass tiles with a solid icon chip (area colour: butter money, mint projects/attendance, sky clients/time, lilac tasks/people) and one hint line; charts use pill columns inside hatched capsule tracks, the best period's track tinted lilac; my week as seven capsule columns (today in plum).
- **Contrast**: surfaces stay ≥ 62 % opaque so ink / ink-2 / ink-3 keep WCAG AA; checked with axe in light and dark before each hand-over.

## 8. Workspace pages (2026-11-08)

The owner found module pages "plain, like quickly generated CRUD". Every list page now follows one composition: **overview → filters → records**, using the workspace kit in `packages/ui/src/components/workspace.tsx`:

- `ViewToggle` + `useViewMode` (cards / table, remembered per list in the browser), `CardGrid`, `EntityCard` (glass card, coloured top accent = status or priority, header / body / footer, lifts on hover and keyboard focus — the whole card is one link).
- `AvatarStack`, `Progress` (toned good / warn / bad; `budgetTone`: ≤ 80 % good, ≤ 100 % warn, above bad), `DistributionBar` (one bar split into parts, the legend carries the numbers and can filter), `Ring` (gauge with centre text), `SectionTitle`.
- `Wizard`: numbered steps (done ✓ / current / upcoming), progress line, step slides in from the reading direction, live summary column, Back / Next, per-step validation shown after a Next attempt, review step last. Used for contracts and engagement letters; use it for any creation with more than ~8 fields in logical groups — not for short forms.
- Money totals shown on a page are added exactly (`sumMoney` in `packages/contracts/src/money.ts`); floats only size marks.
- Applied to: Invoices (KPIs, revenue trend, aging, cards), Clients (cards), Tasks (cards, board), Time approvals (per-person panels, floating selection bar), Leave (overview, rings, team availability grid), Reports (analytics landing), Contracts (creation wizard).
