# Production readiness assessment (Phase 15d, 2026-10-31)

Each item the product brief requires for Phase 15 (§18), with its evidence. Details: `hardening.md`, `operations.md`, `performance.md`, `security.md` §2c–2d, `testing.md`.

| Brief item | Status | Evidence |
|---|---|---|
| Regression testing | ✅ | `pnpm check`: 426 automated tests (API 302 against real PostgreSQL, Mailpit, RustFS, ClamAV; database 39; contracts 36; web 23; UI 16; i18n 10); browser journey EN + AR covering every module (`pnpm e2e:journey`) |
| Security review | ✅ internal | `security.md` §2c (15b findings, all fixed) and §2d (R1–R15 with evidence); external penetration test still recommended |
| Tenant-isolation testing | ✅ | Catalogue guard + cross-tenant suite (`isolation.spec.ts`), per-module cross-tenant cases, Host-only company resolution behind proxies, isolation intact after restore |
| Dependency vulnerability checks | ✅ | `pnpm security` in CI: no high/critical (1 moderate, reviewed in §2b), licence allow-list (all production packages), third-party notices current, secret scan |
| Performance testing | ✅ with recorded targets | `pnpm perf` at 2 million time entries: screens/lists/writes 34–270 ms p95, dashboard 482 ms, full-year reports ≤ 1.75 s (`performance.md`) |
| Accessibility testing | ✅ | axe (WCAG 2.2 AA) on every screen of the journey in EN and AR, components in EN/AR × light/dark (`gallery.spec.ts`); keyboard and focus checks in the gallery |
| Backup and restore verification | ✅ | Automated restore drill (`backup.spec.ts`), manual drill on development data, backup inside the server image (deploy test) |
| Deployment validation | ✅ | `pnpm deploy:verify` in CI: production images + compose behind HTTPS, headers, full journey, client addresses, backup |
| Monitoring verification | ✅ | Health checks, redacted logs, slow-request warnings, error reports (`monitoring.spec.ts`), traces (`telemetry.spec.ts`) |
| Documentation review | ✅ for operations | README, `operations.md` (backups, restore, deployment, monitoring, incidents), `prod.env.example`, `security.md`, `performance.md` updated; module specs updated at each phase hand-over |
| Production readiness assessment | ✅ | This document |

## Verdict
**Technically ready for a staging installation and a supervised pilot** with synthetic or consenting data. **Not yet for paying customers** until the owner items below are done — in particular the legal items, payroll and leave rule verification (payroll is still marked test-only), and an external penetration test.

## Owner go-live checklist
- [ ] Cloud account and region (or the customer's server) — Kuwait data-residency question answered with counsel
- [ ] Platform domain, wildcard DNS and TLS certificates (`*.<domain>` and the files host)
- [ ] SMTP provider (SPF/DKIM/DMARC for the sender domain)
- [ ] Secrets generated and stored in a vault, separately from backups: `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY` (`prod.env.example`)
- [ ] Off-site backup storage; nightly backup scheduled; first restore drill on the real environment (`operations.md` §2–4)
- [ ] Monitoring: error reports (`SENTRY_DSN`), log collection, alerts (`operations.md` §6); optional traces
- [ ] `pnpm deploy:verify` green in CI (needs the GitHub remote) and `pnpm perf` re-run on the production hardware
- [ ] Legal (compliance.md ⚖️): privacy notice and terms, data-processing agreement for customers, breach-notification duty confirmed, trademark search
- [ ] Payroll and leave rules verified by a Kuwaiti payroll/legal expert; then remove the "test only" flag
- [ ] External penetration test; fix any high findings
- [ ] Decide HSTS preload for the platform domain

## Addendum 2026-11-01 — mobile app (Phase 16)
The Expo app (`apps/mobile`) is built and verified in the browser preview and through the API suite, but **not yet built for the stores**: that needs the owner's Expo account plus Apple Developer / Google Play accounts (`operations.md` §8). Until then the web app on a phone browser remains the mobile surface. The server change for the app (header session transport, `security.md` §2e) is live and tested; it does not affect browser users.
