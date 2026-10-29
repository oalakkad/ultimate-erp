import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  flushMonitoring,
  initMonitoring,
  reportError,
  scrubEvent,
} from '../src/platform/monitoring/monitoring.js';
import {
  type SlowRequestLog,
  slowRequestMiddleware,
} from '../src/platform/request-context/slow-request.middleware.js';
import { testConfig } from './support/config.js';

// Milestone 1.5b acceptance 5–6 (docs/modules/files-monitoring.md §5).

const EMAIL = 'alice.private@example.com';
// Obviously fake, but shaped like a real token (32 URL-safe characters).
const TOKEN = 'faketoken'.padEnd(32, 'x');

let collector: Server;
const received: string[] = [];
const paths: string[] = [];
let port = 0;

beforeAll(async () => {
  // Stand-in for Sentry/GlitchTip: records every envelope it is sent.
  collector = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      received.push(body);
      paths.push(req.url ?? '');
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  port = (collector.address() as AddressInfo).port;
});

afterAll(() => {
  collector.close();
});

describe('error monitoring', () => {
  it('sends nothing when SENTRY_DSN is not configured', async () => {
    initMonitoring(testConfig(), 'api');
    reportError(new Error('unconfigured'), { requestId: 'r1' });
    await flushMonitoring();
    expect(received).toEqual([]);
  });

  it('reports unexpected errors without personal data or secrets', async () => {
    initMonitoring(testConfig({ SENTRY_DSN: `http://publickey@127.0.0.1:${port}/1` }), 'api');
    reportError(new Error(`invoice failed for ${EMAIL} with token ${TOKEN}`), {
      requestId: 'req-123',
      tenantId: '01a18869-f94d-720b-83f5-dbcea0418447',
      userId: '01a18869-fa4a-7547-b9e3-bc8c8c0f89e0',
    });
    await flushMonitoring();
    const sent = received.join('\n');
    // Standard Sentry envelope endpoint, so Sentry cloud and GlitchTip both accept it.
    expect(paths[0]).toBe('/api/1/envelope/?sentry_key=publickey&sentry_version=7');
    expect(sent).toContain('invoice failed for [redacted]');
    expect(sent).toContain('req-123');
    // IDs survive scrubbing, so support can find the company and person involved.
    expect(sent).toContain('01a18869-f94d-720b-83f5-dbcea0418447');
    expect(sent).toContain('01a18869-fa4a-7547-b9e3-bc8c8c0f89e0');
    expect(sent).not.toContain(EMAIL);
    expect(sent).not.toContain(TOKEN);
  });

  it('strips request details, cookies, query strings and user contact data', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        method: 'POST',
        url: `https://acme.example/api/v1/auth/password/reset?token=${TOKEN}`,
        headers: { cookie: 'erp.session=abc', authorization: 'Bearer x', 'user-agent': 'Test/1' },
        data: { password: 'hunter2', email: EMAIL },
        cookies: { 'erp.session': 'abc' },
      },
      user: { id: 'u1', email: EMAIL, ip_address: '10.0.0.1' },
      extra: { note: `contact ${EMAIL}` },
      breadcrumbs: [{ message: EMAIL }],
    });
    expect(event.request).toEqual({
      method: 'POST',
      url: 'https://acme.example/api/v1/auth/password/reset',
      headers: { 'user-agent': 'Test/1' },
    });
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.breadcrumbs).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain(EMAIL);
  });
});

describe('slow request log', () => {
  it('logs the route pattern, status and duration — never the real path or query', async () => {
    const logs: SlowRequestLog[] = [];
    const app = express();
    app.use(slowRequestMiddleware(0, (entry) => logs.push(entry)));
    app.get('/api/v1/files/:id', (_req, res) => {
      res.status(404).end();
    });
    await request(app).get(`/api/v1/files/secret-id-42?token=${TOKEN}`);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ method: 'GET', route: '/api/v1/files/:id', status: 404 });
    expect(JSON.stringify(logs)).not.toContain('secret-id-42');
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it('stays quiet for fast requests', async () => {
    const logs: SlowRequestLog[] = [];
    const app = express();
    app.use(slowRequestMiddleware(10_000, (entry) => logs.push(entry)));
    app.get('/ok', (_req, res) => res.end());
    await request(app).get('/ok');
    expect(logs).toEqual([]);
  });
});
