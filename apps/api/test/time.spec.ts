import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  approvalListResponseSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  notificationListResponseSchema,
  projectHoursSchema,
  projectSchema,
  taskSchema,
  taskTimeSchema,
  timeEntrySchema,
  timerSchema,
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

// Phase 7 acceptance (docs/modules/timesheets.md §8) against real Postgres + Mailpit.

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
const today = () => kuwaitToday();

interface Firm {
  owner: Person;
  manager: Person;
  managerId: string;
  a: Person;
  aId: string;
  b: Person;
  host: string;
  clientId: string;
  projectId: string;
  taskId: string;
}

/** Owner, a Manager who runs the project, employee A assigned (20 h) and employee B not assigned. */
async function firm(billingMethod = 'time_and_materials'): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const b = await person('empb');
  const bId = await join(b, host, owner, 'employee');
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
          nameEn: 'Statutory audit',
          nameAr: 'التدقيق القانوني',
          managerMembershipId: managerId,
          budgetHours: '100',
          billingMethod,
          memberIds: [aId, bId],
        },
        host,
      )
    ).body,
  );
  const task = taskSchema.parse(
    (
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
      )
    ).body,
  );
  return {
    owner,
    manager,
    managerId,
    a,
    aId,
    b,
    host,
    clientId,
    projectId: project.id,
    taskId: task.id,
  };
}

const entry = (res: { status: number; body: unknown }, status = 201) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return timeEntrySchema.parse(res.body);
};
const log = (p: Person, f: Firm, hours: string, extra: object = {}) =>
  p.post('/api/v1/time-entries', { taskId: f.taskId, workDate: today(), hours, ...extra }, f.host);
const week = async (p: Person, f: Firm) =>
  timesheetSchema.parse((await p.get('/api/v1/timesheets/mine', f.host)).body);
const inbox = async (p: Person, f: Firm) =>
  notificationListResponseSchema.parse((await p.get('/api/v1/notifications?limit=50', f.host)).body)
    .items;
const hoursOf = async (f: Firm) =>
  projectHoursSchema.parse(
    (await f.owner.get(`/api/v1/projects/${f.projectId}/hours`, f.host)).body,
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

describe('logging time', () => {
  it('lets assignees log time and refuses outsiders, the future, > 24 h a day and duplicates', async () => {
    const f = await firm();
    const first = entry(await log(f.a, f, '3.5', { description: 'Warehouse 1' }));
    expect(first).toMatchObject({
      hours: '3.5',
      billable: true,
      status: 'draft',
      actions: ['edit', 'delete'],
    });

    const outsider = await log(f.b, f, '1');
    expect(outsider.status).toBe(422);
    expect(errorOf(outsider.body).details?.[0]?.code).toBe('not_assigned');
    const tomorrow = new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect((await log(f.a, f, '1', { workDate: tomorrow })).status).toBe(422);
    expect((await log(f.a, f, '25')).status).toBe(422);
    const tooMuch = await log(f.a, f, '21');
    expect(errorOf(tooMuch.body).details?.[0]?.code).toBe('day_over_24');

    const twin = await log(f.a, f, '3.5', { description: 'Warehouse 1' });
    expect(twin.status).toBe(409);
    expect(errorOf(twin.body).details?.[0]?.code).toBe('possible_duplicate');
    entry(await log(f.a, f, '3.5', { description: 'Warehouse 1', confirmDuplicate: true }));

    const sheet = await week(f.a, f);
    expect(sheet.weekStart).toBe(weekStartOf(today()));
    expect(new Date(`${sheet.weekStart}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(sheet).toMatchObject({ status: 'draft', totalHours: '7', canSubmit: true });
    expect(sheet.days).toHaveLength(7);

    // Someone with logged time stays on the task.
    const task = taskSchema.parse((await f.manager.get(`/api/v1/tasks/${f.taskId}`, f.host)).body);
    const removal = await f.manager.put(
      `/api/v1/tasks/${task.id}/allocations`,
      { allocations: [{ membershipId: f.managerId, hours: '5' }] },
      f.host,
    );
    expect(errorOf(removal.body).details?.[0]?.code).toBe('has_time');
  });

  it('makes time on a non-billable project non-billable', async () => {
    const f = await firm('non_billable');
    expect(entry(await log(f.a, f, '2', { billable: true })).billable).toBe(false);
  });

  it('turns a timer into a draft entry with the elapsed time', async () => {
    const f = await firm();
    expect(
      timerSchema.parse((await f.a.post('/api/v1/timer', { taskId: f.taskId }, f.host)).body)
        .running?.task.id,
    ).toBe(f.taskId);
    expect((await f.a.post('/api/v1/timer', { taskId: f.taskId }, f.host)).status).toBe(409);
    await admin.query(
      `update time_timers set started_at = now() - interval '89 minutes 57 seconds'`,
    );
    const made = entry(
      await f.a.post('/api/v1/timer/stop', { description: 'Counting' }, f.host),
      200,
    );
    expect(made).toMatchObject({ hours: '1.5', description: 'Counting', status: 'draft' });
    expect(timerSchema.parse((await f.a.get('/api/v1/timer', f.host)).body).running).toBeNull();
  });
});

describe('submitting and approving', () => {
  it('runs submit → manager approves → actual hours, and locks approved time', async () => {
    const f = await firm();
    const e = entry(await log(f.a, f, '6'));
    const sheet = await week(f.a, f);
    const submitted = timesheetSchema.parse(
      (await f.a.post(`/api/v1/timesheets/${sheet.id}/submit`, {}, f.host)).body,
    );
    expect(submitted.status).toBe('submitted');
    expect((await log(f.a, f, '1')).status).toBe(409);
    expect((await inbox(f.manager, f))[0]?.type).toBe('time.submitted');
    expect(
      (await f.a.patch(`/api/v1/time-entries/${e.id}`, { hours: '5', version: e.version }, f.host))
        .status,
    ).toBe(409);

    const waiting = approvalListResponseSchema.parse(
      (await f.manager.get('/api/v1/approvals/time', f.host)).body,
    );
    expect(waiting.items.map((i) => i.id)).toEqual([e.id]);
    expect(waiting.items[0]?.actions).toEqual(['approve', 'reject']);
    const summary = dashboardSummarySchema.parse(
      (await f.manager.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(summary.time?.waitingForMe).toBe(1);

    approvalListResponseSchema.parse(
      (await f.manager.post('/api/v1/time-entries/approve', { ids: [e.id] }, f.host)).body,
    );
    expect((await week(f.a, f)).status).toBe('approved');
    expect((await inbox(f.a, f))[0]?.type).toBe('time.approved');
    expect(await hoursOf(f)).toMatchObject({ logged: '6', approved: '6', billable: '6' });
    const planned = taskTimeSchema.parse(
      (await f.manager.get(`/api/v1/tasks/${f.taskId}/time`, f.host)).body,
    );
    expect(planned.items.find((i) => i.membershipId === f.aId)).toMatchObject({
      allocated: '20',
      logged: '6',
      approved: '6',
    });

    // Approved time is locked …
    expect((await f.a.delete(`/api/v1/time-entries/${e.id}`, f.host)).status).toBe(409);
    // … the manager can reopen it with a reason, which is audited and sends it back.
    const reopened = entry(
      await f.manager.post(`/api/v1/time-entries/${e.id}/reopen`, { reason: 'Wrong task' }, f.host),
      200,
    );
    expect(reopened).toMatchObject({ status: 'rejected', rejectionReason: 'Wrong task' });
    expect((await week(f.a, f)).status).toBe('rejected');
    const { rows } = await admin.query<{ details: { reason: string } }>(
      `select details from audit_events where action = 'time.entry.reopened' and target_id = $1::uuid`,
      [e.id],
    );
    expect(rows[0]?.details.reason).toBe('Wrong task');
    expect((await hoursOf(f)).approved).toBe('0');
  });

  it('sends rejected entries back for correction and resubmission', async () => {
    const f = await firm();
    const e = entry(await log(f.a, f, '4'));
    const sheet = await week(f.a, f);
    await f.a.post(`/api/v1/timesheets/${sheet.id}/submit`, {}, f.host);
    expect(
      (await f.manager.post('/api/v1/time-entries/reject', { ids: [e.id] }, f.host)).status,
    ).toBe(422);
    await f.manager.post(
      '/api/v1/time-entries/reject',
      { ids: [e.id], reason: 'Split by warehouse' },
      f.host,
    );
    const back = await week(f.a, f);
    expect(back.status).toBe('rejected');
    expect(back.entries[0]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Split by warehouse',
    });
    expect((await inbox(f.a, f))[0]?.type).toBe('time.rejected');

    const fixed = entry(
      await f.a.patch(
        `/api/v1/time-entries/${e.id}`,
        { hours: '3', description: 'Warehouse 1', version: e.version },
        f.host,
      ),
      200,
    );
    expect(fixed).toMatchObject({ status: 'draft', rejectionReason: null });
    await f.a.post(`/api/v1/timesheets/${sheet.id}/submit`, {}, f.host);
    await f.manager.post('/api/v1/time-entries/approve', { ids: [e.id] }, f.host);
    expect((await week(f.a, f)).status).toBe('approved');
  });

  it('never lets anyone approve their own time, nor time on projects they do not manage', async () => {
    const f = await firm();
    const own = entry(await log(f.manager, f, '2'));
    const sheet = await week(f.manager, f);
    await f.manager.post(`/api/v1/timesheets/${sheet.id}/submit`, {}, f.host);
    // The manager manages this project but cannot approve their own time; the Owner is told.
    const mine = approvalListResponseSchema.parse(
      (await f.manager.get('/api/v1/approvals/time', f.host)).body,
    );
    expect(mine.items).toHaveLength(0);
    expect(
      (await f.manager.post('/api/v1/time-entries/approve', { ids: [own.id] }, f.host)).status,
    ).toBe(403);
    expect((await inbox(f.owner, f)).some((n) => n.type === 'time.submitted')).toBe(true);

    // A second manager who does not run the project can't approve either; employees can't at all.
    const other = await person('manager2');
    await join(other, f.host, f.owner, 'manager');
    expect(
      approvalListResponseSchema.parse((await other.get('/api/v1/approvals/time', f.host)).body)
        .items,
    ).toHaveLength(0);
    expect(
      (await other.post('/api/v1/time-entries/approve', { ids: [own.id] }, f.host)).status,
    ).toBe(403);
    expect((await f.a.post('/api/v1/time-entries/approve', { ids: [own.id] }, f.host)).status).toBe(
      403,
    );
    // Another company does not even find it.
    const g = await founder();
    expect(
      (await g.owner.post('/api/v1/time-entries/approve', { ids: [own.id] }, g.host)).status,
    ).toBe(404);

    approvalListResponseSchema.parse(
      (await f.owner.post('/api/v1/time-entries/approve', { ids: [own.id] }, f.host)).body,
    );
    // Even with direct database access, nobody decides on their own time.
    const { rows } = await admin.query<{ user_id: string }>(
      `select m.user_id from memberships m where m.id = $1::uuid`,
      [f.managerId],
    );
    await expect(
      admin.query(`update time_entries set decided_by_user_id = $1::uuid where id = $2::uuid`, [
        rows[0]?.user_id,
        own.id,
      ]),
    ).rejects.toThrow(/own time/);
  });
});

describe('summaries', () => {
  it('summarises a period per day and project with the billable share', async () => {
    const f = await firm();
    const e = entry(await log(f.a, f, '5', { billable: false }));
    const e2 = entry(await log(f.a, f, '3'));
    const sheet = await week(f.a, f);
    await f.a.post(`/api/v1/timesheets/${sheet.id}/submit`, {}, f.host);
    await f.manager.post('/api/v1/time-entries/approve', { ids: [e.id, e2.id] }, f.host);
    const from = weekStartOf(today());
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const mine = timeSummarySchema.parse(
      (await f.a.get(`/api/v1/time/summary?from=${from}&to=${to}`, f.host)).body,
    );
    expect(mine).toMatchObject({
      logged: '8',
      approved: '8',
      billable: '3',
      nonBillable: '5',
      billablePercent: 37,
    });
    expect(mine.days).toHaveLength(7);
    expect(mine.projects).toHaveLength(1);
    // Others' summaries need company-wide read.
    expect(
      (await f.b.get(`/api/v1/time/summary?from=${from}&to=${to}&membershipId=${f.aId}`, f.host))
        .status,
    ).toBe(403);
    expect(
      (
        await f.owner.get(
          `/api/v1/time/summary?from=${from}&to=${to}&membershipId=${f.aId}`,
          f.host,
        )
      ).status,
    ).toBe(200);
    const dash = dashboardSummarySchema.parse(
      (await f.a.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(dash.time).toEqual({ thisWeekHours: '8', waitingForMe: null });
  });

  it('keeps an entry inside its timesheet week (database rule)', async () => {
    const f = await firm();
    const e = entry(await log(f.a, f, '1'));
    await expect(
      admin.query(`update time_entries set work_date = work_date + 10 where id = $1::uuid`, [e.id]),
    ).rejects.toThrow(/outside the timesheet week/);
  });
});
