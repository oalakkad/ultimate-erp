import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  dashboardSummarySchema,
  errorResponseSchema,
  leaveBalanceSchema,
  leaveCalendarSchema,
  leaveListResponseSchema,
  leavePreviewSchema,
  leaveRequestSchema,
  leaveTypeListResponseSchema,
  notificationListResponseSchema,
  teamListResponseSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { kuwaitToday } from '../src/modules/contracts/contracts.service.js';
import { weekStartOf } from '../src/modules/time/time.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 9 acceptance (docs/modules/leave.md §8) against real Postgres + Mailpit.

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
/** Sunday of the week after next — always in the future, Sunday–Thursday working days. */
const sunday = (weeksAhead = 2) => shift(weekStartOf(kuwaitToday()), 7 * weeksAhead);
const year = Number(kuwaitToday().slice(0, 4));

interface Firm {
  owner: Person;
  lead: Person;
  leadId: string;
  a: Person;
  aId: string;
  b: Person;
  bId: string;
  host: string;
  studyId: string;
  types: Map<string, string>;
}

/** Owner; team lead with employee A in their team; employee B outside it; a 5-day "study" type. */
async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const lead = await person('lead');
  const leadId = await join(lead, host, owner, 'team_leader');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const b = await person('empb');
  const bId = await join(b, host, owner, 'employee');
  for (const id of [leadId, aId, bId]) {
    const res = await owner.post(
      '/api/v1/people',
      { membershipId: id, joinDate: `${year}-01-01` },
      host,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  const teams = teamListResponseSchema.parse(
    (
      await owner.post(
        '/api/v1/teams',
        { nameEn: 'Audit', nameAr: 'تدقيق', leadMembershipId: leadId },
        host,
      )
    ).body,
  );
  await owner.put(`/api/v1/teams/${teams.items[0]?.id ?? ''}/members`, { memberIds: [aId] }, host);
  const list = leaveTypeListResponseSchema.parse(
    (
      await owner.post(
        '/api/v1/leave/types',
        {
          code: 'study',
          nameEn: 'Study leave',
          nameAr: 'إجازة دراسية',
          paid: true,
          deductsBalance: true,
          annualDays: '5',
          accrual: 'none',
          allowHalfDay: true,
          requiresDocument: false,
          allowNegative: false,
        },
        host,
      )
    ).body,
  );
  const types = new Map(list.items.map((t) => [t.code, t.id]));
  return { owner, lead, leadId, a, aId, b, bId, host, studyId: types.get('study') ?? '', types };
}

const apply = (p: Person, f: Firm, startDate: string, endDate: string, extra: object = {}) =>
  p.post(
    '/api/v1/leave/requests',
    { leaveTypeId: f.studyId, startDate, endDate, ...extra },
    f.host,
  );
const created = (res: { status: number; body: unknown }) => {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return leaveRequestSchema.parse(res.body);
};
const decided = (res: { status: number; body: unknown }) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return leaveRequestSchema.parse(res.body);
};
const studyBalance = async (p: Person, f: Firm, membershipId?: string) => {
  const q = membershipId ? `?membershipId=${membershipId}` : '';
  const b = leaveBalanceSchema.parse((await p.get(`/api/v1/leave/balances${q}`, f.host)).body);
  return b.items.find((i) => i.type.code === 'study');
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

describe('policies', () => {
  it('starts with flagged default types that only policy managers change', async () => {
    const f = await firm();
    const list = leaveTypeListResponseSchema.parse(
      (await f.a.get('/api/v1/leave/types', f.host)).body,
    );
    const annual = list.items.find((t) => t.code === 'annual');
    expect(annual).toMatchObject({ annualDays: '30', accrual: 'monthly', toVerify: true });
    expect(list.items.find((t) => t.code === 'unpaid')).toMatchObject({
      deductsBalance: false,
      paid: false,
    });
    expect(list.items.find((t) => t.code === 'sick')?.requiresDocument).toBe(true);
    expect(
      (await f.a.patch(`/api/v1/leave/types/${annual?.id ?? ''}`, { annualDays: '99' }, f.host))
        .status,
    ).toBe(403);
    const confirmed = leaveTypeListResponseSchema.parse(
      (
        await f.owner.patch(
          `/api/v1/leave/types/${annual?.id ?? ''}`,
          { confirmVerified: true },
          f.host,
        )
      ).body,
    );
    expect(confirmed.items.find((t) => t.code === 'annual')?.toVerify).toBe(false);

    // Annual leave accrues monthly from the joining date (1 January this year).
    const balance = leaveBalanceSchema.parse(
      (await f.a.get('/api/v1/leave/balances', f.host)).body,
    );
    const months = Number(kuwaitToday().slice(5, 7)) - 1;
    const expected = (30 * months) / 12;
    expect(Number(balance.items.find((i) => i.type.code === 'annual')?.accrued)).toBeCloseTo(
      expected,
      2,
    );
    expect(balance.items.find((i) => i.type.code === 'study')).toMatchObject({
      accrued: '5',
      balance: '5',
    });
  });
});

describe('applying', () => {
  it('counts working days without holidays, refuses overlaps, missing documents and too little balance', async () => {
    const f = await firm();
    const sun = sunday();
    const hYear = Number(shift(sun, 1).slice(0, 4));
    await f.owner.put(
      '/api/v1/leave/holidays',
      { year: hYear, holidays: [{ date: shift(sun, 1), nameEn: 'Holiday', nameAr: 'عطلة' }] },
      f.host,
    );

    const preview = leavePreviewSchema.parse(
      (
        await f.a.post(
          '/api/v1/leave/requests/preview',
          { leaveTypeId: f.studyId, startDate: sun, endDate: shift(sun, 2) },
          f.host,
        )
      ).body,
    );
    expect(preview).toMatchObject({
      days: '2',
      balanceBefore: '5',
      balanceAfter: '3',
      problems: [],
    });
    const half = leavePreviewSchema.parse(
      (
        await f.a.post(
          '/api/v1/leave/requests/preview',
          { leaveTypeId: f.studyId, startDate: sun, endDate: sun, halfDay: 'first' },
          f.host,
        )
      ).body,
    );
    expect(half.days).toBe('0.5');
    expect((await apply(f.a, f, sun, shift(sun, 2), { halfDay: 'first' })).status).toBe(422);
    // A weekend-only request has no working days.
    const weekend = await apply(f.a, f, shift(sun, 5), shift(sun, 6));
    expect(errorOf(weekend.body).details?.[0]?.code).toBe('no_working_days');

    const first = created(await apply(f.a, f, sun, shift(sun, 2), { reason: 'Exam' }));
    expect(first).toMatchObject({ days: '2', status: 'pending', actions: ['withdraw'] });
    const overlap = await apply(f.a, f, shift(sun, 2), shift(sun, 3));
    expect(overlap.status).toBe(409);
    expect(errorOf(overlap.body).details?.[0]?.code).toBe('overlap');
    const tooMuch = await apply(f.a, f, shift(sun, 7), shift(sun, 10));
    expect(errorOf(tooMuch.body).details?.[0]?.code).toBe('insufficient_balance');

    const sick = await f.a.post(
      '/api/v1/leave/requests',
      { leaveTypeId: f.types.get('sick'), startDate: shift(sun, 14), endDate: shift(sun, 14) },
      f.host,
    );
    expect(errorOf(sick.body).details?.[0]?.code).toBe('document_required');

    // The team lead is told.
    const inbox = notificationListResponseSchema.parse(
      (await f.lead.get('/api/v1/notifications', f.host)).body,
    );
    expect(inbox.items[0]?.type).toBe('leave.requested');
  });
});

describe('deciding', () => {
  it('lets the team lead approve once, deducting the balance exactly once', async () => {
    const f = await firm();
    const sun = sunday();
    const r = created(await apply(f.a, f, sun, shift(sun, 2)));
    expect((await studyBalance(f.a, f))?.pending).toBe('3');

    const waiting = leaveListResponseSchema.parse(
      (await f.lead.get('/api/v1/leave/requests?view=approvals', f.host)).body,
    );
    expect(waiting.items.map((i) => i.id)).toEqual([r.id]);
    const dash = dashboardSummarySchema.parse(
      (await f.lead.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(dash.leave?.waitingForMe).toBe(1);

    const ok = decided(await f.lead.post(`/api/v1/leave/requests/${r.id}/approve`, {}, f.host));
    expect(ok.status).toBe('approved');
    expect(await studyBalance(f.a, f)).toMatchObject({ taken: '3', balance: '2', pending: '0' });
    expect((await f.lead.post(`/api/v1/leave/requests/${r.id}/approve`, {}, f.host)).status).toBe(
      409,
    );
    // Even directly in the database, a request cannot be deducted twice.
    await expect(
      admin.query(
        `insert into leave_ledger (tenant_id, membership_id, leave_type_id, year, kind, days, request_id, created_by_user_id)
         select tenant_id, membership_id, leave_type_id, year, kind, days, request_id, created_by_user_id from leave_ledger where request_id = $1::uuid`,
        [r.id],
      ),
    ).rejects.toThrow(/duplicate key/);
    const inbox = notificationListResponseSchema.parse(
      (await f.a.get('/api/v1/notifications', f.host)).body,
    );
    expect(inbox.items[0]?.type).toBe('leave.approved');

    // Cancelling before it starts restores the balance once.
    const cancelled = decided(await f.a.post(`/api/v1/leave/requests/${r.id}/cancel`, {}, f.host));
    expect(cancelled.status).toBe('cancelled');
    expect(await studyBalance(f.a, f)).toMatchObject({ balance: '5', taken: '0' });
    expect((await f.a.post(`/api/v1/leave/requests/${r.id}/cancel`, {}, f.host)).status).toBe(409);
  });

  it("keeps decisions inside the team, never on one's own leave, and rejection deducts nothing", async () => {
    const f = await firm();
    const sun = sunday();
    const fromB = created(await apply(f.b, f, sun, sun));
    // B is not in the lead's team: the lead doesn't even see the request.
    expect(
      (await f.lead.post(`/api/v1/leave/requests/${fromB.id}/approve`, {}, f.host)).status,
    ).toBe(404);
    const own = created(await apply(f.lead, f, sun, sun));
    expect((await f.lead.post(`/api/v1/leave/requests/${own.id}/approve`, {}, f.host)).status).toBe(
      403,
    );
    // The Owner approves the lead; nobody, not even directly in the database, approves their own.
    decided(await f.owner.post(`/api/v1/leave/requests/${own.id}/approve`, {}, f.host));
    const { rows } = await admin.query<{ user_id: string }>(
      `select user_id from memberships where id = $1::uuid`,
      [f.bId],
    );
    await expect(
      admin.query(
        `update leave_requests set status = 'approved', decided_by_user_id = $1::uuid where id = $2::uuid`,
        [rows[0]?.user_id, fromB.id],
      ),
    ).rejects.toThrow(/their own leave/);

    const fromA = created(await apply(f.a, f, sun, shift(sun, 1)));
    expect(
      (await f.lead.post(`/api/v1/leave/requests/${fromA.id}/reject`, {}, f.host)).status,
    ).toBe(422);
    const rejected = decided(
      await f.lead.post(
        `/api/v1/leave/requests/${fromA.id}/reject`,
        { note: 'Busy season' },
        f.host,
      ),
    );
    expect(rejected).toMatchObject({ status: 'rejected', decisionNote: 'Busy season' });
    expect((await studyBalance(f.a, f))?.balance).toBe('5');

    const pending = created(await apply(f.a, f, shift(sun, 7), shift(sun, 7)));
    expect(
      decided(await f.a.post(`/api/v1/leave/requests/${pending.id}/withdraw`, {}, f.host)).status,
    ).toBe('withdrawn');

    const g = await founder();
    expect(
      (await g.owner.post(`/api/v1/leave/requests/${pending.id}/approve`, {}, g.host)).status,
    ).toBe(404);
  });
});

describe('calendar', () => {
  it("shows my team's leave and holidays, and only my own to employees", async () => {
    const f = await firm();
    const sun = sunday();
    await f.owner.put(
      '/api/v1/leave/holidays',
      {
        year: Number(shift(sun, 4).slice(0, 4)),
        holidays: [{ date: shift(sun, 4), nameEn: 'National Day', nameAr: 'العيد الوطني' }],
      },
      f.host,
    );
    created(await apply(f.a, f, sun, shift(sun, 1)));
    created(await apply(f.b, f, shift(sun, 2), shift(sun, 2)));
    const range = `from=${sun}&to=${shift(sun, 6)}`;
    const forLead = leaveCalendarSchema.parse(
      (await f.lead.get(`/api/v1/leave/calendar?${range}`, f.host)).body,
    );
    expect(forLead.leave.map((l) => l.person.membershipId)).toEqual([f.aId]);
    expect(forLead.holidays.map((h) => h.nameEn)).toEqual(['National Day']);
    const forB = leaveCalendarSchema.parse(
      (await f.b.get(`/api/v1/leave/calendar?${range}`, f.host)).body,
    );
    expect(forB.leave.map((l) => l.person.membershipId)).toEqual([f.bId]);
    const forOwner = leaveCalendarSchema.parse(
      (await f.owner.get(`/api/v1/leave/calendar?${range}`, f.host)).body,
    );
    expect(forOwner.leave).toHaveLength(2);
  });
});
