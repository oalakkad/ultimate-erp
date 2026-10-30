import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  agingSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  type Invoice,
  invoiceListResponseSchema,
  invoiceSchema,
  notificationListResponseSchema,
  projectSchema,
  revenueSchema,
  taskSchema,
  timeEntrySchema,
  timesheetSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { BillingDailyHandler, lineTotals } from '../src/modules/billing/billing.service.js';
import { kuwaitToday } from '../src/modules/contracts/contracts.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 12 acceptance (docs/modules/billing.md §7) against real Postgres + Mailpit.

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
const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;
const shift = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Firm {
  owner: Person;
  manager: Person;
  managerId: string;
  a: Person;
  aId: string;
  host: string;
  clientId: string;
  projectId: string;
}

async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const client = await owner.post(
    '/api/v1/clients',
    { legalNameEn: 'Al Noor Trading', legalNameAr: 'شركة النور للتجارة' },
    host,
  );
  const clientId = (client.body as { id: string }).id;
  const project = projectSchema.parse(
    (
      await owner.post(
        '/api/v1/projects',
        {
          clientId,
          nameEn: 'Audit',
          nameAr: 'تدقيق',
          managerMembershipId: managerId,
          budgetHours: '100',
          memberIds: [aId],
        },
        host,
      )
    ).body,
  );
  return { owner, manager, managerId, a, aId, host, clientId, projectId: project.id };
}

const ok = (res: { status: number; body: unknown }, status = 200): Invoice => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return invoiceSchema.parse(res.body);
};
const draft = (f: Firm, extra: object = {}) =>
  f.owner.post(
    '/api/v1/invoices',
    {
      clientId: f.clientId,
      projectId: f.projectId,
      lines: [
        {
          description: 'Audit fieldwork',
          quantity: '10',
          unitPrice: '25.000',
          discountPercent: '10',
        },
        { description: 'Fixed reporting fee', quantity: '1', unitPrice: '500.000' },
      ],
      ...extra,
    },
    f.host,
  );
const issued = async (f: Firm, extra: object = {}) => {
  const d = ok(await draft(f), 201);
  return ok(await f.owner.post(`/api/v1/invoices/${d.id}/issue`, extra, f.host));
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

describe('money', () => {
  it('rounds each value half-up to the fil', () => {
    expect(
      lineTotals(
        { description: 'x', quantity: '10', unitPrice: '25.000', discountPercent: '10' },
        null,
      ),
    ).toEqual({ amount: 250_000n, discount: 25_000n, tax: 0n });
    expect(lineTotals({ description: 'x', quantity: '1.5', unitPrice: '33.333' }, '5')).toEqual({
      amount: 50_000n,
      discount: 0n,
      tax: 2_500n,
    });
    // 0.333 × 3 = 0.999 ; 2.5 % of 0.999 = 0.024975 → 0.025
    expect(lineTotals({ description: 'x', quantity: '3', unitPrice: '0.333' }, '2.5').tax).toBe(
      25n,
    );
  });
});

describe('invoices', () => {
  it('drafts, issues with a number and keeps issued invoices fixed', async () => {
    const f = await firm();
    const d = ok(await draft(f), 201);
    expect(d).toMatchObject({
      status: 'draft',
      number: null,
      subtotal: '750.000',
      discountTotal: '25.000',
      total: '725.000',
      actions: ['edit', 'delete', 'issue'],
    });
    const inv = ok(await f.owner.post(`/api/v1/invoices/${d.id}/issue`, {}, f.host));
    expect(inv.number).toBe('INV-0001');
    expect(inv.issueDate).toBe(kuwaitToday());
    expect(inv.dueDate).toBe(shift(kuwaitToday(), 30));
    expect(inv.outstanding).toBe('725.000');
    expect(
      (
        await f.owner.patch(
          `/api/v1/invoices/${inv.id}`,
          { notes: 'x', version: inv.version },
          f.host,
        )
      ).status,
    ).toBe(409);
    expect((await f.owner.delete(`/api/v1/invoices/${inv.id}`, f.host)).status).toBe(409);
    await expect(admin.query(`delete from invoices where id = $1::uuid`, [inv.id])).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      admin.query(`update invoices set status = 'draft' where id = $1::uuid`, [inv.id]),
    ).rejects.toThrow(/return to draft/);
    // A draft can be deleted; the next issued invoice continues the sequence.
    const spare = ok(await draft(f), 201);
    expect((await f.owner.delete(`/api/v1/invoices/${spare.id}`, f.host)).status).toBe(200);
    expect((await issued(f)).number).toBe('INV-0002');
    // A project of another client is refused.
    const other = await f.owner.post(
      '/api/v1/clients',
      { legalNameEn: 'Gulf Co', legalNameAr: 'شركة الخليج' },
      f.host,
    );
    const mismatch = await f.owner.post(
      '/api/v1/invoices',
      { clientId: (other.body as { id: string }).id, projectId: f.projectId },
      f.host,
    );
    expect(errorOf(mismatch.body).details?.[0]?.code).toBe('not_of_client');
  });

  it('records partial payments, refuses overpayment, reverses and credits', async () => {
    const f = await firm();
    const inv = await issued(f);
    const part = ok(
      await f.owner.post(
        `/api/v1/invoices/${inv.id}/payments`,
        { amount: '300', receivedOn: kuwaitToday(), method: 'bank_transfer', reference: 'TT-1' },
        f.host,
      ),
      201,
    );
    expect(part).toMatchObject({
      status: 'partially_paid',
      outstanding: '425.000',
      paidTotal: '300.000',
    });
    expect(part.payments[0]).toMatchObject({ source: 'recorded', status: 'recorded' });
    const over = await f.owner.post(
      `/api/v1/invoices/${inv.id}/payments`,
      { amount: '500', receivedOn: kuwaitToday(), method: 'cash' },
      f.host,
    );
    expect(errorOf(over.body).details?.[0]?.code).toBe('more_than_outstanding');
    expect(
      (
        await f.owner.post(
          `/api/v1/invoices/${inv.id}/payments`,
          { amount: '1', receivedOn: shift(kuwaitToday(), 2), method: 'cash' },
          f.host,
        )
      ).status,
    ).toBe(422);
    // Payments can't be voided away: the invoice has money on it.
    expect(
      (await f.owner.post(`/api/v1/invoices/${inv.id}/void`, { reason: 'x' }, f.host)).status,
    ).toBe(409);
    const credited = ok(
      await f.owner.post(
        `/api/v1/invoices/${inv.id}/credit-notes`,
        { amount: '25', reason: 'Discount agreed' },
        f.host,
      ),
      201,
    );
    expect(credited).toMatchObject({ outstanding: '400.000', creditedTotal: '25.000' });
    expect(credited.creditNotes[0]?.number).toBe('CN-0001');
    const paid = ok(
      await f.owner.post(
        `/api/v1/invoices/${inv.id}/payments`,
        { amount: '400', receivedOn: kuwaitToday(), method: 'knet' },
        f.host,
      ),
      201,
    );
    expect(paid).toMatchObject({ status: 'paid', outstanding: '0.000' });
    const reversed = ok(
      await f.owner.post(
        `/api/v1/payments/${paid.payments[1]?.id ?? ''}/reverse`,
        { reason: 'Cheque bounced' },
        f.host,
      ),
    );
    expect(reversed).toMatchObject({ status: 'partially_paid', outstanding: '400.000' });
    expect(
      (
        await f.owner.post(
          `/api/v1/payments/${paid.payments[1]?.id ?? ''}/reverse`,
          { reason: 'again' },
          f.host,
        )
      ).status,
    ).toBe(409);
    // The application itself can never delete or edit a payment.
    const appClient = new pg.Client({ connectionString: database.appUrl });
    await appClient.connect();
    await expect(appClient.query('delete from payments')).rejects.toThrow(/permission denied/);
    await expect(appClient.query('update payments set amount = 1')).rejects.toThrow(
      /permission denied/,
    );
    await appClient.end();

    // Void only without payments, with a reason; a void invoice stays void.
    const fresh = await issued(f);
    expect((await f.owner.post(`/api/v1/invoices/${fresh.id}/void`, {}, f.host)).status).toBe(422);
    const voided = ok(
      await f.owner.post(`/api/v1/invoices/${fresh.id}/void`, { reason: 'Issued twice' }, f.host),
    );
    expect(voided).toMatchObject({
      status: 'void',
      voidReason: 'Issued twice',
      outstanding: '0.000',
    });
    await expect(
      admin.query(`update invoices set status = 'issued' where id = $1::uuid`, [fresh.id]),
    ).rejects.toThrow(/stays void/);
  });

  it('bills approved billable time exactly once', async () => {
    const f = await firm();
    const task = taskSchema.parse(
      (
        await f.manager.post(
          '/api/v1/tasks',
          {
            projectId: f.projectId,
            title: 'Fieldwork',
            allocations: [{ membershipId: f.aId, hours: '20' }],
          },
          f.host,
        )
      ).body,
    );
    const e = timeEntrySchema.parse(
      (
        await f.a.post(
          '/api/v1/time-entries',
          { taskId: task.id, workDate: kuwaitToday(), hours: '6' },
          f.host,
        )
      ).body,
    );
    const sheet = timesheetSchema.parse((await f.a.get('/api/v1/timesheets/mine', f.host)).body);
    await f.a.post(`/api/v1/timesheets/${sheet.id ?? ''}/submit`, {}, f.host);
    await f.manager.post('/api/v1/time-entries/approve', { ids: [e.id] }, f.host);
    const range = {
      projectId: f.projectId,
      from: shift(kuwaitToday(), -7),
      to: kuwaitToday(),
      hourlyRate: '20.000',
    };
    const fromTime = ok(await f.owner.post('/api/v1/invoices/from-time', range, f.host), 201);
    expect(fromTime).toMatchObject({ total: '120.000', timeEntries: 1 });
    expect(fromTime.lines[0]).toMatchObject({ quantity: '6', unitPrice: '20.000' });
    const again = await f.owner.post('/api/v1/invoices/from-time', range, f.host);
    expect(errorOf(again.body).details?.[0]?.code).toBe('no_billable_time');
    // Deleting the draft releases the time; issuing and voiding releases it again.
    await f.owner.delete(`/api/v1/invoices/${fromTime.id}`, f.host);
    const second = ok(await f.owner.post('/api/v1/invoices/from-time', range, f.host), 201);
    ok(await f.owner.post(`/api/v1/invoices/${second.id}/issue`, {}, f.host));
    expect((await f.owner.post('/api/v1/invoices/from-time', range, f.host)).status).toBe(422);
    ok(await f.owner.post(`/api/v1/invoices/${second.id}/void`, { reason: 'Wrong rate' }, f.host));
    expect((await f.owner.post('/api/v1/invoices/from-time', range, f.host)).status).toBe(201);
  });

  it('applies only active configured taxes', async () => {
    const f = await firm();
    const unknown = await draft(f, {
      lines: [{ description: 'Fee', quantity: '1', unitPrice: '100', taxCode: 'vat' }],
    });
    expect(errorOf(unknown.body).details?.[0]?.code).toBe('unknown_tax');
    const settings = await f.owner.patch(
      '/api/v1/billing/settings',
      { taxes: [{ code: 'vat', label: 'VAT', ratePercent: '5', active: true }] },
      f.host,
    );
    expect(settings.body).toMatchObject({ toVerify: true });
    const taxed = ok(
      await draft(f, {
        lines: [{ description: 'Fee', quantity: '1', unitPrice: '100', taxCode: 'vat' }],
      }),
      201,
    );
    expect(taxed).toMatchObject({ taxTotal: '5.000', total: '105.000' });
  });
});

describe('access, overdue and reports', () => {
  it("shows managers only their projects' invoices, and nobody else's company", async () => {
    const f = await firm();
    const inv = await issued(f);
    const loose = ok(
      await f.owner.post(
        '/api/v1/invoices',
        { clientId: f.clientId, lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] },
        f.host,
      ),
      201,
    );
    const forManager = invoiceListResponseSchema.parse(
      (await f.manager.get('/api/v1/invoices', f.host)).body,
    );
    expect(forManager.items.map((i) => i.id)).toEqual([inv.id]);
    expect((await f.manager.get(`/api/v1/invoices/${loose.id}`, f.host)).status).toBe(404);
    expect(
      (
        await f.manager.post(
          `/api/v1/invoices/${inv.id}/payments`,
          { amount: '1', receivedOn: kuwaitToday(), method: 'cash' },
          f.host,
        )
      ).status,
    ).toBe(403);
    expect((await f.a.get('/api/v1/invoices', f.host)).status).toBe(403);
    const g = await founder();
    expect((await g.owner.get(`/api/v1/invoices/${inv.id}`, g.host)).status).toBe(404);
  });

  it('flags overdue invoices, reminds finance once a week, and reports aging and revenue', async () => {
    const f = await firm();
    const late = await issued(f, {
      issueDate: shift(kuwaitToday(), -45),
      dueDate: shift(kuwaitToday(), -15),
    });
    await issued(f);
    const list = invoiceListResponseSchema.parse(
      (await f.owner.get('/api/v1/invoices?overdue=true', f.host)).body,
    );
    expect(list.items.map((i) => i.id)).toEqual([late.id]);
    expect(list.items[0]?.overdue).toBe(true);

    const handler = worker.get(BillingDailyHandler);
    await handler.handle({ id: 'b1' });
    await handler.handle({ id: 'b2' });
    const inbox = notificationListResponseSchema.parse(
      (await f.owner.get('/api/v1/notifications?limit=50', f.host)).body,
    );
    expect(inbox.items.filter((n) => n.type === 'billing.overdue')).toHaveLength(1);

    const aging = agingSchema.parse((await f.owner.get('/api/v1/billing/aging', f.host)).body);
    expect(aging.buckets.find((b) => b.key === 'd1_30')).toMatchObject({
      amount: '725.000',
      count: 1,
    });
    expect(aging.buckets.find((b) => b.key === 'current')).toMatchObject({
      amount: '725.000',
      count: 1,
    });
    expect(aging.total).toBe('1450.000');
    const year = Number(kuwaitToday().slice(0, 4));
    const revenue = revenueSchema.parse(
      (await f.owner.get(`/api/v1/billing/revenue?year=${year}`, f.host)).body,
    );
    expect(Number(revenue.totals.invoiced)).toBeGreaterThan(0);
    const dash = dashboardSummarySchema.parse(
      (await f.owner.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(dash.billing).toMatchObject({
      outstanding: '1450.000',
      overdue: '725.000',
      overdueCount: 1,
    });
  });
});
