import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 15d monitoring verification: the BUILT API, preloaded with dist/telemetry.js, sends
// traces to an OpenTelemetry collector (here a tiny local receiver), without personal data.

const API_DIR = fileURLToPath(new URL('../', import.meta.url));
const PORT = 3198;
let database: TestDatabase;
let receiver: Server;
let api: ChildProcess;
const bodies: string[] = [];

beforeAll(async () => {
  database = await startTestDatabase();
  receiver = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      bodies.push(`${req.url ?? ''} ${req.headers['content-type'] ?? ''}\n${body}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const otlp = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  api = spawn(process.execPath, ['--import', './dist/telemetry.js', 'dist/main.js'], {
    cwd: API_DIR,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'development',
      LOG_LEVEL: 'warn',
      API_PORT: String(PORT),
      DATABASE_URL: database.appUrl,
      AUTH_SECRET: 'telemetry-test-secret-0123456789-abcdefghij',
      DATA_ENCRYPTION_KEY: 'telemetry-test-data-key-0123456789-abcdefgh',
      APP_PUBLIC_URL: `http://localhost:${PORT}`,
      PASSWORD_BREACH_CHECK: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: otlp,
      OTEL_BSP_SCHEDULE_DELAY: '200',
    },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`http://127.0.0.1:${PORT}/api/v1/health/live`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('API with telemetry did not start');
}, 120_000);

afterAll(async () => {
  api.kill();
  await new Promise<void>((resolve) =>
    receiver.close(() => {
      resolve();
    }),
  );
  await database.stop();
});

describe('traces', () => {
  it('records the request and its database query, without query strings', async () => {
    expect(
      (await fetch(`http://127.0.0.1:${PORT}/api/v1/health?email=someone@example.com`)).status,
    ).toBe(200);
    const deadline = Date.now() + 15_000;
    while (
      Date.now() < deadline &&
      !bodies.some((b) => b.includes('/api/v1/health') && b.includes('postgresql'))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const all = bodies.join('\n');
    expect(all).toContain('/v1/traces');
    expect(all).toContain('ultimate-erp-api');
    expect(all).toContain('/api/v1/health');
    expect(all).toContain('postgresql');
    expect(all).not.toContain('someone@example.com');
  }, 30_000);
});
