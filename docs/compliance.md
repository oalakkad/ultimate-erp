# Compliance Register

Status: **Draft — Phase 0.** This is an engineering register, **not legal advice and not a compliance claim.** Items marked ⚖️ require review by qualified Kuwaiti legal/compliance professionals before commercial launch.

## 1. Frameworks (engineering targets)

| Framework | Use | Status |
|---|---|---|
| ISO/IEC 27001 / 27002 | Control design reference; organizational ISMS needed for certification (out of code scope) | Not started |
| ISO/IEC 27701 | Privacy controls reference | Not started |
| OWASP ASVS 5.0 (L2, L3 for auth/finance) | Verification checklist per module | Not started |
| OWASP Top 10 | Risk baseline (see `security.md`) | Mapped in Phase 0 |
| WCAG 2.2 AA | Accessibility target, both LTR and RTL | Not started |

## 2. Kuwait — areas identified

| Area | What we know | Product impact | Status |
|---|---|---|---|
| Data privacy — CITRA Data Privacy Protection Regulation (Resolution No. 26 of 2024, replacing No. 42 of 2021) | Per law-firm summaries: applies to CITRA-licensed telecom/IT service providers processing personal data; requires explicit consent, terms in Arabic and English, user ability to modify/delete data, breach notification to CITRA within 24h. | Bilingual privacy notice + consent capture, data subject request tooling, breach runbook. ⚖️ Confirm whether *we* (SaaS provider) fall under CITRA licensing/scope. | ⚖️ To review |
| Cloud / data classification — CITRA cloud regulatory framework | Data classification may restrict where certain data can be hosted. | Supports on-prem + region-pinned hosting. ⚖️ Confirm applicability. | ⚖️ To review |
| Regulated clients (banks etc.) — Central Bank of Kuwait outsourcing/cloud rules | Audit firms serving banks may be contractually required to keep data on-prem/in-country. | On-prem profile (ADR-0007). | Designed for |
| Labour — Private Sector Labour Law No. 6 of 2010 (as amended) | Governs leave entitlements, working hours, overtime, end-of-service indemnity. | Leave/attendance/payroll rules configurable & versioned; **no formulas implemented without verified rules.** | ⚖️ Required before Phase 9/11 |
| Social security — PIFSS | Contributions for Kuwaiti nationals. | Payroll deduction rules (Phase 11). | ⚖️ Required before Phase 11 |
| Wage Protection System | Salary payment file requirements via banks/MoSAL/PAM. | Payroll export format (Phase 11). | ⚖️ To research |
| Electronic transactions — Law No. 20 of 2014 | Legal recognition of electronic signatures under conditions. | Contracts module integrates a proper e-signature provider; uploaded scans are not labelled "verified signature". | ⚖️ To review (Phase 4) |
| Tax / VAT / e-invoicing | Kuwait has not implemented GCC VAT as of last check; corporate tax regime has been changing (incl. multinational top-up tax). | Tax engine configurable per tenant, default no VAT; re-check before Phase 12. | ⚖️ Re-verify before Phase 12 |
| Record retention | Commercial, tax and labour record retention periods. | Retention policies per record type; no hard deletes of financial records. | ⚖️ To review |

## 3. Intellectual property and licensing

| Item | Status | Action |
|---|---|---|
| UI design v0.2 | Original work, inspired by general dashboard trends; no third-party code, images, logos or names copied. | Keep it that way: no copying of specific screens, illustrations or photos. |
| Fonts (Plus Jakarta Sans, Readex Pro, Instrument Serif, Amiri) | SIL Open Font License 1.1, commercial use allowed. | Ship license texts in `THIRD_PARTY_NOTICES`; don't sell fonts standalone. |
| Icons (Lucide) | ISC license, commercial use allowed. | Include license notice. |
| npm dependencies | Production dependencies: MIT, ISC, BSD, Apache-2.0, 0BSD only (123 packages, checked 2026-10-24). | **Implemented:** `scripts/check-licenses.mjs` in CI blocks any licence outside the allow-list; copyleft needs a documented review. |
| Product name "Ultimate ERP" | Not checked. | ⚖️ Trademark search (Kuwait MOCI + WIPO) before launch; register if clear. |
| Customer contract / terms of service | Not drafted. | ⚖️ Lawyer before first paying customer. |

## 4. Evidence register

Populated per module as controls are implemented: control → implementation (file/commit) → test → status (implemented / partial / outstanding).

References: ASVS = OWASP ASVS 5.0 chapter; ISO = ISO/IEC 27002:2022 control. Mapping is indicative, for engineering traceability only.

| Control | Ref | Implementation | Evidence (test / check) | Status |
|---|---|---|---|---|
| Configuration validated at startup; app refuses to boot when invalid; values never printed | ASVS V13, ISO 8.9 | `apps/api/src/platform/config/config.ts` | `config.spec.ts` (9 cases incl. "never includes values") | Implemented 1.1 |
| Secrets kept out of source control | ASVS V13, ISO 8.4 | `.gitignore` (.env), `.env.example` placeholders only, gitleaks | CI `security` job: `pnpm secrets:scan`; detection verified with a planted token | Implemented 1.1 |
| Sensitive data excluded from logs | ASVS V16, ISO 8.15 / 8.11 | `logger-options.ts` redaction list | `logger-options.spec.ts` (headers, top-level, nested) | Implemented 1.1 (list grows per module) |
| Uniform error responses, no stack traces / internals | ASVS V16, ISO 8.28 | `to-error-response.ts`, `GlobalExceptionFilter` | `to-error-response.spec.ts`, `http.spec.ts` | Implemented 1.1 |
| Correlation ID on every request and log line | ASVS V16, ISO 8.15 | `request-id.middleware.ts`, nestjs-pino | `http.spec.ts` (unique IDs, untrusted header ignored, unsafe header replaced) | Implemented 1.1 |
| Security headers (CSP none, frame-ancestors none, HSTS, nosniff) | ASVS V3, ISO 8.26 | Helmet in `bootstrap.ts` | `http.spec.ts` | Implemented 1.1 |
| Strict CORS allow-list | ASVS V3, ISO 8.26 | `CORS_ORIGINS` config | `http.spec.ts` (allowed vs denied origin) | Implemented 1.1 |
| Request body size limit; malformed input rejected | ASVS V2/V4, ISO 8.28 | `json-body.middleware.ts` | `http.spec.ts` (413, MALFORMED_JSON) | Implemented 1.1 |
| Health checks without information disclosure | ASVS V13, ISO 8.16 | `/health`, `/health/live` | `http.spec.ts`, `health.db.spec.ts` (real Postgres, DB down) | Implemented 1.1 |
| Dependency vulnerability gate | ASVS V15, ISO 8.8 | `pnpm audit:prod` in CI (fails on high/critical); multer override | CI `security` job | Implemented 1.1 |
| Licence compliance of dependencies | ISO 5.32 | `scripts/check-licenses.mjs` | CI `security` job | Implemented 1.1 |
| Pinned dependencies; install scripts blocked except allow-list | ASVS V15, ISO 8.30 | `saveExact`, `allowBuilds` in `pnpm-workspace.yaml`, lockfile | `pnpm install --frozen-lockfile` in CI | Implemented 1.1 |
| Dev services not exposed to the network | ISO 8.20 | Compose ports bound to 127.0.0.1 | Manual (`docker ps`) | Implemented 1.1 |
| Tenant isolation (RLS forced, composite FKs, `withTenant`, safe-role check, host resolution) | ASVS V8, ISO 8.3 | `packages/db/migrations/0001_foundation_security.sql`, `packages/db/src/tenant.ts`, `apps/api/src/platform/database/`, `apps/api/src/modules/tenancy/` | `packages/db/test/isolation.spec.ts` (31, incl. catalog guard; mutation-checked: weakening a policy fails 10 tests), `apps/api/test/tenancy.spec.ts` | Implemented 1.2 |
| Least-privilege database roles (separate migrator / app / platform) | ASVS V13, ISO 8.2 / 8.18 | `packages/db/src/admin.ts`, migration grants | `isolation.spec.ts` "database roles", "platform role" | Implemented 1.2 |
| Module boundaries: no circular imports, no raw DB access from modules | ISO 8.28 | `eslint.config.js` (import-x/no-cycle, no-restricted-imports) | Lint in CI (verified with planted violations) | Implemented 1.2 |
| Authentication, MFA, sessions, rate limits | ASVS V6/V7/V2, ISO 8.5 | — | Auth integration tests | Outstanding (1.3) |
| Authorization (RBAC + scopes, server-side) | ASVS V8, ISO 8.2 / 5.15 | — | Permission matrix suite | Outstanding (1.3) |
| Append-only audit log | ASVS V16, ISO 8.15 | — | Audit tests | Outstanding (1.3) |
| Error monitoring and alerting | ISO 8.16 | — | — | Outstanding (1.5) |
| Accessibility WCAG 2.2 AA | — | — | axe checks | Outstanding (1.4) |
| Backup and restore verified | ISO 8.13 | — | Restore drill | Outstanding (15) |
