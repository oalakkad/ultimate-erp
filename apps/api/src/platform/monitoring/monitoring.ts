import { randomUUID } from 'node:crypto';
import { type AppConfig } from '../config/config.js';

// Error reporting in the Sentry protocol (works with Sentry cloud and self-hosted GlitchTip),
// written here instead of using the Sentry SDK: no third-party code decides what is sent, and
// the SDK's dependency tree includes a non-open-source (FSL) package. docs/modules/
// files-monitoring.md §3. Off unless SENTRY_DSN is set (owner decision 2026-10-28).

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** Bearer/JWT-like tokens and long hex/base64url secrets. */
const TOKEN = /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]+){0,2}\b/gi;
/** Record IDs are kept: they identify, they do not reveal, and support needs them. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Replaces anything that looks like personal data or a secret in a string. */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL, '[redacted]')
    .replace(TOKEN, (match) => (UUID.test(match) ? match : '[redacted]'));
}

function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        scrubDeep(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** The parts of a Sentry event we may send. */
export interface ReportEvent {
  request?: { method?: string; url?: string; headers?: Record<string, string> } & Record<
    string,
    unknown
  >;
  user?: { id?: string } & Record<string, unknown>;
  breadcrumbs?: unknown;
  [key: string]: unknown;
}

/**
 * Removes personal data before a report leaves the server: no request body, cookies, query
 * string or headers (except the user agent), only the user's ID, no breadcrumbs, and every
 * remaining string is scrubbed.
 */
export function scrubEvent<T extends ReportEvent>(event: T): T {
  const request = event.request;
  if (request) {
    const userAgent = request.headers?.['user-agent'];
    event.request = {
      ...(request.method ? { method: request.method } : {}),
      ...(request.url ? { url: request.url.split('?')[0] } : {}),
      ...(userAgent ? { headers: { 'user-agent': userAgent } } : {}),
    };
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  delete event.breadcrumbs;
  return scrubDeep(event) as T;
}

/** `at fn (file:line:col)` → a Sentry stack frame (innermost last, as Sentry expects). */
function framesOf(stack: string | undefined) {
  const frames = (stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({
      function: m[1] ?? '?',
      filename: (m[2] ?? '').replace(/^file:\/\//, ''),
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !(m[2] ?? '').includes('node_modules') && !(m[2] ?? '').startsWith('node:'),
    }));
  return frames.reverse();
}

interface Destination {
  url: string;
  dsn: string;
  environment: string;
  service: string;
}

let destination: Destination | undefined;
const pending = new Set<Promise<void>>();

/** Starts error reporting if, and only if, SENTRY_DSN is configured. Call once per process. */
export function initMonitoring(config: AppConfig, service: 'api' | 'worker'): void {
  if (!config.SENTRY_DSN || destination) return;
  const dsn = new URL(config.SENTRY_DSN);
  const project = dsn.pathname.replace(/^\/+/, '').split('/').pop() ?? '';
  const path = dsn.pathname.replace(/\/?[^/]*$/, '');
  const url = new URL(`${path}/api/${project}/envelope/`, `${dsn.protocol}//${dsn.host}`);
  url.searchParams.set('sentry_key', decodeURIComponent(dsn.username));
  url.searchParams.set('sentry_version', '7');
  destination = {
    url: url.toString(),
    dsn: config.SENTRY_DSN,
    environment: config.APP_PROFILE,
    service,
  };
}

/** Context attached to a report: IDs only. */
export interface ErrorContext {
  requestId?: string;
  jobId?: string;
  jobName?: string;
  tenantId?: string;
  userId?: string;
}

/** Reports an unexpected error (HTTP 500, final job failure). No-op when monitoring is off. */
export function reportError(err: unknown, context: ErrorContext): void {
  const target = destination;
  if (!target) return;
  const error = err instanceof Error ? err : new Error(String(err));
  const { userId, ...tags } = context;
  const event = scrubEvent({
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: target.environment,
    server_name: target.service,
    tags: Object.fromEntries(Object.entries(tags).filter(([, v]) => v)),
    ...(userId ? { user: { id: userId } } : {}),
    exception: {
      values: [
        { type: error.name, value: error.message, stacktrace: { frames: framesOf(error.stack) } },
      ],
    },
  });
  const body = [
    JSON.stringify({
      event_id: event.event_id,
      sent_at: new Date().toISOString(),
      dsn: target.dsn,
    }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  const sending = fetch(target.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-sentry-envelope' },
    body,
    signal: AbortSignal.timeout(5_000),
  }).then(
    () => undefined,
    () => undefined, // monitoring must never break the app
  );
  pending.add(sending);
  void sending.finally(() => pending.delete(sending));
}

/** Waits for reports still being sent (on shutdown and in tests). */
export async function flushMonitoring(): Promise<void> {
  await Promise.all([...pending]);
}
