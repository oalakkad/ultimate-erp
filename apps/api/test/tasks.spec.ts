import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  allocationPreviewSchema,
  commentListResponseSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  notificationListResponseSchema,
  projectHoursSchema,
  projectSchema,
  type Task,
  taskActivitySchema,
  taskListResponseSchema,
  taskSchema,
  workloadSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { kuwaitToday } from '../src/modules/contracts/contracts.service.js';
import { TasksDailyHandler } from '../src/modules/tasks/tasks.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 6 acceptance (docs/modules/tasks.md §8) against real Postgres + Mailpit.

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
const day = (offset: number) =>
  new Date(Date.parse(`${kuwaitToday()}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

interface Firm {
  owner: Person;
  manager: Person;
  managerId: string;
  a: Person;
  aId: string;
  b: Person;
  bId: string;
  c: Person;
  cId: string;
  host: string;
  projectId: string;
}

/** A company with a Manager and three employees on one 100-hour project (the brief's example). */
async function firm(budgetHours = '100'): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const [a, b, c] = [await person('empa'), await person('empb'), await person('empc')];
  const aId = await join(a, host, owner, 'employee');
  const bId = await join(b, host, owner, 'employee');
  const cId = await join(c, host, owner, 'employee');
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
          nameEn: 'Statutory audit',
          nameAr: 'التدقيق القانوني',
          managerMembershipId: managerId,
          budgetHours,
          memberIds: [aId, bId, cId],
        },
        host,
      )
    ).body,
  );
  return { owner, manager, managerId, a, aId, b, bId, c, cId, host, projectId: project.id };
}

const ok = (res: { status: number; body: unknown }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return taskSchema.parse(res.body);
};

async function task(f: Firm, extra: object = {}, by: Person = f.manager): Promise<Task> {
  return ok(
    await by.post(
      '/api/v1/tasks',
      { projectId: f.projectId, title: 'Inventory count', ...extra },
      f.host,
    ),
    201,
  );
}

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

describe('allocating hours against the project budget', () => {
  it('reproduces the brief example: 20 + 15 + 10 of 100 → 45 allocated, 55 remaining', async () => {
    const f = await firm();
    const allocations = [
      { membershipId: f.aId, hours: '20' },
      { membershipId: f.bId, hours: '15' },
      { membershipId: f.cId, hours: '10' },
    ];
    const preview = allocationPreviewSchema.parse(
      (
        await f.manager.post(
          '/api/v1/tasks/allocation-preview',
          { projectId: f.projectId, allocations },
          f.host,
        )
      ).body,
    );
    expect(preview).toMatchObject({
      budgeted: '100',
      allocatedElsewhere: '0',
      thisTask: '45',
      remainingAfter: '55',
      overBudget: false,
      canOverride: false,
    });
    expect(preview.people.every((p) => p.onTeam && p.openWorkload === '0')).toBe(true);

    const t = await task(f, { allocations, dueDate: day(7), estimatedHours: '40' });
    expect(t.number).toBe('T-0001');
    expect(t.allocatedHours).toBe('45');
    expect(t.allocations).toHaveLength(3);
    expect(await hoursOf(f)).toMatchObject({ budgeted: '100', allocated: '45', remaining: '55' });

    // Each assignee is told; the person who assigned is not.
    const inbox = notificationListResponseSchema.parse(
      (await f.a.get('/api/v1/notifications', f.host)).body,
    );
    expect(inbox.items[0]).toMatchObject({ type: 'tasks.assigned', link: `/tasks/${t.id}` });

    // The second task's preview counts the first one's hours, and each person's open workload.
    const second = allocationPreviewSchema.parse(
      (
        await f.manager.post(
          '/api/v1/tasks/allocation-preview',
          { projectId: f.projectId, allocations: [{ membershipId: f.aId, hours: '60' }] },
          f.host,
        )
      ).body,
    );
    expect(second).toMatchObject({
      allocatedElsewhere: '45',
      remainingAfter: '-5',
      overBudget: true,
    });
    expect(second.people[0]?.openWorkload).toBe('20');
  });

  it('refuses going over budget unless an Owner overrides with a reason', async () => {
    const f = await firm();
    await task(f, { allocations: [{ membershipId: f.aId, hours: '90' }] });
    const t = await task(f, { title: 'Bank confirmations' });
    const over = await f.manager.put(
      `/api/v1/tasks/${t.id}/allocations`,
      { allocations: [{ membershipId: f.bId, hours: '20' }] },
      f.host,
    );
    expect(over.status).toBe(409);
    expect(errorOf(over.body).details?.[0]?.code).toBe('over_budget');
    // A Manager cannot override …
    expect(
      (
        await f.manager.put(
          `/api/v1/tasks/${t.id}/allocations`,
          {
            allocations: [{ membershipId: f.bId, hours: '20' }],
            override: true,
            overrideReason: 'x',
          },
          f.host,
        )
      ).status,
    ).toBe(403);
    // … the Owner can, but only with a reason, and it is recorded.
    expect(
      (
        await f.owner.put(
          `/api/v1/tasks/${t.id}/allocations`,
          { allocations: [{ membershipId: f.bId, hours: '20' }], override: true },
          f.host,
        )
      ).status,
    ).toBe(422);
    const done = ok(
      await f.owner.put(
        `/api/v1/tasks/${t.id}/allocations`,
        {
          allocations: [{ membershipId: f.bId, hours: '20' }],
          override: true,
          overrideReason: 'Client added a subsidiary',
        },
        f.host,
      ),
    );
    expect(done.allocatedHours).toBe('20');
    expect((await hoursOf(f)).warning).toBe('exceeded');
    const { rows } = await admin.query<{ details: { reason: string } }>(
      `select details from audit_events where action = 'tasks.allocation.override' and target_id = $1::uuid`,
      [t.id],
    );
    expect(rows[0]?.details.reason).toBe('Client added a subsidiary');
    const summary = dashboardSummarySchema.parse(
      (await f.owner.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(summary.projects?.overBudget).toBe(1);
  });

  it('never lets simultaneous allocations exceed the budget together', async () => {
    const f = await firm();
    const [t1, t2, t3] = [await task(f), await task(f), await task(f)];
    const results = await Promise.all(
      [t1, t2, t3].map((t, i) =>
        f.manager.put(
          `/api/v1/tasks/${t.id}/allocations`,
          { allocations: [{ membershipId: [f.aId, f.bId, f.cId][i] ?? '', hours: '40' }] },
          f.host,
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 409]);
    expect((await hoursOf(f)).allocated).toBe('80');
  });

  it('keeps allocations on the team, releases cancelled tasks and guards the budget', async () => {
    const f = await firm();
    const outsider = await person('outsider');
    const outsiderId = await join(outsider, f.host, f.owner, 'employee');
    const res = await f.manager.post(
      '/api/v1/tasks',
      {
        projectId: f.projectId,
        title: 'x',
        allocations: [{ membershipId: outsiderId, hours: '1' }],
      },
      f.host,
    );
    expect(res.status).toBe(422);
    expect(errorOf(res.body).details?.[0]?.code).toBe('not_on_team');

    const t = await task(f, { allocations: [{ membershipId: f.aId, hours: '30' }] });
    // The budget cannot drop below what is allocated.
    const cut = await f.owner.post(
      `/api/v1/projects/${f.projectId}/budget`,
      { budgetHours: '20', reason: 'Scope cut' },
      f.host,
    );
    expect(cut.status).toBe(409);
    // Someone with hours stays on the team.
    const removal = await f.manager.put(
      `/api/v1/projects/${f.projectId}/members`,
      { memberIds: [f.bId, f.cId] },
      f.host,
    );
    expect(removal.status).toBe(409);
    expect(errorOf(removal.body).details?.[0]?.code).toBe('has_allocations');

    ok(await f.manager.post(`/api/v1/tasks/${t.id}/status`, { status: 'cancelled' }, f.host));
    expect((await hoursOf(f)).allocated).toBe('0');
    expect(
      (
        await f.manager.put(
          `/api/v1/tasks/${t.id}/allocations`,
          { allocations: [{ membershipId: f.aId, hours: '1' }] },
          f.host,
        )
      ).status,
    ).toBe(409);
  });
});

describe('who sees and does what', () => {
  it('shows an Employee only the tasks they are assigned to, and lets them work them', async () => {
    const f = await firm();
    const mine = await task(f, { allocations: [{ membershipId: f.aId, hours: '5' }] });
    const other = await task(f, {
      title: 'Payroll testing',
      allocations: [{ membershipId: f.bId, hours: '5' }],
    });

    const list = taskListResponseSchema.parse((await f.a.get('/api/v1/tasks', f.host)).body);
    expect(list.items.map((t) => t.id)).toEqual([mine.id]);
    expect((await f.a.get(`/api/v1/tasks/${other.id}`, f.host)).status).toBe(404);

    const seen = ok(await f.a.get(`/api/v1/tasks/${mine.id}`, f.host));
    expect(seen.actions).toEqual(['comment', 'documents']);
    expect(seen.nextStatuses).toEqual(['ready', 'in_progress']);
    ok(await f.a.post(`/api/v1/tasks/${mine.id}/status`, { status: 'in_progress' }, f.host));
    // Employees cannot cancel, edit or re-allocate.
    expect(
      (await f.a.post(`/api/v1/tasks/${mine.id}/status`, { status: 'cancelled' }, f.host)).status,
    ).toBe(403);
    expect(
      (await f.a.patch(`/api/v1/tasks/${mine.id}`, { title: 'y', version: 1 }, f.host)).status,
    ).toBe(403);
    expect(
      (
        await f.a.put(
          `/api/v1/tasks/${mine.id}/allocations`,
          { allocations: [{ membershipId: f.aId, hours: '50' }] },
          f.host,
        )
      ).status,
    ).toBe(403);

    // Comments are append-only and visible to the team.
    const comments = commentListResponseSchema.parse(
      (
        await f.a.post(
          `/api/v1/tasks/${mine.id}/comments`,
          { body: 'Count done for warehouse 1' },
          f.host,
        )
      ).body,
    );
    expect(comments.items[0]?.body).toBe('Count done for warehouse 1');
    const appClient = new pg.Client({ connectionString: database.appUrl });
    await appClient.connect();
    await expect(appClient.query('update task_comments set body = $1', ['x'])).rejects.toThrow(
      /permission denied/,
    );
    await appClient.end();

    // My tasks on the dashboard.
    const summary = dashboardSummarySchema.parse(
      (await f.a.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(summary.tasks).toEqual({ mineOpen: 1, mineOverdue: 0, companyOverdue: null });
  });

  it('lets a Manager allocate only on projects they work on; other companies get 404', async () => {
    const f = await firm();
    const t = await task(f);
    const other = await founder();
    expect((await other.owner.get(`/api/v1/tasks/${t.id}`, other.host)).status).toBe(404);
    const otherList = taskListResponseSchema.parse(
      (await other.owner.get('/api/v1/tasks', other.host)).body,
    );
    expect(otherList.items).toHaveLength(0);

    // A second manager, not on the project, sees the task (company read) but cannot allocate.
    const outsider = await person('manager2');
    await join(outsider, f.host, f.owner, 'manager');
    const view = ok(await outsider.get(`/api/v1/tasks/${t.id}`, f.host));
    expect(view.actions).toEqual([]);
    expect(
      (
        await outsider.put(
          `/api/v1/tasks/${t.id}/allocations`,
          { allocations: [{ membershipId: f.aId, hours: '1' }] },
          f.host,
        )
      ).status,
    ).toBe(403);
    expect(
      (await outsider.post('/api/v1/tasks', { projectId: f.projectId, title: 'x' }, f.host)).status,
    ).toBe(403);

    const workload = workloadSchema.parse(
      (await f.manager.get(`/api/v1/workload?projectId=${f.projectId}`, f.host)).body,
    );
    expect(workload.items.map((w) => w.membershipId).sort()).toEqual(
      [f.managerId, f.aId, f.bId, f.cId].sort(),
    );
    expect((await f.a.get('/api/v1/workload', f.host)).status).toBe(403);
  });
});

describe('workflow and dependencies', () => {
  it('blocks starting a task until its blockers are finished, and refuses loops', async () => {
    const f = await firm();
    const first = await task(f, { title: 'Planning' });
    const second = await task(f, { title: 'Fieldwork' });
    const blocked = ok(
      await f.manager.put(
        `/api/v1/tasks/${second.id}/dependencies`,
        { blockedBy: [first.id] },
        f.host,
      ),
    );
    expect(blocked.blockedBy.map((b) => b.id)).toEqual([first.id]);
    expect(blocked.nextStatuses).not.toContain('in_progress');
    const start = await f.manager.post(
      `/api/v1/tasks/${second.id}/status`,
      { status: 'in_progress' },
      f.host,
    );
    expect(start.status).toBe(409);
    expect(errorOf(start.body).details?.[0]?.code).toBe('blocked');

    const loop = await f.manager.put(
      `/api/v1/tasks/${first.id}/dependencies`,
      { blockedBy: [second.id] },
      f.host,
    );
    expect(loop.status).toBe(409);
    expect(errorOf(loop.body).details?.[0]?.code).toBe('cycle');
    expect(
      (
        await f.manager.put(
          `/api/v1/tasks/${first.id}/dependencies`,
          { blockedBy: [first.id] },
          f.host,
        )
      ).status,
    ).toBe(422);

    ok(await f.manager.post(`/api/v1/tasks/${first.id}/status`, { status: 'in_progress' }, f.host));
    const finished = ok(
      await f.manager.post(`/api/v1/tasks/${first.id}/status`, { status: 'completed' }, f.host),
    );
    expect(finished.completedAt).not.toBeNull();
    ok(
      await f.manager.post(`/api/v1/tasks/${second.id}/status`, { status: 'in_progress' }, f.host),
    );

    const invalid = await f.manager.post(
      `/api/v1/tasks/${second.id}/status`,
      { status: 'backlog' },
      f.host,
    );
    expect(invalid.status).toBe(409);
    expect(errorOf(invalid.body).details?.[0]?.code).toBe('invalid_transition');

    const activity = taskActivitySchema.parse(
      (await f.manager.get(`/api/v1/tasks/${second.id}/activity`, f.host)).body,
    );
    expect(activity.items.map((a) => a.action)).toEqual([
      'tasks.task.status_changed',
      'tasks.dependency.changed',
      'tasks.task.created',
    ]);
    expect(activity.items[0]).toMatchObject({ from: 'backlog', to: 'in_progress' });
  });

  it('freezes tasks of a closed project and filters the list', async () => {
    const f = await firm();
    const late = await task(f, {
      dueDate: day(-2),
      allocations: [{ membershipId: f.aId, hours: '1' }],
    });
    await task(f, { title: 'Later', dueDate: day(5) });
    const overdue = taskListResponseSchema.parse(
      (await f.manager.get(`/api/v1/tasks?overdue=true&projectId=${f.projectId}`, f.host)).body,
    );
    expect(overdue.items.map((t) => t.id)).toEqual([late.id]);
    expect(overdue.items[0]?.overdue).toBe(true);
    const search = taskListResponseSchema.parse(
      (await f.manager.get('/api/v1/tasks?search=later', f.host)).body,
    );
    expect(search.items).toHaveLength(1);

    await f.owner.post(`/api/v1/projects/${f.projectId}/status`, { status: 'cancelled' }, f.host);
    const frozen = ok(await f.manager.get(`/api/v1/tasks/${late.id}`, f.host));
    expect(frozen.actions).toEqual([]);
    expect(frozen.nextStatuses).toEqual([]);
    // Frozen tasks raise no overdue alerts.
    await worker.get(TasksDailyHandler).handle({ id: 'frozen' });
    const inbox = notificationListResponseSchema.parse(
      (await f.a.get('/api/v1/notifications?limit=50', f.host)).body,
    );
    expect(inbox.items.some((n) => n.type === 'tasks.overdue')).toBe(false);
    expect(
      (await f.manager.post('/api/v1/tasks', { projectId: f.projectId, title: 'x' }, f.host))
        .status,
    ).toBe(409);
  });
});

describe('overdue alerts', () => {
  it('alerts assignees once when a task becomes overdue; a new due date re-arms it', async () => {
    const f = await firm();
    const t = await task(f, {
      dueDate: day(1),
      allocations: [{ membershipId: f.aId, hours: '2' }],
    });
    const handler = worker.get(TasksDailyHandler);
    const inThreeDays = new Date(Date.now() + 3 * 86_400_000);
    const overdueAlerts = async () =>
      notificationListResponseSchema
        .parse((await f.a.get('/api/v1/notifications?limit=50', f.host)).body)
        .items.filter((n) => n.type === 'tasks.overdue').length;

    await handler.handle({ id: 'test-1' });
    expect(await overdueAlerts()).toBe(0);
    await handler.handle({ id: 'test-2' }, inThreeDays);
    await handler.handle({ id: 'test-3' }, inThreeDays);
    expect(await overdueAlerts()).toBe(1);

    const current = ok(await f.manager.get(`/api/v1/tasks/${t.id}`, f.host));
    ok(
      await f.manager.patch(
        `/api/v1/tasks/${t.id}`,
        { dueDate: day(2), version: current.version },
        f.host,
      ),
    );
    await handler.handle({ id: 'test-4' }, inThreeDays);
    expect(await overdueAlerts()).toBe(2);
  });
});
