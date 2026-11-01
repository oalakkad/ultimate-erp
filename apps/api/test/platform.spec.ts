import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  errorResponseSchema,
  myCompaniesResponseSchema,
  platformAuditListResponseSchema,
  platformCompanyListResponseSchema,
  platformCompanySchema,
  platformMeResponseSchema,
  platformOverviewSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { grantFounder } from '../src/ops/founder.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { people } from './support/people.js';

// Phase 17 (docs/modules/platform.md §7): the founder's console — who may open it, what it
// shows, what suspension does, and that it never reaches into a company's business data.
// Real Postgres + Mailpit.

let database: TestDatabase;
let mailpit: TestMailpit;
let app: INestApplication;
let worker: INestApplicationContext;
let server: Server;
let appPool: pg.Pool;
const { person, founder, enableTwoFactor } = people(
  () => server,
  () => mailpit,
);
const code = (res: request.Response) => errorResponseSchema.parse(res.body).error.code;

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  appPool = new pg.Pool({ connectionString: database.appUrl, max: 2 });
  const config = testConfig({ DATABASE_URL: database.appUrl, ...mailpit.smtpConfig });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await appPool.end();
  await Promise.all([database.stop(), mailpit.stop()]);
});

describe('platform console', () => {
  it('exists only for a granted account with two-factor, on the main address', async () => {
    const stranger = await person('stranger');
    const probe = await stranger.get('/api/v1/platform/me');
    expect(probe.body, String(probe.status)).toEqual({ founder: false });
    // Not an operator: the console answers as if it did not exist.
    expect((await stranger.get('/api/v1/platform/companies')).status).toBe(404);
    expect((await request(server).get('/api/v1/platform/overview')).status).toBe(401);

    // Granting is a command-line act as the migrator; nothing in the API can do it.
    const operator = await person('operator');
    expect(await grantFounder(database.migratorUrl, operator.email.toUpperCase())).toBe('granted');
    expect(await grantFounder(database.migratorUrl, operator.email)).toBe('already');
    expect(await grantFounder(database.migratorUrl, 'nobody@example.com')).toBe('no_account');
    // The application role cannot write the operator table at all.
    await expect(
      appPool.query(`insert into platform_operators (user_id, role, granted_by)
        select id, 'founder', 'test' from users limit 1`),
    ).rejects.toMatchObject({ code: '42501' });

    // Granted but without two-factor: told to set it up first.
    const noMfa = await operator.get('/api/v1/platform/overview');
    expect(noMfa.status).toBe(403);
    expect(code(noMfa)).toBe('MFA_REQUIRED');
    await enableTwoFactor(operator);
    expect(
      platformMeResponseSchema.parse((await operator.get('/api/v1/platform/me')).body),
    ).toEqual({ founder: true });
    expect((await operator.get('/api/v1/platform/overview')).status).toBe(200);

    // Never on a company address.
    const { host } = await founder();
    expect((await operator.get('/api/v1/platform/overview', host)).status).toBe(404);
    expect(
      platformMeResponseSchema.parse((await operator.get('/api/v1/platform/me', host)).body),
    ).toEqual({ founder: false });
  });

  it('lists every company with size and activity, suspends and reactivates with an audit trail, and never business data', async () => {
    const operator = await person('operator2');
    await grantFounder(database.migratorUrl, operator.email);
    await enableTwoFactor(operator);
    const { owner, host } = await founder();
    const slug = host.replace('.localhost', '');
    const colleague = await person('colleague');
    const invited = await owner.post(
      '/api/v1/invitations',
      { email: colleague.email, role: 'employee' },
      host,
    );
    expect(invited.status).toBe(201);
    const client = await owner.post(
      '/api/v1/clients',
      { legalNameEn: 'Secret Client', legalNameAr: 'عميل' },
      host,
    );
    expect(client.status).toBe(201);

    const overview = platformOverviewSchema.parse(
      (await operator.get('/api/v1/platform/overview')).body,
    );
    expect(overview.companies).toBeGreaterThanOrEqual(2);
    expect(overview.people).toBeGreaterThanOrEqual(2);

    const { items } = platformCompanyListResponseSchema.parse(
      (await operator.get(`/api/v1/platform/companies?search=${slug}`)).body,
    );
    expect(items).toHaveLength(1);
    const company = items[0];
    if (!company) throw new Error('company missing');
    expect(company.slug).toBe(slug);
    expect(company.status).toBe('active');
    expect(company.activeMembers).toBe(1);
    expect(company.pendingInvitations).toBe(1);
    expect(company.owners.map((o) => o.email)).toEqual([owner.email]);
    expect(company.lastActivityAt).not.toBeNull();
    expect(company.url).toBe(`http://${host}:3000`);
    // The directory carries nothing from inside the company (no client names anywhere).
    expect(JSON.stringify(items)).not.toContain('Secret Client');
    // Nor can the founder read company routes: not a member → 404 like anyone else.
    expect((await operator.get('/api/v1/clients', host)).status).toBe(404);

    // Suspend: the company's address stops answering and it leaves its members' lists.
    const suspended = await operator.post(`/api/v1/platform/companies/${company.tenantId}/status`, {
      status: 'suspended',
      reason: 'Unpaid invoice (test)',
    });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(platformCompanySchema.parse(suspended.body).status).toBe('suspended');
    expect((await owner.get('/api/v1/clients', host)).status).toBe(404);
    expect((await owner.get('/api/v1/tenant', host)).status).toBe(404);
    const mine = myCompaniesResponseSchema.parse((await owner.get('/api/v1/auth/companies')).body);
    expect(mine.companies.map((c) => c.slug)).not.toContain(slug);
    // Reason too short → refused; a missing reason too.
    expect(
      (
        await operator.post(`/api/v1/platform/companies/${company.tenantId}/status`, {
          status: 'active',
        })
      ).status,
    ).toBe(422);

    // Reactivate.
    const back = await operator.post(`/api/v1/platform/companies/${company.tenantId}/status`, {
      status: 'active',
      reason: 'Paid',
    });
    expect(platformCompanySchema.parse(back.body).status).toBe('active');
    expect((await owner.get('/api/v1/clients', host)).status).toBe(200);

    // Both actions are in the platform audit, with the reason; the table is append-only.
    const audit = platformAuditListResponseSchema.parse(
      (await operator.get('/api/v1/platform/audit-events')).body,
    );
    const ours = audit.items.filter((e) => e.company?.tenantId === company.tenantId);
    expect(ours.map((e) => e.action)).toEqual([
      'platform.company.reactivated',
      'platform.company.suspended',
    ]);
    expect(ours[1]?.details).toMatchObject({
      from: 'active',
      to: 'suspended',
      reason: 'Unpaid invoice (test)',
    });
    expect(ours[0]?.actorName).toBe('operator2');
    await expect(appPool.query('delete from platform_audit_events')).rejects.toMatchObject({
      code: '42501',
    });

    // Unknown company → 404; a stranger still sees nothing.
    expect(
      (
        await operator.post(
          '/api/v1/platform/companies/0193d1f0-0000-7000-8000-000000000000/status',
          { status: 'suspended', reason: 'x' },
        )
      ).status,
    ).toBe(404);
    expect((await colleague.get('/api/v1/platform/audit-events')).status).toBe(404);
  });
});
