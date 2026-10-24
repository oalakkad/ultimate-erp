# ADR-0001: Modular monolith in a TypeScript monorepo

- Status: Proposed
- Date: 2026-10-24

## Context
The ERP has ~15 business modules with dense cross-module workflows (client → project → task → allocation → time → invoice). It must ship as SaaS and on-premises, and later a React Native app must reuse the same rules. The team is small and learning.

## Decision
- One backend deployable (API) plus a worker entry point from the same codebase, organized into modules with explicit public services and owned tables.
- One repository (pnpm workspaces + Turborepo) containing web, api, worker, shared packages and later mobile.
- TypeScript end to end.

## Consequences
- (+) Cross-module workflows are ordinary DB transactions — no distributed consistency problems.
- (+) One language; shared validation schemas and domain logic across web, API and mobile.
- (+) One thing to deploy on-prem.
- (−) Discipline required to keep module boundaries; enforced via lint import rules and code review.
- (−) A single hot module can't scale independently — acceptable until profiling says otherwise; a module with clean boundaries can be extracted later.

## Alternatives considered
- Microservices: rejected — premature operational and consistency cost.
- Separate repos per app: rejected — contracts would drift between web/api/mobile.
