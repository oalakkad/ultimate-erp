# Module spec: Files, monitoring & packaging (Milestone 1.5b)

Status: **Built and committed 2026-10-29** (nonstop mode; results in §8). Owner decisions 2026-10-28: uploads **virus-scanned with ClamAV** (pending until clean); error monitoring **Sentry-protocol, configurable, off by default**. Working mode 2026-10-29: nonstop, defaults chosen by Claude and listed in §7.

## 1. Purpose and fit
Clients' documents, engagement letters, receipts, payslips and exports all become files (brief §8, Modules C/D/I/J/K). This milestone gives every later module one safe way to store and hand out files, a way to learn about production errors without leaking personal data, and container images to deploy the API, worker and web app (SaaS or on-prem).

## 2. Files — how it works
1. `POST /api/v1/files` (multipart, field `file`) — member of the company. The API streams the upload with a hard size limit (`FILE_MAX_BYTES`, default 25 MB), detects the **real type from the content** (magic bytes, `file-type`), and refuses anything outside the allow-list even when the name says `.pdf`. Allowed: PDF, PNG, JPEG, WebP, DOCX, XLSX, PPTX, CSV/plain text (UTF-8, no NUL bytes). The original file name is kept only as display text (sanitised, max 200 chars); the storage key never uses it.
2. Stored in S3-compatible storage (RustFS dev, any S3 in production) under `tenants/<tenantId>/files/<random UUID>` (never the file name) with status **`pending`**, and a `file.scan` job is queued in the same transaction (outbox).
3. The worker streams the object to **ClamAV** (`clamd` INSTREAM over TCP), then marks the file **`clean`** or **`infected`** (the object is deleted, the record kept, audited). Scanner unreachable ⇒ retried like email (6 attempts), then **`scan_failed`** — never silently treated as clean. This job reads company data, so it runs inside `withTenant(job.tenantId)` — the cross-tenant job test deferred from 1.5a lives here.
4. `POST /api/v1/files/:id/download` — only for `clean` files the caller may read → a **signed URL valid 5 minutes**, `Content-Disposition: attachment` (never rendered inline by our origin). Until modules attach files to records, "may read" = the uploader; attachments will inherit the owning record's permission.
5. `GET /api/v1/files/:id` — metadata and status (same rule).

Data: `files` (tenant, forced RLS): id, tenant_id, uploaded_by_user_id (member FK), display_name, content_type, size_bytes, sha256, storage_key, status (`pending|clean|infected|scan_failed`), scanned_at, created_at. No delete in 1.5b (retention per module).

## 3. Monitoring
- **Error reports:** our own small sender for the Sentry protocol (`platform/monitoring/monitoring.ts`), enabled only when `SENTRY_DSN` is set (works with Sentry cloud or self-hosted GlitchTip). Only unexpected errors (HTTP 500 and job failures) are sent. A `beforeSend` scrubber removes request bodies, cookies, headers except `user-agent`, query strings, user email/IP, and any string that looks like an email address or a token; only the user ID and tenant ID remain. The Sentry SDK was tried and dropped: version 11 pulls in a bundler toolkit including a non-open-source (FSL-1.1) package, caught by our licence gate. Our sender builds the event itself, so nothing we did not choose can leave the server.
- **Traces:** OpenTelemetry — **deferred to Phase 15** (hardening). In this ESM codebase auto-instrumentation needs a startup loader hook (`--import`); a half-working version would be fake functionality. `OTEL_EXPORTER_OTLP_ENDPOINT` is reserved in the config.
- **Slow requests:** requests slower than `SLOW_REQUEST_MS` (default 1000) are logged as warnings with method, route pattern, status, duration and request ID (architecture §7b).

## 4. Packaging
- `infra/docker/api.Dockerfile` — multi-stage, `pnpm deploy` of the API, Node 24 Alpine, runs as non-root `node`, `NODE_ENV=production`; the same image runs the API (`node dist/main.js`) or the worker (`node dist/worker.js`), plus a `migrate` command (`node db/dist/cli/migrate.js`).
- `infra/docker/web.Dockerfile` — builds the SPA, serves it with nginx (non-root), strict security headers, and proxies `/api/` to the API so company subdomains stay same-origin.
- `infra/compose/compose.prod.example.yaml` — on-prem example: postgres, object storage, clamav, api, worker, web; secrets from an env file the customer creates.
- CI builds both images.

## 5. Acceptance criteria
1. Allowed files upload and become `clean`; a disguised executable (`.pdf` name, PE bytes), an over-size file and an unknown type are refused with clear error codes.
2. The EICAR test file is detected: status `infected`, object deleted, audit event, never downloadable.
3. A `pending` / `infected` / `scan_failed` file cannot be downloaded; a clean one gives a working 5-minute signed URL.
4. Company B cannot see, download or learn the existence of company A's files (404); a scan job for A cannot touch B's rows.
5. With `SENTRY_DSN` set, an unexpected error reaches the monitoring endpoint with no email address, token, cookie or body in it; without it, nothing is sent.
6. Slow requests are logged; both images build and the API image starts and answers `/health/live`.

## 6. Test plan
Integration with real Postgres, RustFS, ClamAV (Testcontainers): upload types/limits/disguise, EICAR, scanner down → retry → `scan_failed`, download URL works and expires, cross-company. Monitoring: fake Sentry endpoint capturing envelopes. Images: `docker build` in CI and locally.

## 7. Decisions taken by Claude (nonstop mode, reviewable)
- Max upload 25 MB (configurable). Allow-list as in §2; no archives (ZIP/RAR) or macro-enabled Office files (`.docm`, `.xlsm`) — common malware carriers.
- Uploads go through the API (not direct-to-S3) so type checks happen before storage; revisit for very large files.
- Download links: 5 minutes, attachment only.
- Images: Node 24 Alpine + nginx Alpine; non-root.

## 8. Results (2026-10-29)
- **Built:** `files` table (forced RLS, uploader must be a member, storage key must sit under the company prefix — all DB-enforced), `ObjectStorage` (S3 SDK, private bucket, signed 5-minute attachment links), `VirusScanner` (clamd INSTREAM, anything unexpected = not clean), content-type allow-list by magic bytes, `FilesService` + 3 endpoints, worker `file.scan` job inside `withTenant`, `AuditLog.recordSystem` for job-made changes, error reporting, slow-request log, `infra/docker/api.Dockerfile`, `web.Dockerfile`, `nginx.conf`, `compose.prod.example.yaml`, ClamAV in dev compose, CI `images` job.
- **Tests:** `apps/api/test/files.spec.ts` (6, real RustFS + ClamAV: clean upload + working signed link + tampered link refused; disguised exe / unknown / SVG-as-txt / over-size refused; EICAR infected + audited + not downloadable; scanner down → pending → `scan_failed`; other member / other company 404; forged cross-company scan job changes nothing). `monitoring.spec.ts` (5: off without DSN; report reaches a fake Sentry endpoint at the standard envelope path with IDs but no email/token; scrubber; slow-request log uses route pattern only). Mutation checks: removing the type check, making the scanner always "clean", and removing email scrubbing each fail their tests.
- **Images verified locally:** API image starts as user `node` with production settings and answers `/health/live`; web image (non-root nginx) serves the app and deep links with the strict CSP; the built app has no inline scripts.
- **No upload screen yet:** the first one arrives with client documents (Phase 3).
