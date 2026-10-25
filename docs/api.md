# API Conventions

Status: **Active.** Sections marked *(planned)* are binding conventions not yet exercised by an endpoint; they are implemented with the first endpoint that needs them.

One API serves the web app, the future React Native app and integrations. The web app has no private back door.

## 1. Basics

- Base path: `/api/v1`. A breaking change ships as `/api/v2` alongside v1; additive changes (new fields, new endpoints, new error codes) stay in v1.
- JSON only (`Content-Type: application/json`), UTF-8. Request bodies are limited (`HTTP_BODY_LIMIT`, default 1 MB); file uploads use a separate flow (Milestone 1.5).
- Field names `camelCase`. IDs are UUID strings. Clients must treat IDs as opaque.
- Contracts: every request and response schema is a Zod schema in `packages/contracts`, shared by server and clients.
- **API documentation** *(planned, Milestone 1.3)*: OpenAPI 3.1 generated from those Zod schemas and served at `/api/v1/docs` in dev (disabled or authenticated in production). The schemas are the single source of truth, so docs cannot drift.

## 2. Tenancy and authentication

- The tenant is resolved from the **host** (`acme.<platform-domain>`, `acme.localhost` in dev) and verified against the user's membership. Requests never carry a trusted `companyId`; any such field in a body is rejected.
- Web: httpOnly session cookie + CSRF protection. Mobile: bearer session token. *(Milestone 1.3)*
- Unknown tenant or no membership ⇒ `404 NOT_FOUND` (does not confirm the tenant exists).
- Implemented in 1.2: every route except `/health` and `/health/live` passes through tenant resolution; `X-Forwarded-Host` and any client-sent tenant ID are ignored.

## 3. Correlation IDs

- Every response has `X-Request-Id`. It appears in every log line for that request and in every error body as `error.requestId`.
- An incoming `X-Request-Id` is reused only when `TRUST_INCOMING_REQUEST_ID=true` (set only behind our own reverse proxy) and it matches `[A-Za-z0-9._-]{8,128}`.

## 4. Errors

All errors use one shape (`errorResponseSchema` in `packages/contracts`):

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "The request contains invalid fields.", "requestId": "…", "details": [{ "path": "email", "code": "invalid_format" }] } }
```

- `code` is stable and machine-readable; the client shows a translated (EN/AR) message for it. `message` is a short English description for developers, not for display.
- No stack traces, SQL, hostnames or internal messages ever leave the server. Unexpected errors are `500 INTERNAL_ERROR` and logged with the stack trace server-side.
- Codes are added, never renamed or reused.

| HTTP | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST`, `MALFORMED_JSON` | Unparseable request |
| 401 | `UNAUTHENTICATED` | No/expired session |
| 403 | `FORBIDDEN` | Authenticated but lacks the permission or scope |
| 404 | `NOT_FOUND` | Missing, or exists in another tenant (indistinguishable on purpose) |
| 405 | `METHOD_NOT_ALLOWED` | |
| 409 | `CONFLICT` | Version conflict, invalid state transition, duplicate |
| 413 | `PAYLOAD_TOO_LARGE` | Body over limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | |
| 422 | `VALIDATION_FAILED` | Schema or business-rule validation; `details` lists fields |
| 429 | `RATE_LIMITED` | `Retry-After` header included |
| 500 | `INTERNAL_ERROR` | Unexpected |
| 503 | `SERVICE_UNAVAILABLE` | Dependency down |

## 5. Validation *(planned, Milestone 1.3)*

- Every body, query and path parameter is validated against its Zod schema before the service runs. Schemas are `.strict()`: **unknown fields are rejected** (prevents mass assignment such as `"role": "owner"`).
- Business rules (budget capacity, state transitions, permissions) are enforced in services, never only in the UI.

## 6. Money, hours and time

- Money: `{ "amount": "1250.500", "currency": "KWD" }` — amount is a **string** with the currency's decimals (KWD 3). Never a JSON number.
- Hours: decimal strings (`"7.50"`) until the Phase 6 decision (ADR-0005).
- Instants: ISO-8601 UTC (`2026-10-24T18:16:47.116Z`). Calendar dates: `YYYY-MM-DD`.

## 7. Collections *(planned, Phase 3)*

- Cursor pagination: `?limit=50&cursor=<opaque>`; response `{ "items": [...], "nextCursor": "…" | null }`. Max `limit` 200. Cursors are opaque and tenant-bound.
- Sorting: `?sort=name,-createdAt` (`-` = descending); only whitelisted fields per endpoint.
- Filtering: named, whitelisted query params per endpoint (`?status=active&clientId=…`); free text via `?q=`.
- Totals (`count`) only where cheap or explicitly requested.

## 8. Concurrency and idempotency *(planned)*

- **Optimistic concurrency** (Phase 3): resources return `version`; updates send `If-Match: "<version>"` (or `version` in body). A stale version ⇒ `409 CONFLICT` — no silent overwrite.
- **Idempotency keys** (first financial/time endpoint, Phase 7/12): retryable create operations accept `Idempotency-Key: <uuid>`. The server stores key + request hash + response per tenant for 24h; a repeat returns the original response; same key with a different body ⇒ `409 CONFLICT`. Required for payments, invoice issue, payroll approval, time-entry submission.
- Non-idempotent financial operations are never retried automatically (server or client).

## 9. Rate limits *(planned, Milestone 1.3)*

Per IP and per account on login, OTP verify, password reset, invitation accept, exports; general per-user limit on all endpoints. Exceeding ⇒ `429 RATE_LIMITED` with `Retry-After`.

## 10. Endpoints

| Method | Path | Auth | Description | Since |
|---|---|---|---|---|
| GET | `/api/v1/health` | Public | Readiness: 200 if all dependencies up, 503 otherwise. Body `healthResponseSchema`. No versions or error details. | 1.1 |
| GET | `/api/v1/health/live` | Public | Liveness: process running. Always 200 `{ "status": "ok" }`. | 1.1 |
| GET | `/api/v1/tenant` | Public, tenant host | Public profile of the company owning the host: `{ slug, name: { en, ar }, defaultLocale }` (`tenantPublicProfileSchema`). Unknown/unverified/suspended host ⇒ 404. Database unavailable ⇒ 503. | 1.2 |
