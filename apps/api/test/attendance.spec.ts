import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  attendanceSummarySchema,
  attendanceTodaySchema,
  correctionListResponseSchema,
  correctionSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  kioskCodeSchema,
  leaveRequestSchema,
  leaveTypeListResponseSchema,
  myAttendanceSchema,
  shiftListResponseSchema,
  siteListResponseSchema,
  teamListResponseSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { KioskCodes } from '../src/modules/attendance/attendance.service.js';
import { kuwaitToday } from '../src/modules/contracts/contracts.service.js';
import { weekStartOf } from '../src/modules/time/time.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 10 acceptance (docs/modules/attendance.md §6) against real Postgres + Mailpit.

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
  lead: Person;
  leadId: string;
  a: Person;
  aId: string;
  b: Person;
  bId: string;
  host: string;
  tenantId: string;
  siteId: string;
  shiftId: string;
}

/** Owner; team lead with A in the team; B outside; one site; a 08:00–16:00 shift for A. */
async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const lead = await person('lead');
  const leadId = await join(lead, host, owner, 'team_leader');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const b = await person('empb');
  const bId = await join(b, host, owner, 'employee');
  for (const id of [leadId, aId, bId]) {
    expect(
      (await owner.post('/api/v1/people', { membershipId: id, joinDate: '2026-01-01' }, host))
        .status,
    ).toBe(201);
  }
  const teams = teamListResponseSchema.parse(
    (
      await owner.post(
        '/api/v1/teams',
        { nameEn: 'T', nameAr: 'ت', leadMembershipId: leadId },
        host,
      )
    ).body,
  );
  await owner.put(`/api/v1/teams/${teams.items[0]?.id ?? ''}/members`, { memberIds: [aId] }, host);
  const sites = siteListResponseSchema.parse(
    (
      await owner.post(
        '/api/v1/attendance/sites',
        { nameEn: 'Head office', nameAr: 'المكتب الرئيسي' },
        host,
      )
    ).body,
  );
  const shifts = shiftListResponseSchema.parse(
    (
      await owner.post(
        '/api/v1/attendance/shifts',
        {
          nameEn: 'Day',
          nameAr: 'نهاري',
          startTime: '08:00',
          endTime: '16:00',
          graceMinutes: 10,
          breakMinutes: 60,
        },
        host,
      )
    ).body,
  );
  const shiftId = shifts.items[0]?.id ?? '';
  await owner.put(`/api/v1/attendance/assignments/${aId}`, { shiftId }, host);
  const tenantId = ((await owner.get('/api/v1/access/me', host)).body as { tenantId: string })
    .tenantId;
  return {
    owner,
    lead,
    leadId,
    a,
    aId,
    b,
    bId,
    host,
    tenantId,
    siteId: sites.items[0]?.id ?? '',
    shiftId,
  };
}

const kioskCode = async (f: Firm) =>
  kioskCodeSchema.parse(
    (await f.owner.get(`/api/v1/attendance/sites/${f.siteId}/code`, f.host)).body,
  );
const check = (p: Person, f: Firm, code?: string) =>
  p.post('/api/v1/attendance/check', code === undefined ? {} : { code }, f.host);

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

describe('kiosk codes', () => {
  it('checks in with a fresh signed code and refuses replays, forgeries, old codes and strangers', async () => {
    const f = await firm();
    const kiosk = await kioskCode(f);
    expect(kiosk.rotationSeconds).toBe(30);
    expect(kiosk.expiresInSeconds).toBeGreaterThan(0);
    expect((await f.a.get(`/api/v1/attendance/sites/${f.siteId}/code`, f.host)).status).toBe(403);

    const first = await check(f.a, f, kiosk.code);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const day = myAttendanceSchema.parse(first.body);
    expect(day.events).toHaveLength(1);
    expect(day.events[0]).toMatchObject({ kind: 'in', method: 'qr', site: { en: 'Head office' } });
    expect(day.next).toBe('out');

    const replay = await check(f.a, f, kiosk.code);
    expect(replay.status).toBe(409);
    expect(errorOf(replay.body).details?.[0]?.code).toBe('code_used');

    const forged = await check(
      f.b,
      f,
      kiosk.code.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
    );
    expect(errorOf(forged.body).details?.[0]?.code).toBe('invalid_or_expired');
    const codes = app.get(KioskCodes);
    const old = codes.sign(f.tenantId, f.siteId, codes.window(Date.now(), 30) - 2);
    expect(errorOf((await check(f.b, f, old)).body).details?.[0]?.code).toBe('invalid_or_expired');
    // A code of another company does not work here.
    const g = await founder();
    expect(
      (await g.owner.post('/api/v1/attendance/check', { code: kiosk.code }, g.host)).status,
    ).toBe(422);
    const otherTenant = (
      (await g.owner.get('/api/v1/access/me', g.host)).body as { tenantId: string }
    ).tenantId;
    expect(codes.verify(otherTenant, kiosk.code, Date.now(), 30)).toBeNull();
    expect(codes.verify(f.tenantId, kiosk.code, Date.now(), 30)).not.toBeNull();
    // Not signed in: nothing works.
    expect(
      (
        await request(server)
          .post('/api/v1/attendance/check')
          .set('Host', f.host)
          .send({ code: kiosk.code })
      ).status,
    ).toBe(401);
  });

  it('alternates in and out, refuses double taps, and honours the web setting', async () => {
    const f = await firm();
    expect(myAttendanceSchema.parse((await check(f.b, f)).body).events[0]).toMatchObject({
      kind: 'in',
      method: 'web',
    });
    const soon = await check(f.b, f);
    expect(soon.status).toBe(409);
    expect(errorOf(soon.body).details?.[0]?.code).toBe('too_soon');
    await f.owner.patch('/api/v1/attendance/settings', { minMinutesBetween: 0 }, f.host);
    const out = myAttendanceSchema.parse((await check(f.b, f)).body);
    expect(out.events.map((e) => e.kind)).toEqual(['in', 'out']);

    await f.owner.patch('/api/v1/attendance/settings', { allowWeb: false }, f.host);
    const blocked = await check(f.b, f);
    expect(errorOf(blocked.body).details?.[0]?.code).toBe('qr_required');
    expect(
      (await f.b.patch('/api/v1/attendance/settings', { allowWeb: true }, f.host)).status,
    ).toBe(403);
  });
});

describe('days and corrections', () => {
  it('computes late, early, worked, absent and leave days against the shift', async () => {
    const f = await firm();
    const sunday = shift(weekStartOf(kuwaitToday()), -7);
    await admin.query(
      `insert into attendance_events (tenant_id, membership_id, kind, at, method)
       values ($1::uuid, $2::uuid, 'in', $3::timestamptz, 'web'), ($1::uuid, $2::uuid, 'out', $4::timestamptz, 'web')`,
      [f.tenantId, f.aId, `${sunday}T08:25:00+03:00`, `${sunday}T15:30:00+03:00`],
    );
    // Tuesday: approved unpaid leave.
    const types = leaveTypeListResponseSchema.parse(
      (await f.a.get('/api/v1/leave/types', f.host)).body,
    );
    const unpaid = types.items.find((t) => t.code === 'unpaid')?.id ?? '';
    const leave = leaveRequestSchema.parse(
      (
        await f.a.post(
          '/api/v1/leave/requests',
          { leaveTypeId: unpaid, startDate: shift(sunday, 2), endDate: shift(sunday, 2) },
          f.host,
        )
      ).body,
    );
    await f.lead.post(`/api/v1/leave/requests/${leave.id}/approve`, {}, f.host);

    const summary = attendanceSummarySchema.parse(
      (await f.a.get(`/api/v1/attendance/summary?from=${sunday}&to=${shift(sunday, 6)}`, f.host))
        .body,
    );
    const [sun, mon, tue, , , fri] = summary.days;
    expect(sun).toMatchObject({
      status: 'present',
      lateMinutes: 25,
      earlyMinutes: 30,
      workedMinutes: 365,
    });
    expect(mon?.status).toBe('absent');
    expect(tue?.status).toBe('leave');
    expect(fri?.status).toBe('weekend');
    expect(summary.totals).toMatchObject({ present: 1, late: 1, early: 1, leave: 1 });
    // B's summary is not visible to the lead (outside the team); the Owner sees it.
    expect(
      (
        await f.lead.get(
          `/api/v1/attendance/summary?from=${sunday}&to=${sunday}&membershipId=${f.bId}`,
          f.host,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await f.owner.get(
          `/api/v1/attendance/summary?from=${sunday}&to=${sunday}&membershipId=${f.bId}`,
          f.host,
        )
      ).status,
    ).toBe(200);
  });

  it('adds a missed check-in through an approved correction, never self-approved', async () => {
    const f = await firm();
    const yesterday = shift(kuwaitToday(), -1);
    const asked = correctionSchema.parse(
      (
        await f.a.post(
          '/api/v1/attendance/corrections',
          { kind: 'in', at: `${yesterday}T08:05:00+03:00`, reason: 'Kiosk was off' },
          f.host,
        )
      ).body,
    );
    expect(asked.status).toBe('pending');
    expect(
      (
        await f.a.post(
          '/api/v1/attendance/corrections',
          { kind: 'in', at: '2099-01-01T08:00:00+03:00', reason: 'x' },
          f.host,
        )
      ).status,
    ).toBe(422);
    const waiting = correctionListResponseSchema.parse(
      (await f.lead.get('/api/v1/attendance/corrections?view=approvals', f.host)).body,
    );
    expect(waiting.items.map((i) => i.id)).toEqual([asked.id]);
    expect(
      (await f.b.post(`/api/v1/attendance/corrections/${asked.id}/approve`, {}, f.host)).status,
    ).toBe(403);

    const approved = correctionSchema.parse(
      (await f.lead.post(`/api/v1/attendance/corrections/${asked.id}/approve`, {}, f.host)).body,
    );
    expect(approved.status).toBe('approved');
    const day = attendanceSummarySchema.parse(
      (await f.a.get(`/api/v1/attendance/summary?from=${yesterday}&to=${yesterday}`, f.host)).body,
    ).days[0];
    expect(day?.firstIn).not.toBeNull();
    expect(
      (await f.lead.post(`/api/v1/attendance/corrections/${asked.id}/approve`, {}, f.host)).status,
    ).toBe(409);

    const own = correctionSchema.parse(
      (
        await f.lead.post(
          '/api/v1/attendance/corrections',
          { kind: 'out', at: `${yesterday}T16:00:00+03:00`, reason: 'Forgot' },
          f.host,
        )
      ).body,
    );
    expect(
      (await f.lead.post(`/api/v1/attendance/corrections/${own.id}/approve`, {}, f.host)).status,
    ).toBe(403);
    expect(
      (await f.owner.post(`/api/v1/attendance/corrections/${own.id}/reject`, {}, f.host)).status,
    ).toBe(422);
    const rejected = correctionSchema.parse(
      (
        await f.owner.post(
          `/api/v1/attendance/corrections/${own.id}/reject`,
          { note: 'Badge shows 15:00' },
          f.host,
        )
      ).body,
    );
    expect(rejected).toMatchObject({ status: 'rejected', note: 'Badge shows 15:00' });
    // The database refuses a self-decision too.
    const { rows } = await admin.query<{ user_id: string }>(
      `select user_id from memberships where id = $1::uuid`,
      [f.aId],
    );
    const third = correctionSchema.parse(
      (
        await f.a.post(
          '/api/v1/attendance/corrections',
          { kind: 'out', at: `${yesterday}T16:00:00+03:00`, reason: 'Forgot' },
          f.host,
        )
      ).body,
    );
    await expect(
      admin.query(
        `update attendance_corrections set status = 'approved', decided_by_user_id = $1::uuid where id = $2::uuid`,
        [rows[0]?.user_id, third.id],
      ),
    ).rejects.toThrow(/own attendance correction/);
    // Events are append-only for the app.
    const appClient = new pg.Client({ connectionString: database.appUrl });
    await appClient.connect();
    await expect(appClient.query('delete from attendance_events')).rejects.toThrow(
      /permission denied/,
    );
    await appClient.end();
  });
});

describe('today board', () => {
  it('shows the lead their team, employees only themselves, and counts on the dashboard', async () => {
    const f = await firm();
    await check(f.a, f, (await kioskCode(f)).code);
    const board = attendanceTodaySchema.parse(
      (await f.lead.get('/api/v1/attendance/today', f.host)).body,
    );
    expect(board.items.map((i) => i.membershipId).sort()).toEqual([f.aId, f.leadId].sort());
    expect(board.items.find((i) => i.membershipId === f.aId)?.state).toBe('in');
    const own = attendanceTodaySchema.parse(
      (await f.b.get('/api/v1/attendance/today', f.host)).body,
    );
    expect(own.items.map((i) => i.membershipId)).toEqual([f.bId]);
    const dash = dashboardSummarySchema.parse(
      (await f.owner.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(dash.attendance?.inNow).toBe(1);
  });
});
