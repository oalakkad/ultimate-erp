import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  dashboardSummarySchema,
  errorResponseSchema,
  type ExpenseClaim,
  expenseClaimSchema,
  expenseListResponseSchema,
  invoiceSchema,
  notificationListResponseSchema,
  projectExpensesSchema,
  projectSchema,
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

// Phase 12b acceptance (docs/modules/expenses.md §7) against real Postgres + Mailpit.

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
const today = kuwaitToday();

interface Firm {
  owner: Person;
  manager: Person;
  managerId: string;
  a: Person;
  aId: string;
  b: Person;
  host: string;
  projectId: string;
}

/** Owner; manager who is employee A's line manager and runs project P (A is on it); B outside. */
async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const b = await person('empb');
  const bId = await join(b, host, owner, 'employee');
  for (const [id, managerMembershipId] of [
    [aId, managerId],
    [bId, null],
  ] as const) {
    const res = await owner.post('/api/v1/people', { membershipId: id, managerMembershipId }, host);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  const client = await owner.post(
    '/api/v1/clients',
    { legalNameEn: 'Al Noor Trading', legalNameAr: 'شركة النور للتجارة' },
    host,
  );
  const project = projectSchema.parse(
    (
      await owner.post(
        '/api/v1/projects',
        {
          clientId: (client.body as { id: string }).id,
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
  return { owner, manager, managerId, a, aId, b, host, projectId: project.id };
}

/** A clean file uploaded by this person (fixture: the scanner is exercised in files.spec). */
async function receipt(f: Firm, p: Person): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into files (tenant_id, uploaded_by_user_id, display_name, content_type, size_bytes, sha256, storage_key, status)
     select m.tenant_id, u.id, 'receipt.pdf', 'application/pdf', 100, 'x',
            'tenants/' || m.tenant_id || '/' || gen_random_uuid(), 'clean'
     from users u join memberships m on m.user_id = u.id
     join tenant_domains d on d.tenant_id = m.tenant_id
     where u.email = $1 and d.hostname = $2
     returning files.id`,
    [p.email, f.host],
  );
  return rows[0]?.id ?? '';
}

const ok = (res: { status: number; body: unknown }, status = 200): ExpenseClaim => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return expenseClaimSchema.parse(res.body);
};
const claim = async (f: Firm, receiptFileId: string | null) =>
  ok(
    await f.a.post(
      '/api/v1/expenses',
      {
        title: 'Client visit',
        lines: [
          { spentOn: today, category: 'transport', description: 'Taxi', amount: '4.500' },
          {
            spentOn: today,
            category: 'government_fees',
            description: 'Filing fee',
            amount: '40.000',
            projectId: f.projectId,
            billable: true,
            receiptFileId,
          },
        ],
      },
      f.host,
    ),
    201,
  );

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

describe('claiming', () => {
  it('totals exactly, needs receipts above the threshold and numbers on submission', async () => {
    const f = await firm();
    const draft = await claim(f, null);
    expect(draft).toMatchObject({ status: 'draft', number: null, total: '44.500', lineCount: 2 });
    expect(draft.actions).toEqual(['edit', 'delete', 'submit']);

    // 40.000 is above the 5.000 receipt threshold.
    const missing = await f.a.post(`/api/v1/expenses/${draft.id}/submit`, {}, f.host);
    expect(missing.status).toBe(422);
    expect(errorOf(missing.body).details?.[0]?.code).toBe('receipt_required');

    // Someone else's file can't be used as my receipt.
    const foreign = await receipt(f, f.b);
    const stolen = await f.a.patch(
      `/api/v1/expenses/${draft.id}`,
      {
        version: draft.version,
        lines: [
          {
            spentOn: today,
            category: 'other',
            description: 'x',
            amount: '1.000',
            receiptFileId: foreign,
          },
        ],
      },
      f.host,
    );
    expect(errorOf(stolen.body).details?.[0]?.code).toBe('not_found');
    // Unknown category, billable without a project, a project I'm not on.
    for (const [line, code] of [
      [{ category: 'yachts' }, 'unknown'],
      [{ billable: true }, 'required'],
    ] as const) {
      const res = await f.a.patch(
        `/api/v1/expenses/${draft.id}`,
        {
          version: draft.version,
          lines: [
            { spentOn: today, category: 'other', description: 'x', amount: '1.000', ...line },
          ],
        },
        f.host,
      );
      expect(errorOf(res.body).details?.[0]?.code).toBe(code);
    }
    const otherProject = await f.b.post(
      '/api/v1/expenses',
      {
        title: 'x',
        lines: [
          {
            spentOn: today,
            category: 'other',
            description: 'x',
            amount: '1.000',
            projectId: f.projectId,
          },
        ],
      },
      f.host,
    );
    expect(errorOf(otherProject.body).details?.[0]?.code).toBe('not_found');

    const withReceipt = await receipt(f, f.a);
    const fixed = ok(
      await f.a.patch(
        `/api/v1/expenses/${draft.id}`,
        {
          version: draft.version,
          lines: [
            { spentOn: today, category: 'transport', description: 'Taxi', amount: '4.500' },
            {
              spentOn: today,
              category: 'government_fees',
              description: 'Filing fee',
              amount: '40.000',
              projectId: f.projectId,
              billable: true,
              receiptFileId: withReceipt,
            },
          ],
        },
        f.host,
      ),
    );
    const submitted = ok(await f.a.post(`/api/v1/expenses/${fixed.id}/submit`, {}, f.host));
    expect(submitted).toMatchObject({ status: 'submitted', number: 'EX-0001', total: '44.500' });
    expect(submitted.actions).toEqual([]);
    // Submitted lines are fixed — by the API and by the database itself.
    expect(
      (
        await f.a.patch(
          `/api/v1/expenses/${fixed.id}`,
          { version: submitted.version, title: 'x' },
          f.host,
        )
      ).status,
    ).toBe(409);
    await expect(
      admin.query(`update expense_lines set amount = 1 where claim_id = $1`, [fixed.id]),
    ).rejects.toThrow(/lines are fixed/);
    await expect(
      admin.query(`delete from expense_claims where id = $1`, [fixed.id]),
    ).rejects.toThrow(/cannot be deleted/);

    // The line manager is told.
    const inbox = notificationListResponseSchema.parse(
      (await f.manager.get('/api/v1/notifications', f.host)).body,
    );
    expect(inbox.items[0]).toMatchObject({
      type: 'expenses.submitted',
      params: { number: 'EX-0001', total: '44.500' },
    });
  });
});

describe('deciding and reimbursing', () => {
  it('lets the line manager decide, never their own, and finance reimburse once', async () => {
    const f = await firm();
    const r = await claim(f, await receipt(f, f.a));
    ok(await f.a.post(`/api/v1/expenses/${r.id}/submit`, {}, f.host));

    // Not my own; not outside my team; not another company.
    expect((await f.a.post(`/api/v1/expenses/${r.id}/approve`, {}, f.host)).status).toBe(403);
    expect((await f.b.get(`/api/v1/expenses/${r.id}`, f.host)).status).toBe(404);
    const g = await founder();
    expect((await g.owner.get(`/api/v1/expenses/${r.id}`, g.host)).status).toBe(404);
    expect((await g.owner.post(`/api/v1/expenses/${r.id}/approve`, {}, g.host)).status).toBe(404);

    const approvals = expenseListResponseSchema.parse(
      (await f.manager.get('/api/v1/expenses?view=approvals', f.host)).body,
    );
    expect(approvals.items.map((i) => i.id)).toEqual([r.id]);
    expect((await f.manager.post(`/api/v1/expenses/${r.id}/reject`, {}, f.host)).status).toBe(422);
    const rejected = ok(
      await f.manager.post(`/api/v1/expenses/${r.id}/reject`, { note: 'Split the taxi' }, f.host),
    );
    expect(rejected).toMatchObject({ status: 'rejected', decisionNote: 'Split the taxi' });
    const reopened = ok(await f.a.post(`/api/v1/expenses/${r.id}/reopen`, {}, f.host));
    expect(reopened.status).toBe('draft');
    const again = ok(await f.a.post(`/api/v1/expenses/${r.id}/submit`, {}, f.host));
    expect(again.number).toBe('EX-0001');
    const approved = ok(await f.manager.post(`/api/v1/expenses/${r.id}/approve`, {}, f.host));
    expect(approved).toMatchObject({ status: 'approved', decidedByName: 'manager' });

    // Managers don't reimburse; the database refuses reimbursing a claim that isn't approved
    // and self-decisions even if the API were bypassed.
    expect(
      (
        await f.manager.post(
          `/api/v1/expenses/${r.id}/reimburse`,
          { reimbursedOn: today, method: 'bank_transfer' },
          f.host,
        )
      ).status,
    ).toBe(403);
    await expect(
      admin.query(
        `update expense_claims set decided_by_membership_id = membership_id where id = $1`,
        [r.id],
      ),
    ).rejects.toThrow(/not_own_decision/);
    const paid = ok(
      await f.owner.post(
        `/api/v1/expenses/${r.id}/reimburse`,
        { reimbursedOn: today, method: 'bank_transfer', reference: 'TRX-9' },
        f.host,
      ),
    );
    expect(paid.status).toBe('reimbursed');
    expect(paid.reimbursement).toMatchObject({ method: 'bank_transfer', reference: 'TRX-9' });
    expect(
      (
        await f.owner.post(
          `/api/v1/expenses/${r.id}/reimburse`,
          { reimbursedOn: today, method: 'cash' },
          f.host,
        )
      ).status,
    ).toBe(409);
    await expect(
      admin.query(`update expense_claims set status = 'approved' where id = $1`, [r.id]),
    ).rejects.toThrow(/cannot go from reimbursed/);
    const inbox = notificationListResponseSchema.parse(
      (await f.a.get('/api/v1/notifications', f.host)).body,
    );
    expect(inbox.items.map((n) => n.type)).toEqual(
      expect.arrayContaining(['expenses.decided', 'expenses.reimbursed']),
    );
  });
});

describe('project cost and re-billing', () => {
  it('counts approved expenses on the project and re-bills billable ones once', async () => {
    const f = await firm();
    const r = await claim(f, await receipt(f, f.a));
    ok(await f.a.post(`/api/v1/expenses/${r.id}/submit`, {}, f.host));

    const pending = projectExpensesSchema.parse(
      (await f.manager.get(`/api/v1/projects/${f.projectId}/expenses`, f.host)).body,
    );
    expect(pending).toMatchObject({ approved: '0.000', pending: '40.000' });
    expect((await f.a.get(`/api/v1/projects/${f.projectId}/expenses`, f.host)).status).toBe(403);

    const before = dashboardSummarySchema.parse(
      (await f.manager.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(before.expenses?.waitingForMe).toBe(1);
    ok(await f.manager.post(`/api/v1/expenses/${r.id}/approve`, {}, f.host));
    const owner = dashboardSummarySchema.parse(
      (await f.owner.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(owner.expenses?.toReimburse).toEqual({ count: 1, amount: '44.500' });

    const range = { projectId: f.projectId, from: today, to: today, hourlyRate: '25.000' };
    // Without expenses there is nothing billable (no approved time in this test).
    expect((await f.owner.post('/api/v1/invoices/from-time', range, f.host)).status).toBe(422);
    const res = await f.owner.post(
      '/api/v1/invoices/from-time',
      { ...range, includeExpenses: true },
      f.host,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = invoiceSchema.parse(res.body);
    expect(inv).toMatchObject({ total: '40.000', expenseLines: 1, timeEntries: 0 });
    expect(inv.lines[0]?.description).toContain('Filing fee');
    // Once only.
    expect(
      (
        await f.owner.post(
          '/api/v1/invoices/from-time',
          { ...range, includeExpenses: true },
          f.host,
        )
      ).status,
    ).toBe(422);
    const cost = projectExpensesSchema.parse(
      (await f.manager.get(`/api/v1/projects/${f.projectId}/expenses`, f.host)).body,
    );
    expect(cost).toMatchObject({ approved: '40.000', billable: '40.000', invoiced: '40.000' });

    // Issue, then void: the expense is released and can be re-billed again.
    expect((await f.owner.post(`/api/v1/invoices/${inv.id}/issue`, {}, f.host)).status).toBe(200);
    expect(
      (await f.owner.post(`/api/v1/invoices/${inv.id}/void`, { reason: 'Wrong client' }, f.host))
        .status,
    ).toBe(200);
    const released = projectExpensesSchema.parse(
      (await f.manager.get(`/api/v1/projects/${f.projectId}/expenses`, f.host)).body,
    );
    expect(released.invoiced).toBe('0.000');
    expect(
      (
        await f.owner.post(
          '/api/v1/invoices/from-time',
          { ...range, includeExpenses: true },
          f.host,
        )
      ).status,
    ).toBe(201);
  });
});
