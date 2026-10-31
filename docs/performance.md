# Performance (Phase 15c)

Measured with `pnpm perf` (`apps/api/test/perf/`): one company at the architecture target (architecture.md §7b) — 500 people, 1,000 clients, 5,000 projects, 40,000 tasks, 50,000 timesheets, **2,000,000 time entries**, 10,000 invoices, 200,000 audit events — seeded through real constraints and guard triggers (4.5–5.5 min). The **built** API and worker run as separate processes against PostgreSQL 18.6 with default settings (as shipped); a closed-loop load generator sends requests as 10 people at once (reports: 3), after a warm-up. Machine: the development laptop (12 threads) with other work running, so results vary by up to 2× between runs; treat them as relative, and re-measure on production hardware before go-live.

## Targets (decided 2026-10-31, reviewable)
| Kind | p95 target |
|---|---|
| Screens and lists (reads) | < 300 ms |
| Executive dashboard (≈15 counts and sums across modules) | < 500 ms |
| Reports over a whole year (≈1 million time entries) | < 2 s |
| Writes | < 500 ms |

## Last run (2026-10-31)
| Scenario | Kind | Users | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Failures |
|---|---|---|---|---|---|---|---|---|---|
| access (every page) | read | 10 | 3130 | 391 | 25 | 34 | 43 | 71 | 0 |
| unread notifications | read | 10 | 2959 | 369 | 27 | 34 | 39 | 54 | 0 |
| dashboard | read | 10 | 190 | 23 | 418 | 482 | 503 | 551 | 0 |
| projects list | read | 10 | 1788 | 223 | 44 | 55 | 67 | 82 | 0 |
| tasks list | read | 10 | 1314 | 163 | 60 | 74 | 85 | 98 | 0 |
| workload | read | 10 | 343 | 42 | 239 | 270 | 280 | 287 | 0 |
| time approvals | read | 10 | 390 | 48 | 208 | 240 | 267 | 277 | 0 |
| time summary (year) | read | 10 | 1749 | 218 | 45 | 56 | 61 | 66 | 0 |
| clients list | read | 10 | 2708 | 338 | 29 | 37 | 45 | 54 | 0 |
| invoices list | read | 10 | 810 | 100 | 96 | 129 | 139 | 146 | 0 |
| receivables aging | read | 10 | 560 | 70 | 141 | 178 | 200 | 216 | 0 |
| revenue (year) | read | 10 | 641 | 79 | 126 | 142 | 156 | 181 | 0 |
| people list | read | 10 | 394 | 48 | 204 | 241 | 255 | 265 | 0 |
| members | read | 10 | 456 | 56 | 174 | 221 | 239 | 248 | 0 |
| audit log | read | 10 | 1570 | 195 | 50 | 66 | 75 | 96 | 0 |
| employee: my tasks | read | 10 | 954 | 119 | 83 | 98 | 108 | 124 | 0 |
| employee: my timesheet | read | 10 | 1110 | 138 | 71 | 88 | 110 | 139 | 0 |
| employee: dashboard | read | 10 | 1600 | 199 | 49 | 59 | 63 | 67 | 0 |
| report: utilization | read | 3 | 13 | 4 | 707 | 761 | 761 | 761 | 0 |
| report: timesheets | read | 3 | 13 | 2 | 1379 | 1743 | 1743 | 1743 | 0 |
| report: profitability | read | 3 | 13 | 8 | 350 | 388 | 388 | 388 | 0 |
| report: projects | read | 3 | 13 | 2 | 1276 | 1318 | 1318 | 1318 | 0 |
| report: tasks | read | 3 | 13 | 2 | 1146 | 1518 | 1518 | 1518 | 0 |
| report: revenue | read | 3 | 13 | 57 | 48 | 58 | 58 | 58 | 0 |
| report: receivables | read | 3 | 13 | 6 | 486 | 569 | 569 | 569 | 0 |
| create client | write | 5 | 100 | 135 | 27 | 85 | 148 | 255 | 0 |
| employee: log time | write | 5 | 40 | 118 | 39 | 47 | 67 | 67 | 0 |

## What the measurements found and fixed
| Problem | Before | After | Fix |
|---|---|---|---|
| Tasks report | 64 s | ~1.5 s | Counted per project in SQL instead of filtering 40,000 tasks once per project in Node |
| Utilization report | 18.7 s, 8 of 13 failed (query timeout) | ~0.8 s | Sums per person in SQL instead of 1 million rows filtered per person |
| Timesheets report | 6.2 s, 12 of 13 failed | ~1.7 s | Sums per person and project in SQL |
| Projects report | 7.8 s | ~1.3 s | Sums per project in SQL |
| Receivables aging | 1.8 s | 178 ms | Balances, buckets and per-client totals in SQL (one subquery, joins on pre-summed payments) |
| Dashboard | 1.4 s | 482 ms | Billing card in SQL; "waiting for approval" uses a new partial index (`0037`), written as a literal so the planner can use it |
| Long ID lists | — | — | `anyUuid()`: one array parameter instead of thousands; company-wide reports skip the list entirely |
| Web first load | 1.23 MB JS (344 kB gzip) | 283 kB main + per-screen chunks (234 kB gzip for the dashboard) | Route-level code splitting (`lazyRouteComponent`) |

Also found under load in 15b: a second pooled connection inside transactions (fixed then).

## Open (only if real customers need it)
- Pre-computed daily totals per person/project would bring full-year reports well under 1 s.
- The dashboard runs its counts one after another on one connection; a short per-company cache would make it ~50 ms at the cost of freshness.
- PostgreSQL tuning (`shared_buffers`, `work_mem`) for the customer's hardware.