import { type Server } from 'node:http';
import { type INestApplication } from '@nestjs/common';
import { errorResponseSchema, tenantPublicProfileSchema } from '@ultimate-erp/contracts';
import { createDatabase, tenantDomains, tenants } from '@ultimate-erp/db';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/platform/config/config.js';

// Tenant routing over HTTP against a real database (ADR-0003, testing.md §3).

let database: TestDatabase;
let app: INestApplication;
let server: Server;
let globexId: string;

async function startApp(databaseUrl: string): Promise<INestApplication> {
  const instance = await createApp(
    loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, LOG_LEVEL: 'silent' }),
  );
  await instance.init();
  return instance;
}

beforeAll(async () => {
  database = await startTestDatabase();
  const pool = new pg.Pool({ connectionString: database.migratorUrl, max: 1 });
  try {
    const db = createDatabase(pool);
    const [acme, globex] = await db
      .insert(tenants)
      .values([
        { slug: 'acme', nameEn: 'Acme', nameAr: 'أكمي' },
        { slug: 'globex', nameEn: 'Globex', nameAr: 'جلوبكس', defaultLocale: 'ar' },
      ])
      .returning({ id: tenants.id });
    if (!acme || !globex) throw new Error('fixture insert failed');
    globexId = globex.id;
    await db.insert(tenantDomains).values([
      { tenantId: acme.id, hostname: 'acme.localhost', kind: 'subdomain', verifiedAt: new Date() },
      {
        tenantId: globex.id,
        hostname: 'globex.localhost',
        kind: 'subdomain',
        verifiedAt: new Date(),
      },
    ]);
  } finally {
    await pool.end();
  }
  app = await startApp(database.appUrl);
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await app.close();
  await database.stop();
});

describe('tenant resolution from the request host', () => {
  it.each([
    ['acme.localhost', 'acme', 'Acme', 'en'],
    ['globex.localhost', 'globex', 'Globex', 'ar'],
    ['ACME.localhost:3000', 'acme', 'Acme', 'en'],
  ])('%s → %s', async (host, slug, nameEn, locale) => {
    const res = await request(server).get('/api/v1/tenant').set('Host', host);
    expect(res.status).toBe(200);
    expect(tenantPublicProfileSchema.parse(res.body)).toMatchObject({
      slug,
      name: { en: nameEn },
      defaultLocale: locale,
    });
  });

  it.each([['unknown.localhost'], ['127.0.0.1'], ['localhost']])(
    'answers 404 in the standard shape for %s',
    async (host) => {
      const res = await request(server).get('/api/v1/tenant').set('Host', host);
      expect(res.status).toBe(404);
      expect(errorResponseSchema.parse(res.body).error.code).toBe('NOT_FOUND');
    },
  );

  it('answers 404 for an unknown route on a valid tenant host', async () => {
    const res = await request(server).get('/api/v1/does-not-exist').set('Host', 'acme.localhost');
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('ignores X-Forwarded-Host (no trusted proxy configured)', async () => {
    const res = await request(server)
      .get('/api/v1/tenant')
      .set('Host', 'acme.localhost')
      .set('X-Forwarded-Host', 'globex.localhost');
    expect(res.body).toMatchObject({ slug: 'acme' });
  });

  it('ignores a company ID supplied by the client', async () => {
    const res = await request(server)
      .get(`/api/v1/tenant?tenantId=${globexId}`)
      .set('Host', 'acme.localhost')
      .set('X-Tenant-Id', globexId);
    expect(res.body).toMatchObject({ slug: 'acme' });
  });

  it('keeps health checks available on any host', async () => {
    for (const host of ['acme.localhost', 'unknown.localhost', '127.0.0.1']) {
      const res = await request(server).get('/api/v1/health').set('Host', host);
      expect(res.status, host).toBe(200);
    }
  });
});

describe('connected as an unsafe database role', () => {
  let unsafeApp: INestApplication;
  let unsafeServer: Server;

  beforeAll(async () => {
    // The container's superuser bypasses row-level security: the API must refuse to use it.
    unsafeApp = await startApp(database.adminUrl);
    unsafeServer = unsafeApp.getHttpServer() as Server;
  });

  afterAll(async () => {
    await unsafeApp.close();
  });

  it('refuses tenant data with 503', async () => {
    const res = await request(unsafeServer).get('/api/v1/tenant').set('Host', 'acme.localhost');
    expect(res.status).toBe(503);
    expect(errorResponseSchema.parse(res.body).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('reports the database as down on /health', async () => {
    const res = await request(unsafeServer).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ checks: { database: { status: 'down' } } });
  });
});
