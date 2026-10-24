# Design System

Status: **Direction v0.2 approved by owner (2026-10-24).** Tokens and components are implemented in Milestone 1.4 (`packages/ui`).
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
| ink / ink-2 / ink-3 | #17141b / #5b5764 / #9893a1 | #f3f0f6 / #b4aebd / #7d7786 | text levels |
| plum | #3b1f3e | #e4c9ea | active nav, primary button, today |
| mint (bg / ink / solid) | #e2f5e9 / #1d7a46 / #34b46c | #12291c / #6fd69a / #34b46c | positive, collected, check-in |
| blush | #fde7ea / #b52f49 / #ea5f78 | #31181e / #f59aab / #ea5f78 | outstanding, alerts, check-out |
| lilac | #ede9fc / #5a45c2 / #8c78ee | #221d3a / #b6a8ff / #8c78ee | invoiced, filters, utilization |
| butter | #fdf2d2 / #8a6100 / #f0b93a | #2e2510 / #f2c14e / #f0b93a | leave, near-limit |
| sky | #e2eefd / #1d62b6 / #4f97ec | #13223a / #8cc0ff / #4f97ec | timesheets, planned |
| status good / warn / bad | #1f9d55 / #d99a0b / #d63c4f | #3ccb78 / #f2b632 / #f06a7c | always with icon + label |

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
