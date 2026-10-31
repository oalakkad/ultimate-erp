import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  auditListResponseSchema,
  expenseClaimSchema,
  invoiceSchema,
  projectSchema,
  reportCatalogSchema,
  reportSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { kuwaitToday } from '../src/modules/contracts/contracts.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 14 acceptance (docs/modules/reports.md §5) against real Postgres + Mailpit.

let database: TestDatabase;
let mailpit: TestMailpit;
let app: INestApplication;
let worker: INestApplicationContext;
let server: Server;
let admin: pg.Pool;
const { person, founder, join } = people(
  () => server,
  () => mailpit,
);
const today = kuwaitToday();

interface Firm {
  owner: Person;
  manager: Person;
  a: Person;
  host: string;
  clientId: string;
  projectId: string;
  otherProjectId: string;
}

/**
 * Owner; a manager running project P (employee A on it); a second project run by the Owner;
 * invoice 725.000 on P, payment 300.000, A's approved expense of 40.000 on P.
 */
async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const ownerId = (
    await admin.query<{ id: string }>(
      `select m.id from memberships m join users u on u.id = m.user_id
       join tenant_domains d on d.tenant_id = m.tenant_id
       where u.email = $1 and d.hostname = $2`,
      [owner.email, host],
    )
  ).rows[0]?.id;
  const client = await owner.post(
    '/api/v1/clients',
    { legalNameEn: '=Al Noor Trading', legalNameAr: 'شركة النور للتجارة' },
    host,
  );
  const clientId = (client.body as { id: string }).id;
  const project = (managerMembershipId: string, nameEn: string, memberIds: string[]) =>
    owner
      .post(
        '/api/v1/projects',
        { clientId, nameEn, nameAr: 'تدقيق', managerMembershipId, budgetHours: '100', memberIds },
        host,
      )
      .then((r) => projectSchema.parse(r.body).id);
  const projectId = await project(managerId, 'Audit', [aId]);
  const otherProjectId = await project(ownerId ?? '', 'Advisory', []);

  const draft = invoiceSchema.parse(
    (
      await owner.post(
        '/api/v1/invoices',
        {
          clientId,
          projectId,
          lines: [
            {
              description: 'Fieldwork',
              quantity: '10',
              unitPrice: '25.000',
              discountPercent: '10',
            },
            { description: 'Fee', quantity: '1', unitPrice: '500.000' },
          ],
        },
        host,
      )
    ).body,
  );
  expect((await owner.post(`/api/v1/invoices/${draft.id}/issue`, {}, host)).status).toBe(200);
  const paid = await owner.post(
    `/api/v1/invoices/${draft.id}/payments`,
    { amount: '300.000', receivedOn: today, method: 'bank_transfer' },
    host,
  );
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);

  const claim = expenseClaimSchema.parse(
    (
      await a.post(
        '/api/v1/expenses',
        {
          title: 'Visit',
          lines: [
            {
              spentOn: today,
              category: 'transport',
              description: 'Taxi',
              amount: '4.000',
              projectId,
            },
          ],
        },
        host,
      )
    ).body,
  );
  // 4.000 is below the receipt threshold; a second, bigger line would need a receipt.
  await a.patch(
    `/api/v1/expenses/${claim.id}`,
    {
      version: claim.version,
      lines: [
        { spentOn: today, category: 'transport', description: 'Taxi', amount: '4.000', projectId },
        { spentOn: today, category: 'meals', description: 'Lunch', amount: '5.000', projectId },
      ],
    },
    host,
  );
  expect((await a.post(`/api/v1/expenses/${claim.id}/submit`, {}, host)).status).toBe(200);
  expect((await owner.post(`/api/v1/expenses/${claim.id}/approve`, {}, host)).status).toBe(200);
  return { owner, manager, a, host, clientId, projectId, otherProjectId };
}

const run = async (p: Person, f: Firm, key: string, query = '') => {
  const res = await p.get(
    `/api/v1/reports/${key}?from=${today.slice(0, 4)}-01-01&to=${today}${query}`,
    f.host,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return reportSchema.parse(res.body);
};

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  admin = new pg.Pool({ connectionString: database.migratorUrl, max: 2 });
  const config = testConfig({ DATABASE_URL: database.appUrl, ...mailpit.smtpConfig });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
});

beforeEach(async () => {
  await admin.query('delete from rate_limit_buckets');
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await admin.end();
  await Promise.all([database.stop(), mailpit.stop()]);
});

describe('reports', () => {
  it('match the modules exactly and list only what the person may run', async () => {
    const f = await firm();
    const catalog = reportCatalogSchema.parse((await f.owner.get('/api/v1/reports', f.host)).body);
    expect(catalog.items.map((i) => i.key)).toEqual(
      expect.arrayContaining(['clients', 'profitability', 'receivables', 'revenue']),
    );
    // The founder is also CEO, so payroll is listed; a manager has no payroll report.
    expect(catalog.items.map((i) => i.key)).toContain('payroll');
    const forManager = reportCatalogSchema.parse(
      (await f.manager.get('/api/v1/reports', f.host)).body,
    );
    expect(forManager.items.map((i) => i.key)).not.toContain('payroll');
    expect((await f.manager.get('/api/v1/reports/payroll', f.host)).status).toBe(403);
    const forA = reportCatalogSchema.parse((await f.a.get('/api/v1/reports', f.host)).body);
    expect(forA.items).toEqual([]);
    expect((await f.a.get('/api/v1/reports/clients', f.host)).status).toBe(403);

    const clientsReport = await run(f.owner, f, 'clients');
    expect(clientsReport.rows).toEqual([
      expect.objectContaining({ invoiced: '725.000', received: '300.000', outstanding: '425.000' }),
    ]);
    expect(clientsReport.totals).toMatchObject({ invoiced: '725.000', outstanding: '425.000' });

    const profit = await run(f.owner, f, 'profitability');
    expect(profit.rows).toEqual([
      expect.objectContaining({
        invoiced: '725.000',
        expenses: '9.000',
        contribution: '716.000',
        margin: '98.7',
      }),
    ]);
    expect((await run(f.owner, f, 'receivables')).totals).toMatchObject({ total: '425.000' });
    expect((await run(f.owner, f, 'payments')).totals).toEqual({ amount: '300.000' });
    const revenue = await run(f.owner, f, 'revenue');
    expect(revenue.rows.find((r) => r.month === today.slice(0, 7))).toMatchObject({
      invoiced: '725.000',
      received: '300.000',
    });
    const invoicesReport = await run(f.owner, f, 'invoices');
    expect(invoicesReport.rows).toEqual([
      expect.objectContaining({
        number: 'INV-0001',
        status: 'partially_paid',
        outstanding: '425.000',
      }),
    ]);

    // Arabic names when asked in Arabic.
    const ar = await run(f.owner, f, 'clients', '&locale=ar');
    expect(ar.rows[0]?.client).toBe('شركة النور للتجارة');

    // Periods are bounded.
    expect(
      (await f.owner.get('/api/v1/reports/revenue?from=2020-01-01&to=2026-12-31', f.host)).status,
    ).toBe(422);
  });

  it('limits scoped reports and keeps other companies out', async () => {
    const f = await firm();
    // Managers read projects company-wide, but time only on projects they manage.
    const time = reportCatalogSchema.parse((await f.manager.get('/api/v1/reports', f.host)).body);
    expect(time.items.find((i) => i.key === 'timesheets')).toMatchObject({ scoped: true });
    const projectsReport = await run(f.manager, f, 'projects');
    expect(projectsReport.rows.map((r) => r.project)).toEqual(['Audit', 'Advisory']);

    const g = await founder();
    const res = await g.owner.get('/api/v1/reports/clients', g.host);
    expect(reportSchema.parse(res.body).rows).toEqual([]);
    expect(
      reportSchema.parse((await g.owner.get('/api/v1/reports/invoices', g.host)).body).rows,
    ).toEqual([]);
  });

  it('exports CSV safely and records the export', async () => {
    const f = await firm();
    const res = await f.owner.get(
      `/api/v1/reports/clients/export.csv?from=${today.slice(0, 4)}-01-01&to=${today}`,
      f.host,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('clients.csv');
    // A name starting with "=" is never a formula in a spreadsheet.
    expect(res.text).toContain(`"'=Al Noor Trading"`);
    expect(res.text).toContain('"Total"');
    const audit = await admin.query<{ details: Record<string, unknown> }>(
      `select details from audit_events where action = 'reports.report.exported'`,
    );
    expect(audit.rows[0]?.details).toMatchObject({ report: 'clients', rows: 1 });
  });
});

describe('audit search', () => {
  it('filters by action, actor and date, and audits its export', async () => {
    const f = await firm();
    const billing = auditListResponseSchema.parse(
      (await f.owner.get('/api/v1/audit-events?action=billing.&limit=200', f.host)).body,
    );
    expect(billing.items.length).toBeGreaterThan(0);
    expect(billing.items.every((e) => e.action.startsWith('billing.'))).toBe(true);
    expect(billing.items[0]?.actorName).toBeTruthy();

    const actor = billing.items[0]?.actorUserId ?? '';
    const mine = auditListResponseSchema.parse(
      (await f.owner.get(`/api/v1/audit-events?actorUserId=${actor}&limit=200`, f.host)).body,
    );
    expect(mine.items.every((e) => e.actorUserId === actor)).toBe(true);

    const past = auditListResponseSchema.parse(
      (await f.owner.get('/api/v1/audit-events?to=2020-01-01', f.host)).body,
    );
    expect(past.items).toEqual([]);
    // "%" is literal, not a wildcard.
    expect((await f.owner.get('/api/v1/audit-events?action=%25', f.host)).status).toBe(422);

    const csv = await f.owner.get('/api/v1/audit-events/export.csv?action=billing.', f.host);
    expect(csv.status).toBe(200);
    expect(csv.text.split('\r\n')[0]).toContain('occurred_at');
    const exported = await admin.query(
      `select 1 from audit_events where action = 'audit.exported'`,
    );
    expect(exported.rowCount).toBe(1);
    expect((await f.a.get('/api/v1/audit-events', f.host)).status).toBe(403);
  });
});
