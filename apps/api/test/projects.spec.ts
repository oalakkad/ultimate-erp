import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  budgetRevisionListResponseSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  type Project,
  projectActivitySchema,
  projectHoursSchema,
  projectListResponseSchema,
  projectSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { kuwaitToday } from '../src/modules/contracts/contracts.service.js';
import { hundredths } from '../src/modules/projects/projects.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 5 acceptance (docs/modules/projects.md §9) against real Postgres + Mailpit.

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
  employee: Person;
  employeeId: string;
  host: string;
  clientId: string;
}

async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const employee = await person('employee');
  const employeeId = await join(employee, host, owner, 'employee');
  const client = await owner.post(
    '/api/v1/clients',
    { legalNameEn: 'Al Noor Trading', legalNameAr: 'شركة النور للتجارة' },
    host,
  );
  expect(client.status).toBe(201);
  const clientId = (client.body as { id: string }).id;
  return { owner, manager, managerId, employee, employeeId, host, clientId };
}

const ok = (res: { status: number; body: unknown }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return projectSchema.parse(res.body);
};

async function project(f: Firm, extra: object = {}): Promise<Project> {
  return ok(
    await f.owner.post(
      '/api/v1/projects',
      {
        clientId: f.clientId,
        nameEn: 'Statutory audit 2026',
        nameAr: 'التدقيق القانوني ٢٠٢٦',
        managerMembershipId: f.managerId,
        budgetHours: '120',
        budgetAmount: '4500.000',
        ...extra,
      },
      f.host,
    ),
    201,
  );
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

describe('hours arithmetic', () => {
  it('counts hours as exact hundredths', () => {
    expect(hundredths('37.5')).toBe(3750n);
    expect(hundredths('0.05')).toBe(5n);
    expect(hundredths('120.00')).toBe(12000n);
  });
});

describe('creating projects', () => {
  it('numbers projects, records budget revision 1 and puts the manager on the team', async () => {
    const f = await firm();
    const first = await project(f, { memberIds: [f.employeeId] });
    expect(first.number).toBe('P-0001');
    expect(first.status).toBe('planned');
    expect(first.budgetHours).toBe('120');
    expect(first.budgetAmount).toBe('4500.000');
    expect(first.currency).toBe('KWD');
    expect(first.budgetRevision).toBe(1);
    expect(first.manager?.membershipId).toBe(f.managerId);
    expect(first.members.map((m) => m.membershipId).sort()).toEqual(
      [f.managerId, f.employeeId].sort(),
    );
    expect((await project(f)).number).toBe('P-0002');

    const history = budgetRevisionListResponseSchema.parse(
      (await f.owner.get(`/api/v1/projects/${first.id}/budget`, f.host)).body,
    );
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.reason).toBe('Initial budget');
  });

  it('validates the request and only links contracts of the same client', async () => {
    const f = await firm();
    const bad = await f.owner.post(
      '/api/v1/projects',
      {
        clientId: f.clientId,
        nameEn: 'x',
        nameAr: 'x',
        managerMembershipId: f.managerId,
        budgetHours: '12.345',
        startDate: day(10),
        endDate: day(1),
      },
      f.host,
    );
    expect(bad.status).toBe(422);
    const paths = errorOf(bad.body).details?.map((d) => d.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining(['budgetHours', 'endDate']));

    const other = await f.owner.post(
      '/api/v1/clients',
      { legalNameEn: 'Gulf Holding', legalNameAr: 'الخليج القابضة' },
      f.host,
    );
    const contract = await f.owner.post(
      '/api/v1/contracts',
      {
        kind: 'contract',
        clientId: (other.body as { id: string }).id,
        titleEn: 'Audit',
        titleAr: 'تدقيق',
      },
      f.host,
    );
    expect(contract.status).toBe(201);
    const contractId = (contract.body as { id: string }).id;
    const mismatch = await f.owner.post(
      '/api/v1/projects',
      {
        clientId: f.clientId,
        nameEn: 'x',
        nameAr: 'x',
        managerMembershipId: f.managerId,
        budgetHours: '10',
        contractId,
      },
      f.host,
    );
    expect(mismatch.status).toBe(422);
    expect(errorOf(mismatch.body).details?.[0]).toMatchObject({
      path: 'contractId',
      code: 'not_of_client',
    });

    const linked = await project(f, {
      clientId: (other.body as { id: string }).id,
      contractId,
    });
    expect(linked.contract?.id).toBe(contractId);

    const stranger = await f.owner.post(
      '/api/v1/projects',
      {
        clientId: f.clientId,
        nameEn: 'x',
        nameAr: 'x',
        managerMembershipId: '00000000-0000-4000-8000-000000000000',
        budgetHours: '10',
      },
      f.host,
    );
    expect(stranger.status).toBe(422);
  });

  it('lets only people with projects.project.create create projects', async () => {
    const f = await firm();
    const res = await f.employee.post(
      '/api/v1/projects',
      {
        clientId: f.clientId,
        nameEn: 'x',
        nameAr: 'x',
        managerMembershipId: f.employeeId,
        budgetHours: '1',
      },
      f.host,
    );
    expect(res.status).toBe(403);
  });
});

describe('project scope', () => {
  it('shows team members only their projects and hides the rest', async () => {
    const f = await firm();
    const mine = await project(f, { memberIds: [f.employeeId] });
    const theirs = await project(f, { nameEn: 'Internal review' });

    const list = projectListResponseSchema.parse(
      (await f.employee.get('/api/v1/projects', f.host)).body,
    );
    expect(list.items.map((p) => p.id)).toEqual([mine.id]);
    expect((await f.employee.get(`/api/v1/projects/${theirs.id}`, f.host)).status).toBe(404);
    const seen = ok(await f.employee.get(`/api/v1/projects/${mine.id}`, f.host));
    expect(seen.actions).toEqual([]);
    expect(seen.nextStatuses).toEqual([]);
    expect(
      (await f.employee.patch(`/api/v1/projects/${mine.id}`, { nameEn: 'y', version: 1 }, f.host))
        .status,
    ).toBe(403);

    // Owner sees everything; "mine" narrows to projects they work on (none).
    const all = projectListResponseSchema.parse(
      (await f.owner.get('/api/v1/projects', f.host)).body,
    );
    expect(all.items).toHaveLength(2);
    const ownerMine = projectListResponseSchema.parse(
      (await f.owner.get('/api/v1/projects?mine=true', f.host)).body,
    );
    expect(ownerMine.items).toHaveLength(0);
  });

  it('lets a manager manage only projects they lead or work on', async () => {
    const f = await firm();
    const led = await project(f);
    const other = await project(f, { managerMembershipId: f.employeeId, nameEn: 'Tax review' });

    const view = ok(await f.manager.get(`/api/v1/projects/${other.id}`, f.host));
    expect(view.actions).toEqual([]);
    expect(
      (await f.manager.post(`/api/v1/projects/${other.id}/status`, { status: 'active' }, f.host))
        .status,
    ).toBe(403);
    expect(
      (
        await f.manager.post(
          `/api/v1/projects/${other.id}/budget`,
          { budgetHours: '1', reason: 'x' },
          f.host,
        )
      ).status,
    ).toBe(403);

    const own = ok(await f.manager.get(`/api/v1/projects/${led.id}`, f.host));
    expect(own.actions).toEqual(expect.arrayContaining(['edit', 'team', 'budget', 'status']));
    ok(await f.manager.post(`/api/v1/projects/${led.id}/status`, { status: 'active' }, f.host));
  });

  it('keeps companies apart', async () => {
    const f = await firm();
    const p = await project(f);
    const g = await founder();
    expect((await g.owner.get(`/api/v1/projects/${p.id}`, g.host)).status).toBe(404);
    expect((await g.owner.get(`/api/v1/projects/${p.id}`, f.host)).status).toBe(404);
    const list = projectListResponseSchema.parse(
      (await g.owner.get('/api/v1/projects', g.host)).body,
    );
    expect(list.items).toHaveLength(0);
    // A member of another company cannot be put on the team.
    const outsider = await person('outsider');
    const outsiderId = await join(outsider, g.host, g.owner, 'employee');
    const res = await f.owner.put(
      `/api/v1/projects/${p.id}/members`,
      { memberIds: [outsiderId] },
      f.host,
    );
    expect(res.status).toBe(422);
  });
});

describe('lifecycle, team and budget', () => {
  it('follows the status machine and freezes closed projects', async () => {
    const f = await firm();
    const p = await project(f);
    expect(p.nextStatuses).toEqual(['active', 'cancelled']);
    const jump = await f.owner.post(
      `/api/v1/projects/${p.id}/status`,
      { status: 'completed' },
      f.host,
    );
    expect(jump.status).toBe(409);
    expect(errorOf(jump.body).details?.[0]?.code).toBe('invalid_transition');

    ok(await f.owner.post(`/api/v1/projects/${p.id}/status`, { status: 'active' }, f.host));
    ok(await f.owner.post(`/api/v1/projects/${p.id}/status`, { status: 'on_hold' }, f.host));
    ok(await f.owner.post(`/api/v1/projects/${p.id}/status`, { status: 'active' }, f.host));
    const done = ok(
      await f.owner.post(`/api/v1/projects/${p.id}/status`, { status: 'completed' }, f.host),
    );
    expect(done.actions).toEqual([]);
    expect(done.nextStatuses).toEqual([]);

    const edit = await f.owner.patch(
      `/api/v1/projects/${p.id}`,
      { nameEn: 'Changed', version: done.version },
      f.host,
    );
    expect(edit.status).toBe(409);
    expect(errorOf(edit.body).details?.[0]?.code).toBe('closed');
    expect(
      (
        await f.owner.post(
          `/api/v1/projects/${p.id}/budget`,
          { budgetHours: '200', reason: 'More scope' },
          f.host,
        )
      ).status,
    ).toBe(409);
  });

  it('edits with an optimistic version check', async () => {
    const f = await firm();
    const p = await project(f);
    const edited = ok(
      await f.manager.patch(
        `/api/v1/projects/${p.id}`,
        { nameEn: 'Statutory audit FY2026', endDate: day(20), version: p.version },
        f.host,
      ),
    );
    expect(edited.name.en).toBe('Statutory audit FY2026');
    expect(edited.version).toBe(p.version + 1);
    const stale = await f.owner.patch(
      `/api/v1/projects/${p.id}`,
      { nameEn: 'Late', version: p.version },
      f.host,
    );
    expect(stale.status).toBe(409);
  });

  it('replaces the team but always keeps the manager', async () => {
    const f = await firm();
    const p = await project(f, { memberIds: [f.employeeId] });
    const after = ok(
      await f.manager.put(`/api/v1/projects/${p.id}/members`, { memberIds: [] }, f.host),
    );
    expect(after.members.map((m) => m.membershipId)).toEqual([f.managerId]);
    expect((await f.employee.get(`/api/v1/projects/${p.id}`, f.host)).status).toBe(404);
  });

  it('revises the budget with a reason and reports the five hour measures', async () => {
    const f = await firm();
    const p = await project(f);
    const noReason = await f.manager.post(
      `/api/v1/projects/${p.id}/budget`,
      { budgetHours: '150' },
      f.host,
    );
    expect(noReason.status).toBe(422);
    const revised = ok(
      await f.manager.post(
        `/api/v1/projects/${p.id}/budget`,
        { budgetHours: '150.5', budgetAmount: '5000.000', reason: 'Added inventory count' },
        f.host,
      ),
    );
    expect(revised.budgetRevision).toBe(2);
    expect(revised.budgetHours).toBe('150.5');

    const history = budgetRevisionListResponseSchema.parse(
      (await f.manager.get(`/api/v1/projects/${p.id}/budget`, f.host)).body,
    );
    expect(history.items.map((r) => r.revisionNo)).toEqual([2, 1]);
    expect(history.items[0]).toMatchObject({
      budgetHours: '150.5',
      reason: 'Added inventory count',
    });

    const hours = projectHoursSchema.parse(
      (await f.manager.get(`/api/v1/projects/${p.id}/hours`, f.host)).body,
    );
    expect(hours).toEqual({
      budgeted: '150.5',
      allocated: '0',
      remaining: '150.5',
      logged: '0',
      approved: '0',
      billable: '0',
      warning: 'none',
    });

    const activity = projectActivitySchema.parse(
      (await f.owner.get(`/api/v1/projects/${p.id}/activity`, f.host)).body,
    );
    expect(activity.items.map((a) => a.action)).toEqual([
      'projects.budget.revised',
      'projects.project.created',
    ]);
    expect(activity.items[0]).toMatchObject({ from: '120.00', to: '150.5' });

    // The history cannot be rewritten, even with direct database access as the app.
    const app = new pg.Client({ connectionString: database.appUrl });
    await app.connect();
    await expect(
      app.query('update project_budget_revisions set reason = $1', ['x']),
    ).rejects.toThrow(/permission denied/);
    await app.end();
  });
});

describe('dashboard', () => {
  it('counts active projects and those ending within 30 days', async () => {
    const f = await firm();
    const soon = await project(f, { startDate: day(-5), endDate: day(10) });
    const later = await project(f, { endDate: day(90) });
    await project(f);
    for (const p of [soon, later]) {
      ok(await f.owner.post(`/api/v1/projects/${p.id}/status`, { status: 'active' }, f.host));
    }
    const summary = dashboardSummarySchema.parse(
      (await f.owner.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(summary.projects).toEqual({ active: 2, endingSoon: 1, overBudget: 0 });
    const employeeView = dashboardSummarySchema.parse(
      (await f.employee.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(employeeView.projects).toBeUndefined();
  });
});
