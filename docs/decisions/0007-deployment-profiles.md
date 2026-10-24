# ADR-0007: SaaS and on-premises from one codebase

- Status: Proposed
- Date: 2026-10-24

## Decision
- Ship only container images + configuration. Profiles: `dev`, `saas`, `onprem`.
- Required external dependencies are limited to: PostgreSQL, S3-compatible object storage, SMTP. Everything else (queue, auth, search) runs inside our images or in Postgres.
- Optional integrations (error monitoring, e-signature, payment gateways, SSO) are pluggable and may be disabled on-prem.
- Configuration via environment variables validated at startup (app refuses to boot with invalid/missing config).
- SaaS tenancy: subdomain per tenant (`{slug}.<platform-domain>`), custom domains later with DNS TXT verification + managed TLS.
- On-prem: one tenant by default, licence/entitlement file planned (design deferred until commercial terms are known).
- Versioned migrations run as a separate step/container before the new version starts; backward-compatible migration policy so rollbacks are possible.

## Open items
- On-prem update channel and support access model (customer-controlled, audited) — to design before first on-prem customer.
- Backup/restore runbook per profile — Phase 15.
