import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  dashboardSummarySchema,
  leaveRequestSchema,
  leaveTypeListResponseSchema,
  memberListResponseSchema,
  projectSchema,
  taskSchema,
  teamListResponseSchema,
  timesheetSchema,
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

// Dashboard lists (docs/modules/shell-dashboard.md §4): my next tasks, my week, project health
// and who is away — present only for the roles that should see them, scoped like their modules.

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
const shift = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => kuwaitToday();
const year = Number(today().slice(0, 4));

interface Firm {
  owner: Person;
  manager: Person;
  managerId: string;
  lead: Person;
  a: Person;
  aId: string;
  b: Person;
  bId: string;
  host: string;
  clientId: string;
  projectId: string;
  taskId: string;
}

const created = <T>(res: { status: number; body: unknown }, parse: (b: unknown) => T): T => {
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return parse(res.body);
};

/**
 * Owner; a Manager who runs "Statutory audit" (budget 100 h, A allocated 20 h, the manager 5 h);
 * a team lead whose team has employee A; employee B outside the team. A, B and the lead have
 * employee records (40 h weeks).
 */
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
  for (const id of [leadId, aId, bId]) {
    created(
      await owner.post('/api/v1/people', { membershipId: id, joinDate: `${year}-01-01` }, host),
      (x) => x,
    );
  }
  const teams = created(
    await owner.post(
      '/api/v1/teams',
      { nameEn: 'Audit', nameAr: 'تدقيق', leadMembershipId: leadId },
      host,
    ),
    (x) => teamListResponseSchema.parse(x),
  );
  await owner.put(`/api/v1/teams/${teams.items[0]?.id ?? ''}/members`, { memberIds: [aId] }, host);
  const client = created(
    await owner.post(
      '/api/v1/clients',
      { legalNameEn: 'Al Noor Trading', legalNameAr: 'شركة النور للتجارة' },
      host,
    ),
    (x) => x as { id: string },
  );
  const project = created(
    await owner.post(
      '/api/v1/projects',
      {
        clientId: client.id,
        nameEn: 'Statutory audit',
        nameAr: 'التدقيق القانوني',
        managerMembershipId: managerId,
        budgetHours: '100',
        billingMethod: 'time_and_materials',
        memberIds: [aId, bId],
      },
      host,
    ),
    (x) => projectSchema.parse(x),
  );
  const task = created(
    await manager.post(
      '/api/v1/tasks',
      {
        projectId: project.id,
        title: 'Inventory count',
        allocations: [
          { membershipId: aId, hours: '20' },
          { membershipId: managerId, hours: '5' },
        ],
      },
      host,
    ),
    (x) => taskSchema.parse(x),
  );
  return {
    owner,
    manager,
    managerId,
    lead,
    a,
    aId,
    b,
    bId,
    host,
    clientId: client.id,
    projectId: project.id,
    taskId: task.id,
  };
}

const summary = async (p: Person, f: Firm) => {
  const res = await p.get('/api/v1/dashboard/summary', f.host);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return dashboardSummarySchema.parse(res.body);
};

/** A task on the firm's project allocated to A, with a due date written directly (past dates). */
async function taskFor(f: Firm, title: string, dueDate: string | null) {
  const task = created(
    await f.manager.post(
      '/api/v1/tasks',
      { projectId: f.projectId, title, allocations: [{ membershipId: f.aId, hours: '1' }] },
      f.host,
    ),
    (x) => taskSchema.parse(x),
  );
  await admin.query('update tasks set due_date = $1 where id = $2', [dueDate, task.id]);
  return task.id;
}

/** Another open project led by the owner, budget `budget` hours, nobody else on it. */
async function otherProject(f: Firm, nameEn: string, budget: string) {
  const { members } = memberListResponseSchema.parse(
    (await f.owner.get('/api/v1/members', f.host)).body,
  );
  const ownerId = members.find((m) => m.email === f.owner.email)?.membershipId;
  return created(
    await f.owner.post(
      '/api/v1/projects',
      {
        clientId: f.clientId,
        nameEn,
        nameAr: `${nameEn} (ع)`,
        managerMembershipId: ownerId,
        budgetHours: budget,
        billingMethod: 'fixed_price',
      },
      f.host,
    ),
    (x) => projectSchema.parse(x),
  ).id;
}

/** The next Sunday–Thursday day after today, within the coming 7 days. */
function nextWorkingDay(): string {
  for (let n = 1; n <= 7; n += 1) {
    const d = shift(today(), n);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() <= 4) return d;
  }
  throw new Error('no working day ahead');
}

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

describe('dashboard lists', () => {
  it('lists my next tasks (overdue first, then soonest due) and my week day by day', async () => {
    const f = await firm();
    const later = await taskFor(f, 'Later', shift(today(), 10));
    const late = await taskFor(f, 'Late', shift(today(), -2));
    const soon = await taskFor(f, 'Soon', shift(today(), 1));
    const closed = await taskFor(f, 'Done already', shift(today(), -5));
    await admin.query(`update tasks set status = 'completed' where id = $1`, [closed]);

    // A logs 3.5 h today.
    const logged = await f.a.post(
      '/api/v1/time-entries',
      { taskId: f.taskId, workDate: today(), hours: '3.5' },
      f.host,
    );
    expect(logged.status, JSON.stringify(logged.body)).toBe(201);

    const mine = await summary(f.a, f);
    expect(mine.myTasks?.items.map((t) => t.id)).toEqual([late, soon, later, f.taskId]);
    expect(mine.myTasks?.items[0]).toMatchObject({
      title: 'Late',
      overdue: true,
      projectNameEn: 'Statutory audit',
      projectNameAr: 'التدقيق القانوني',
    });
    expect(mine.myTasks?.items[1]?.overdue).toBe(false);
    expect(mine.myTasks?.items[3]?.dueDate).toBeNull();

    const weekStart = weekStartOf(today());
    expect(mine.myWeek?.weekStart).toBe(weekStart);
    expect(mine.myWeek?.days).toHaveLength(7);
    expect(mine.myWeek?.days[0]?.date).toBe(weekStart);
    const byDate = new Map(mine.myWeek?.days.map((d) => [d.date, d.hours]));
    expect(byDate.get(today())).toBe('3.5');
    expect([...byDate.values()].filter((h) => h !== '0')).toEqual(['3.5']);
    expect(mine.myWeek?.weeklyTarget).toBe('40');

    // The Manager has no employee record → no weekly target; the task list holds only theirs.
    const manager = await summary(f.manager, f);
    expect(manager.myWeek?.weeklyTarget).toBeNull();
    expect(manager.myTasks?.items.map((t) => t.id)).toEqual([f.taskId]);
  });

  it('shows project health to owners (all projects, most budget used first) and managers (their own)', async () => {
    const f = await firm();
    const small = await otherProject(f, 'Small review', '10');
    const unbudgeted = await otherProject(f, 'Internal', '0');

    // A logs 4 h on the audit, submits, the manager approves → 4 h logged of 100.
    const entry = await f.a.post(
      '/api/v1/time-entries',
      { taskId: f.taskId, workDate: today(), hours: '4' },
      f.host,
    );
    const entryId = (entry.body as { id: string }).id;
    const sheet = timesheetSchema.parse((await f.a.get('/api/v1/timesheets/mine', f.host)).body);
    expect((await f.a.post(`/api/v1/timesheets/${sheet.id}/submit`, {}, f.host)).status).toBe(200);
    expect(
      (await f.manager.post('/api/v1/time-entries/approve', { ids: [entryId] }, f.host)).status,
    ).toBe(200);

    const owner = await summary(f.owner, f);
    expect(owner.projectHealth?.items.map((p) => p.id)).toEqual([f.projectId, small, unbudgeted]);
    expect(owner.projectHealth?.items[0]).toMatchObject({
      nameEn: 'Statutory audit',
      clientNameEn: 'Al Noor Trading',
      clientNameAr: 'شركة النور للتجارة',
      budgetHours: '100',
      loggedHours: '4',
      allocatedHours: '25',
    });
    expect(owner.projectHealth?.items[1]).toMatchObject({ budgetHours: '10', loggedHours: '0' });
    expect(owner.projectHealth?.items[2]?.budgetHours).toBeNull();

    // The Manager may read every project, but the dashboard shows the one they run.
    const manager = await summary(f.manager, f);
    expect(manager.projectHealth?.items.map((p) => p.id)).toEqual([f.projectId]);

    // A cancelled task's allocation no longer counts; archived or closed projects drop out.
    await admin.query(`update tasks set status = 'cancelled' where id = $1`, [f.taskId]);
    await admin.query(`update projects set status = 'completed' where id = $1`, [small]);
    const after = await summary(f.owner, f);
    expect(after.projectHealth?.items.map((p) => p.id)).toEqual([f.projectId, unbudgeted]);
    expect(after.projectHealth?.items[0]?.allocatedHours).toBe('0');

    // Team leads and employees get no project health.
    expect((await summary(f.lead, f)).projectHealth).toBeUndefined();
    expect((await summary(f.a, f)).projectHealth).toBeUndefined();
  });

  it('shows who is away in the coming week to their team lead and the owner, not to employees', async () => {
    const f = await firm();
    const types = leaveTypeListResponseSchema.parse(
      (await f.owner.get('/api/v1/leave/types', f.host)).body,
    );
    const unpaid = types.items.find((t) => t.code === 'unpaid');
    expect(unpaid).toBeDefined();
    const day = nextWorkingDay();
    const request = async (p: Person) =>
      created(
        await p.post(
          '/api/v1/leave/requests',
          { leaveTypeId: unpaid?.id, startDate: day, endDate: day },
          f.host,
        ),
        (x) => leaveRequestSchema.parse(x),
      );
    const fromA = await request(f.a);
    const fromB = await request(f.b);
    for (const r of [fromA, fromB]) {
      const ok = await f.owner.post(`/api/v1/leave/requests/${r.id}/approve`, {}, f.host);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    }
    // Leave far ahead is not "away this week".
    const later = created(
      await f.a.post(
        '/api/v1/leave/requests',
        { leaveTypeId: unpaid?.id, startDate: shift(day, 21), endDate: shift(day, 21) },
        f.host,
      ),
      (x) => leaveRequestSchema.parse(x),
    );
    await f.owner.post(`/api/v1/leave/requests/${later.id}/approve`, {}, f.host);

    const owner = await summary(f.owner, f);
    expect(owner.away?.items.map((i) => i.membershipId).sort()).toEqual([f.aId, f.bId].sort());
    expect(owner.away?.items[0]).toMatchObject({
      startDate: day,
      endDate: day,
      leaveTypeEn: 'Unpaid leave',
      leaveTypeAr: 'إجازة بدون راتب',
    });
    expect(owner.away?.items.find((i) => i.membershipId === f.aId)?.name).toBe('empa');

    // The lead sees only their team (A); employees get no section.
    const lead = await summary(f.lead, f);
    expect(lead.away?.items.map((i) => i.membershipId)).toEqual([f.aId]);
    expect((await summary(f.a, f)).away).toBeUndefined();
    expect((await summary(f.b, f)).away).toBeUndefined();
  });
});
