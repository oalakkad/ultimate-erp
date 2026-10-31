import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import { tenantPublicProfileSchema } from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { ROUTE_LIMITS } from '../src/platform/rate-limit/route-limit.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { people } from './support/people.js';

// Phase 15b (docs/hardening.md section 2): behaviour behind the production proxies and the
// limits on bulk routes, against real Postgres + Mailpit. The API runs as in production with
// one trusted proxy (TRUST_PROXY_HOPS=1, the web container's nginx) and a deliberately tiny
// connection pool.

let database: TestDatabase;
let mailpit: TestMailpit;
let app: INestApplication;
let worker: INestApplicationContext;
let server: Server;
let migrator: pg.Pool;
const { founder } = people(
  () => server,
  () => mailpit,
);

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  migrator = new pg.Pool({ connectionString: database.migratorUrl, max: 2 });
  const config = testConfig({
    DATABASE_URL: database.appUrl,
    TRUST_PROXY_HOPS: '1',
    // Tiny pool on purpose: a request that needs a second connection while holding one stalls.
    DB_POOL_MAX: '2',
    ...mailpit.smtpConfig,
  });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
  server.setMaxListeners(50); // 20 simultaneous test requests
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await migrator.end();
  await Promise.all([database.stop(), mailpit.stop()]);
});

describe('behind a trusted proxy', () => {
  it('records the address the proxy saw, not one the client made up', async () => {
    const { owner, host } = await founder();
    const res = await owner
      .post('/api/v1/clients', { legalNameEn: 'Proxy Co', legalNameAr: 'شركة' }, host)
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { rows } = await migrator.query<{ ip: string }>(
      "select host(ip_address) as ip from audit_events where action = 'clients.client.created' and target_id = $1",
      [(res.body as { id: string }).id],
    );
    expect(rows.map((r) => r.ip)).toEqual(['203.0.113.9']);
  });

  it('still takes the company from Host only, never from X-Forwarded-Host', async () => {
    const a = await founder();
    const b = await founder();
    const res = await request(server)
      .get('/api/v1/tenant')
      .set('Host', a.host)
      .set('X-Forwarded-Host', b.host);
    expect(res.status).toBe(200);
    expect(tenantPublicProfileSchema.parse(res.body).slug).toBe(a.host.split('.')[0]);
  });
});

describe('limits on bulk routes', () => {
  it(`allows ${ROUTE_LIMITS.export.limit} exports an hour per person, then answers 429 with Retry-After`, async () => {
    const { owner, host } = await founder();
    for (let i = 0; i < ROUTE_LIMITS.export.limit; i += 1) {
      expect((await owner.get('/api/v1/clients/export.csv', host)).status).toBe(200);
    }
    const limited = await owner.get('/api/v1/clients/export.csv', host);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Counted per person: someone else (here in another company) is not affected.
    const other = await founder();
    expect((await other.owner.get('/api/v1/clients/export.csv', other.host)).status).toBe(200);
  }, 120_000);
});

describe('connection pool under concurrent load', () => {
  it('serves many simultaneous requests without taking a second connection inside a transaction', async () => {
    const { owner, host } = await founder();
    const created = await owner.post('/api/v1/expenses', { title: 'Client visit' }, host);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body as { id: string }).id;
    // The claim view looks up account names inside its company transaction. With 2
    // connections and 20 requests at once, a second connection per request would exhaust the
    // pool and time out (2 s); on the transaction's own connection every request completes.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => owner.get(`/api/v1/expenses/${id}`, host)),
    );
    expect(results.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 200));
  }, 60_000);
});
