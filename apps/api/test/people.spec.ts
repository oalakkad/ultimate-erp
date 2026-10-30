import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  checklistResponseSchema,
  departmentListResponseSchema,
  type Employee,
  employeeHistorySchema,
  employeeListResponseSchema,
  employeeSchema,
  errorResponseSchema,
  orgChartSchema,
  privateDetailsResponseSchema,
  projectSchema,
  taskSchema,
  teamListResponseSchema,
  timeEntrySchema,
  timesheetSchema,
  timeSummarySchema,
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

// Phase 8 acceptance (docs/modules/people.md §8) against real Postgres + Mailpit.

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

interface Firm {
  owner: Person;
  ownerId: string;
  manager: Person;
  managerId: string;
  lead: Person;
  leadId: string;
  a: Person;
  aId: string;
  b: Person;
  bId: string;
  host: string;
}

async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const lead = await person('lead');
  const leadId = await join(lead, host, owner, 'team_leader');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const b = await person('empb');
  const bId = await join(b, host, owner, 'employee');
  const me = (await owner.get('/api/v1/access/me', host)).body as { membershipId: string };
  return {
    owner,
    ownerId: me.membershipId,
    manager,
    managerId,
    lead,
    leadId,
    a,
    aId,
    b,
    bId,
    host,
  };
}

const ok = (res: { status: number; body: unknown }, status = 200): Employee => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return employeeSchema.parse(res.body);
};
const record = (f: Firm, membershipId: string, extra: object = {}) =>
  f.owner.post(
    '/api/v1/people',
    { membershipId, jobTitleEn: 'Auditor', jobTitleAr: 'مدقق', ...extra },
    f.host,
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

describe('employee records', () => {
  it('creates a numbered record with an onboarding checklist and history', async () => {
    const f = await firm();
    const e = ok(await record(f, f.aId, { joinDate: '2026-10-01' }), 201);
    expect(e).toMatchObject({
      number: 'E-0001',
      status: 'onboarding',
      jobTitle: { en: 'Auditor', ar: 'مدقق' },
    });
    expect(e.details).toMatchObject({
      employmentType: 'full_time',
      weeklyHours: '40',
      workDays: [0, 1, 2, 3, 4],
    });
    expect((await record(f, f.aId)).status).toBe(409);
    expect((await f.a.post('/api/v1/people', { membershipId: f.bId }, f.host)).status).toBe(403);

    const checklist = checklistResponseSchema.parse(
      (await f.owner.get(`/api/v1/people/${f.aId}/checklist`, f.host)).body,
    );
    expect(checklist.items.map((i) => i.title)).toContain('builtin:contract_signed');
    const history = employeeHistorySchema.parse(
      (await f.owner.get(`/api/v1/people/${f.aId}/history`, f.host)).body,
    );
    expect(history.items.map((h) => h.kind)).toEqual(['joined']);

    const edited = ok(
      await f.owner.patch(
        `/api/v1/people/${f.aId}`,
        { jobTitleEn: 'Senior auditor', weeklyHours: '35', version: e.version },
        f.host,
      ),
    );
    expect(edited.jobTitle.en).toBe('Senior auditor');
    const after = employeeHistorySchema.parse(
      (await f.owner.get(`/api/v1/people/${f.aId}/history`, f.host)).body,
    );
    expect(after.items[0]?.changes).toMatchObject({
      jobTitleEn: { from: 'Auditor', to: 'Senior auditor' },
      weeklyHours: { to: '35' },
    });
  });

  it('shows the directory, employment details and private data only to the right people', async () => {
    const f = await firm();
    for (const id of [f.aId, f.bId, f.leadId, f.managerId]) ok(await record(f, id), 201);
    const a = ok(await f.owner.get(`/api/v1/people/${f.aId}`, f.host));
    ok(
      await f.owner.patch(
        `/api/v1/people/${f.aId}`,
        { managerMembershipId: f.managerId, version: a.version },
        f.host,
      ),
    );
    const teams = teamListResponseSchema.parse(
      (
        await f.owner.post(
          '/api/v1/teams',
          { nameEn: 'Audit A', nameAr: 'تدقيق أ', leadMembershipId: f.leadId },
          f.host,
        )
      ).body,
    );
    const teamId = teams.items[0]?.id ?? '';
    await f.owner.put(`/api/v1/teams/${teamId}/members`, { memberIds: [f.aId] }, f.host);

    // Employee: only themself.
    const own = employeeListResponseSchema.parse((await f.a.get('/api/v1/people', f.host)).body);
    expect(own.items.map((i) => i.membershipId)).toEqual([f.aId]);
    expect((await f.a.get(`/api/v1/people/${f.bId}`, f.host)).status).toBe(404);
    expect(ok(await f.a.get(`/api/v1/people/${f.aId}`, f.host)).details).not.toBeNull();

    // Team lead: their team (directory only), not B.
    const led = employeeListResponseSchema.parse((await f.lead.get('/api/v1/people', f.host)).body);
    expect(led.items.map((i) => i.membershipId).sort()).toEqual([f.aId, f.leadId].sort());
    const aForLead = ok(await f.lead.get(`/api/v1/people/${f.aId}`, f.host));
    expect(aForLead.details).toBeNull();
    expect(aForLead.email).toBe('');
    expect((await f.lead.get(`/api/v1/people/${f.aId}/history`, f.host)).status).toBe(403);
    expect((await f.lead.get(`/api/v1/people/${f.aId}/private`, f.host)).status).toBe(403);

    // A's manager: employment details, but no private data.
    const aForManager = ok(await f.manager.get(`/api/v1/people/${f.aId}`, f.host));
    expect(aForManager.details).not.toBeNull();
    expect(aForManager.canSeeRestricted).toBe(false);
    expect((await f.manager.get(`/api/v1/people/${f.aId}/private`, f.host)).status).toBe(403);
    expect((await f.manager.get(`/api/v1/people/${f.bId}`, f.host)).status).toBe(404);

    // Another company: not found.
    const g = await founder();
    expect((await g.owner.get(`/api/v1/people/${f.aId}`, g.host)).status).toBe(404);
  });

  it('stores private details encrypted, audits reads and refuses a duplicate civil ID', async () => {
    const f = await firm();
    ok(await record(f, f.aId), 201);
    ok(await record(f, f.bId), 201);
    const saved = privateDetailsResponseSchema.parse(
      (
        await f.a.put(
          `/api/v1/people/${f.aId}/private`,
          {
            civilId: '290010112345',
            iban: 'KW81CBKU0000000000001234560101',
            nationality: 'Kuwaiti',
          },
          f.host,
        )
      ).body,
    );
    expect(saved.details.civilId).toBe('290010112345');
    const { rows } = await admin.query<{ row: string }>(
      `select row_to_json(p)::text as row from employee_private p`,
    );
    expect(rows[0]?.row).toBeDefined();
    expect(rows[0]?.row).not.toContain('290010112345');
    expect(rows[0]?.row).not.toContain('KW81');

    const read = privateDetailsResponseSchema.parse(
      (await f.owner.get(`/api/v1/people/${f.aId}/private`, f.host)).body,
    );
    expect(read.details).toMatchObject({ civilId: '290010112345', nationality: 'Kuwaiti' });
    const audits = await admin.query(
      `select 1 from audit_events where action = 'people.private.read' and target_id = $1::uuid`,
      [f.aId],
    );
    expect(audits.rowCount).toBe(1);
    // Audit details never contain the values.
    const updates = await admin.query<{ details: unknown }>(
      `select details from audit_events where action = 'people.private.updated'`,
    );
    expect(JSON.stringify(updates.rows)).not.toContain('290010112345');

    const dup = await f.owner.put(
      `/api/v1/people/${f.bId}/private`,
      { civilId: '2900 1011 2345' },
      f.host,
    );
    expect(dup.status).toBe(409);
    expect(errorOf(dup.body).details?.[0]?.code).toBe('duplicate');
    // Others cannot write someone else's private data.
    expect(
      (await f.b.put(`/api/v1/people/${f.aId}/private`, { nationality: 'x' }, f.host)).status,
    ).toBe(404);
  });
});

describe('organisation and status', () => {
  it('refuses reporting loops and builds the organisation view', async () => {
    const f = await firm();
    ok(await record(f, f.aId), 201);
    const m = ok(await record(f, f.managerId), 201);
    const a = ok(await f.owner.get(`/api/v1/people/${f.aId}`, f.host));
    ok(
      await f.owner.patch(
        `/api/v1/people/${f.aId}`,
        { managerMembershipId: f.managerId, version: a.version },
        f.host,
      ),
    );
    const loop = await f.owner.patch(
      `/api/v1/people/${f.managerId}`,
      { managerMembershipId: f.aId, version: m.version },
      f.host,
    );
    expect(loop.status).toBe(409);
    expect(errorOf(loop.body).details?.[0]?.code).toBe('cycle');

    const depts = departmentListResponseSchema.parse(
      (await f.owner.post('/api/v1/departments', { nameEn: 'Audit', nameAr: 'التدقيق' }, f.host))
        .body,
    );
    expect(depts.items[0]?.name.ar).toBe('التدقيق');
    expect(
      (await f.a.post('/api/v1/departments', { nameEn: 'x', nameAr: 'x' }, f.host)).status,
    ).toBe(403);
    const chart = orgChartSchema.parse((await f.owner.get('/api/v1/org-chart', f.host)).body);
    expect(chart.nodes.find((n) => n.membershipId === f.aId)?.managerMembershipId).toBe(
      f.managerId,
    );
  });

  it('runs the employment lifecycle; leaving suspends access and clears teams', async () => {
    const f = await firm();
    const e = ok(await record(f, f.aId), 201);
    expect(e.nextStatuses).toEqual(['active', 'left']);
    const teams = teamListResponseSchema.parse(
      (await f.owner.post('/api/v1/teams', { nameEn: 'T', nameAr: 'ت' }, f.host)).body,
    );
    await f.owner.put(
      `/api/v1/teams/${teams.items[0]?.id ?? ''}/members`,
      { memberIds: [f.aId] },
      f.host,
    );

    ok(await f.owner.post(`/api/v1/people/${f.aId}/status`, { status: 'active' }, f.host));
    expect(
      (await f.owner.post(`/api/v1/people/${f.aId}/status`, { status: 'left' }, f.host)).status,
    ).toBe(409);
    ok(
      await f.owner.post(
        `/api/v1/people/${f.aId}/status`,
        { status: 'offboarding', leaveDate: kuwaitToday() },
        f.host,
      ),
    );
    const checklist = checklistResponseSchema.parse(
      (await f.owner.get(`/api/v1/people/${f.aId}/checklist`, f.host)).body,
    );
    expect(checklist.items.some((i) => i.title === 'builtin:handover_done')).toBe(true);
    const left = ok(
      await f.owner.post(`/api/v1/people/${f.aId}/status`, { status: 'left' }, f.host),
    );
    expect(left.status).toBe('left');
    expect(left.actions).toEqual([]);
    expect((await f.a.get('/api/v1/people', f.host)).status).toBe(404);
    const after = teamListResponseSchema.parse((await f.owner.get('/api/v1/teams', f.host)).body);
    expect(after.items[0]?.members).toEqual([]);

    // Nobody marks themselves as left; the last Owner cannot leave.
    ok(await record(f, f.ownerId), 201);
    ok(await f.owner.post(`/api/v1/people/${f.ownerId}/status`, { status: 'active' }, f.host));
    ok(
      await f.owner.post(
        `/api/v1/people/${f.ownerId}/status`,
        { status: 'offboarding', leaveDate: kuwaitToday() },
        f.host,
      ),
    );
    expect(
      (await f.owner.post(`/api/v1/people/${f.ownerId}/status`, { status: 'left' }, f.host)).status,
    ).toBe(403);
  });

  it('turns contracted hours into capacity and utilisation', async () => {
    const f = await firm();
    ok(await record(f, f.aId, { weeklyHours: '40' }), 201);
    const client = await f.owner.post(
      '/api/v1/clients',
      { legalNameEn: 'Gulf Co', legalNameAr: 'شركة الخليج' },
      f.host,
    );
    const project = projectSchema.parse(
      (
        await f.owner.post(
          '/api/v1/projects',
          {
            clientId: (client.body as { id: string }).id,
            nameEn: 'P',
            nameAr: 'م',
            managerMembershipId: f.managerId,
            budgetHours: '100',
            memberIds: [f.aId],
          },
          f.host,
        )
      ).body,
    );
    const task = taskSchema.parse(
      (
        await f.manager.post(
          '/api/v1/tasks',
          {
            projectId: project.id,
            title: 'Work',
            allocations: [{ membershipId: f.aId, hours: '20' }],
          },
          f.host,
        )
      ).body,
    );
    const entry = timeEntrySchema.parse(
      (
        await f.a.post(
          '/api/v1/time-entries',
          { taskId: task.id, workDate: kuwaitToday(), hours: '8' },
          f.host,
        )
      ).body,
    );
    const sheet = timesheetSchema.parse((await f.a.get('/api/v1/timesheets/mine', f.host)).body);
    await f.a.post(`/api/v1/timesheets/${sheet.id ?? ''}/submit`, {}, f.host);
    await f.manager.post('/api/v1/time-entries/approve', { ids: [entry.id] }, f.host);
    const from = weekStartOf(kuwaitToday());
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const summary = timeSummarySchema.parse(
      (await f.a.get(`/api/v1/time/summary?from=${from}&to=${to}`, f.host)).body,
    );
    expect(summary).toMatchObject({ capacity: '40', utilisationPercent: 20 });
  });
});
