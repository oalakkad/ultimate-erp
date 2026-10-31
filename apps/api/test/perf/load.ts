import http from 'node:http';

/**
 * Minimal HTTP client and closed-loop load generator for the performance test (no extra
 * dependency): N workers each send a request, wait for the whole response, record the latency
 * and repeat, over keep-alive connections, like N people clicking continuously.
 */

export interface Reply {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

export function send(options: {
  port: number;
  method: string;
  path: string;
  host: string;
  cookie?: string;
  body?: unknown;
}): Promise<Reply> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        agent,
        headers: {
          host: options.host,
          'user-agent': 'PerfTest/1',
          accept: 'application/json',
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A signed-in person: keeps cookies across responses (sessions rotate, e.g. after two-factor). */
export class Session {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly port: number) {}

  get cookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async call(method: string, path: string, host: string, body?: unknown): Promise<Reply> {
    const reply = await send({ port: this.port, method, path, host, cookie: this.cookie, body });
    for (const line of reply.headers['set-cookie'] ?? []) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return reply;
  }
}

export interface Scenario {
  name: string;
  kind: 'read' | 'write';
  method?: 'GET' | 'POST';
  path: string;
  body?: (n: number) => unknown;
}

export interface LoadResult {
  name: string;
  kind: 'read' | 'write';
  concurrency: number;
  requests: number;
  failures: number;
  statuses: Record<string, number>;
  perSecond: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0);

/** Runs one scenario until `requests` have been sent or `durationMs` has passed. */
export async function runLoad(options: {
  port: number;
  host: string;
  cookie: string;
  scenario: Scenario;
  concurrency: number;
  requests?: number;
  durationMs?: number;
}): Promise<LoadResult> {
  const { scenario } = options;
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  let started = 0;
  let failures = 0;
  const begin = performance.now();
  const deadline = begin + (options.durationMs ?? Number.POSITIVE_INFINITY);
  const limit = options.requests ?? Number.POSITIVE_INFINITY;
  const worker = async () => {
    while (started < limit && performance.now() < deadline) {
      const n = (started += 1);
      const t = performance.now();
      try {
        const reply = await send({
          port: options.port,
          method: scenario.method ?? 'GET',
          path: scenario.path,
          host: options.host,
          cookie: options.cookie,
          body: scenario.body?.(n),
        });
        latencies.push(performance.now() - t);
        statuses[reply.status] = (statuses[reply.status] ?? 0) + 1;
        if (reply.status >= 400) failures += 1;
      } catch {
        failures += 1;
        statuses.error = (statuses.error ?? 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  const seconds = (performance.now() - begin) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    name: scenario.name,
    kind: scenario.kind,
    concurrency: options.concurrency,
    requests: latencies.length,
    failures,
    statuses,
    perSecond: latencies.length / seconds,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export function table(results: LoadResult[]): string {
  const rows = results.map(
    (r) =>
      `| ${r.name} | ${r.kind} | ${r.concurrency} | ${r.requests} | ${r.perSecond.toFixed(0)} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.max.toFixed(0)} | ${r.failures} |`,
  );
  return [
    '| Scenario | Kind | Users | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Failures |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
