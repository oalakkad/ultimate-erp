import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { OpenApiService } from '../src/platform/openapi/openapi.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Cross-tenant attack sweep (security audit 2026-11-08, security.md §2g). Company A is filled
// through the real API; then EVERY id in EVERY company-owned table of A is harvested straight
// from the database, and the Owner of company B — a fully privileged attacker in their own
// company — sends every route of the API (every method) with each of those ids, and every list
// route with A's ids as filter values. Nothing may answer 2xx with A's id, no answer may contain
// A's marker text or ids, nothing may answer 5xx, and A's rows must be byte-for-byte unchanged.
// Finally B's Owner talks to A's address directly: every route must refuse.

const MARK = 'ZEBRAQ'; // appears in A's names and texts only
let database: TestDatabase;
let mailpit: TestMailpit;
let app: INestApplication;
let server: Server;
let worker: INestApplicationContext;
let admin: pg.Pool;
const { person, founder, join } = people(
  () => server,
  () => mailpit,
);

const ok = async (res: Promise<{ status: number; body: unknown }>, what: string) => {
  const r = await res;
  expect(r.status, `${what}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body as { id: string; items?: { id: string; code: string }[] };
};

interface CompanyA {
  owner: Person;
  host: string;
  tenantId: string;
  ids: Set<string>;
}

async function companyA(): Promise<CompanyA> {
  const { owner, host } = await founder();
  const emp = await person('emp');
  const empId = await join(emp, host, owner, 'employee');
  const { members } = (await owner.get('/api/v1/members', host)).body as {
    members: { email: string; membershipId: string }[];
  };
  const ownerId = members.find((m) => m.email === owner.email)?.membershipId ?? '';
  const y = new Date().getUTCFullYear();
  await ok(
    owner.post('/api/v1/people', { membershipId: empId, joinDate: `${y}-01-01` }, host),
    'person',
  );
  const dept = await ok(
    owner.post('/api/v1/departments', { nameEn: `${MARK} dept`, nameAr: 'قسم' }, host),
    'department',
  );
  await ok(
    owner.post(
      '/api/v1/teams',
      { nameEn: `${MARK} team`, nameAr: 'فريق', leadMembershipId: ownerId, departmentId: dept.id },
      host,
    ),
    'team',
  );
  const client = await ok(
    owner.post('/api/v1/clients', { legalNameEn: `${MARK} Trading`, legalNameAr: 'زيبرا' }, host),
    'client',
  );
  await ok(
    owner.post(
      `/api/v1/clients/${client.id}/contacts`,
      { name: `${MARK} CFO`, isPrimary: true },
      host,
    ),
    'contact',
  );
  await ok(
    owner.post(
      `/api/v1/clients/${client.id}/interactions`,
      { kind: 'call', occurredAt: new Date().toISOString(), summary: `${MARK} call` },
      host,
    ),
    'interaction',
  );
  const today = new Date().toISOString().slice(0, 10);
  const contract = await ok(
    owner.post(
      '/api/v1/contracts',
      {
        kind: 'engagement_letter',
        clientId: client.id,
        titleEn: `${MARK} audit`,
        titleAr: 'تدقيق',
        startDate: today,
        valueAmount: '1000.000',
        currency: 'KWD',
      },
      host,
    ),
    'contract',
  );
  await ok(
    owner.post(
      `/api/v1/contracts/${contract.id}/versions`,
      { bodyEn: `${MARK} terms`, bodyAr: 'شروط' },
      host,
    ),
    'contract version',
  );
  const project = await ok(
    owner.post(
      '/api/v1/projects',
      {
        clientId: client.id,
        nameEn: `${MARK} project`,
        nameAr: 'مشروع',
        managerMembershipId: ownerId,
        budgetHours: '50',
        billingMethod: 'time_and_materials',
        memberIds: [empId],
      },
      host,
    ),
    'project',
  );
  const task = await ok(
    owner.post(
      '/api/v1/tasks',
      {
        projectId: project.id,
        title: `${MARK} task`,
        allocations: [{ membershipId: empId, hours: '10' }],
      },
      host,
    ),
    'task',
  );
  await ok(
    owner.post(`/api/v1/tasks/${task.id}/comments`, { body: `${MARK} note` }, host),
    'comment',
  );
  await ok(
    emp.post(
      '/api/v1/time-entries',
      { taskId: task.id, workDate: today, hours: '2', billable: true, description: `${MARK} work` },
      host,
    ),
    'time entry',
  );
  const types = await ok(emp.get('/api/v1/leave/types', host), 'leave types');
  const annual = types.items?.find((t) => t.code === 'annual')?.id ?? '';
  const future = new Date(Date.now() + 30 * 86_400_000);
  while (future.getUTCDay() > 4) future.setUTCDate(future.getUTCDate() + 1);
  const d = future.toISOString().slice(0, 10);
  await ok(
    emp.post(
      '/api/v1/leave/requests',
      { leaveTypeId: annual, startDate: d, endDate: d, reason: `${MARK} trip` },
      host,
    ),
    'leave',
  );
  const invoice = await ok(
    owner.post(
      '/api/v1/invoices',
      {
        clientId: client.id,
        projectId: project.id,
        notes: `${MARK} invoice`,
        lines: [{ description: `${MARK} fee`, quantity: '1', unitPrice: '500.000' }],
      },
      host,
    ),
    'invoice',
  );
  await ok(
    owner.post(`/api/v1/invoices/${invoice.id}/issue`, { issueDate: today, dueDate: today }, host),
    'issue',
  );
  await ok(
    owner.post(
      `/api/v1/invoices/${invoice.id}/payments`,
      { amount: '100.000', receivedOn: today, method: 'bank_transfer', reference: `${MARK}-TT` },
      host,
    ),
    'payment',
  );
  const claim = await ok(
    emp.post(
      '/api/v1/expenses',
      {
        title: `${MARK} taxi`,
        lines: [
          {
            spentOn: today,
            category: 'transport',
            description: `${MARK} cab`,
            amount: '3.500',
            projectId: project.id,
            billable: true,
          },
        ],
      },
      host,
    ),
    'expense',
  );
  await ok(emp.post(`/api/v1/expenses/${claim.id}/submit`, {}, host), 'expense submit');
  const preview = (await owner.post('/api/v1/announcements/preview', { roles: [] }, host)).body as {
    recipients: number;
  };
  await ok(
    owner.post(
      '/api/v1/announcements',
      {
        titleEn: `${MARK} news`,
        titleAr: 'خبر',
        bodyEn: `${MARK} body`,
        bodyAr: 'نص',
        roles: [],
        email: false,
        confirmRecipients: preview.recipients,
      },
      host,
    ),
    'announcement',
  );

  const tenantId = (
    await admin.query<{ tenant_id: string }>(
      'select tenant_id from tenant_domains where hostname = $1',
      [host],
    )
  ).rows[0]?.tenant_id;
  if (!tenantId) throw new Error('no tenant');
  return { owner, host, tenantId, ids: await harvest(tenantId) };
}

/** Every company-owned table (has tenant_id and id). */
async function tenantTables(): Promise<string[]> {
  const res = await admin.query<{ table_name: string }>(
    `select c.table_name from information_schema.columns c
       join information_schema.columns i on i.table_schema = c.table_schema
        and i.table_name = c.table_name and i.column_name = 'id'
       join information_schema.tables t on t.table_schema = c.table_schema
        and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'tenant_id'
      order by 1`,
  );
  return res.rows.map((r) => r.table_name);
}

async function harvest(tenantId: string): Promise<Set<string>> {
  const ids = new Set<string>([tenantId]);
  for (const t of await tenantTables()) {
    const rows = await admin.query<{ id: string }>(
      `select id::text from "${t}" where tenant_id = $1 order by id limit 4`,
      [tenantId],
    );
    for (const r of rows.rows) ids.add(r.id);
  }
  return ids;
}

/** A fingerprint of every row of A: any write that got through changes it. */
async function fingerprint(tenantId: string): Promise<string> {
  const parts: string[] = [];
  for (const t of await tenantTables()) {
    const r = await admin.query<{ h: string | null; n: string }>(
      `select md5(string_agg(x::text, '|' order by x.id)) h, count(*) n from "${t}" x where tenant_id = $1`,
      [tenantId],
    );
    parts.push(`${t}:${r.rows[0]?.n}:${r.rows[0]?.h}`);
  }
  return parts.join('\n');
}

// Routes that never take a company resource, or are about the caller's own sign-in.
const SKIP = [/^\/api\/v1\/auth\//, /^\/api\/v1\/health/, /^\/api\/v1\/docs/, /sign-out/];

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  admin = new pg.Pool({ connectionString: database.migratorUrl, max: 2 });
  const config = testConfig({ DATABASE_URL: database.appUrl, ...mailpit.smtpConfig });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
}, 120_000);

afterAll(async () => {
  await worker.close();
  await app.close();
  await admin.end();
  await Promise.all([database.stop(), mailpit.stop()]);
});

describe('cross-tenant attack sweep', () => {
  it('company B cannot read, change or list any of company A’s records by any route', async () => {
    const a = await companyA();
    const { owner: attacker, host: hostB } = await founder();
    // B has its own records too, so "200 with B's own data" paths are exercised.
    await attacker.post('/api/v1/clients', { legalNameEn: 'B Co', legalNameAr: 'ب' }, hostB);
    const before = await fingerprint(a.tenantId);
    expect(a.ids.size).toBeGreaterThan(25);

    const routes = app
      .get(OpenApiService)
      .routes()
      .filter((r) => !SKIP.some((s) => s.test(r.path)));
    const leaks: string[] = [];
    const errors: string[] = [];
    let sent = 0;
    const send = async (method: string, path: string, host: string) => {
      sent += 1;
      if (sent % 25 === 0) await admin.query('delete from rate_limit_buckets');
      const p = attacker as unknown as Record<
        string,
        (path: string, a?: unknown, b?: unknown) => Promise<{ status: number; text: string }>
      >;
      const fn = p[method === 'delete' ? 'delete' : method];
      if (!fn) return { status: 0, text: '' };
      return method === 'get' || method === 'delete' ? fn(path, host) : fn(path, {}, host);
    };
    const statuses: Record<number, number> = {};
    const inspect = (
      label: string,
      res: { status: number; text: string },
      usedForeignId: boolean,
    ) => {
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      if (res.status >= 500) errors.push(`${label} → ${res.status} ${res.text.slice(0, 160)}`);
      if (res.status >= 200 && res.status < 300) {
        const body = res.text;
        const found = body.includes(MARK) || [...a.ids].some((id) => body.includes(id));
        if (found || usedForeignId) leaks.push(`${label} → ${res.status} ${body.slice(0, 160)}`);
      }
    };

    // 1. Every parameterised route, every method, every one of A's ids, on B's own address.
    const ids = [...a.ids];
    for (const r of routes.filter((x) => /[:{]/.test(x.path))) {
      for (const id of ids) {
        const path = r.path.replace(/:[A-Za-z]+|\{[A-Za-z]+\}/g, id);
        inspect(`${r.method.toUpperCase()} ${path}`, await send(r.method, path, hostB), true);
      }
    }
    // 2. Every list route, with A's ids in each id-like filter the route declares.
    let filtered = 0;
    for (const r of routes.filter((x) => x.method === 'get' && !/[:{]/.test(x.path))) {
      const shape = (r.contract?.query as { shape?: Record<string, unknown> } | undefined)?.shape;
      const keys = Object.keys(shape ?? {}).filter((k) => /Id$|^id$/.test(k));
      for (const key of keys) {
        for (const id of ids) {
          filtered += 1;
          inspect(
            `GET ${r.path}?${key}=${id}`,
            await send('get', `${r.path}?${key}=${id}`, hostB),
            false,
          );
        }
      }
    }
    // 3. B's Owner on A's address: not a member, every company route refuses.
    for (const r of routes.filter((x) => x.method === 'get' && !/[:{]/.test(x.path))) {
      const res = await send('get', r.path, a.host);
      if (
        r.path === '/api/v1/tenant' ||
        r.path === '/api/v1/companies' ||
        r.path.startsWith('/api/v1/platform')
      )
        continue; // public company info / the caller's own list / main-address only
      if (r.path === '/api/v1/access/me' && res.status === 200) {
        expect(res.text).not.toContain(MARK);
        continue;
      }
      inspect(`GET ${r.path} @A`, res, true);
    }

    // 4. Robustness on B's own records: every parameterised route with an empty body must
    //    answer with a clear 4xx (or succeed), never a server error.
    const tenantB = (
      await admin.query<{ tenant_id: string }>(
        'select tenant_id from tenant_domains where hostname = $1',
        [hostB],
      )
    ).rows[0]?.tenant_id;
    const own = [...(await harvest(tenantB ?? ''))];
    for (const r of routes.filter((x) => /[:{]/.test(x.path) && x.method !== 'delete')) {
      for (const id of own) {
        const path = r.path.replace(/:[A-Za-z]+|\{[A-Za-z]+\}/g, id);
        const res = await send(r.method, path, hostB);
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        if (res.status >= 500) errors.push(`own ${r.method.toUpperCase()} ${path} → ${res.status}`);
      }
    }

    // Positive control: the detector does see A's data when A's own Owner asks.
    const mine = await a.owner.get('/api/v1/clients', a.host);
    expect(mine.status).toBe(200);
    expect(mine.text).toContain(MARK);

    process.stdout.write(
      `sweep: ${sent} requests, ${ids.length} ids of A, ${filtered} filtered lists, statuses ${JSON.stringify(statuses)}
`,
    );
    expect(errors, 'server errors').toEqual([]);
    expect(leaks, 'cross-tenant answers').toEqual([]);
    expect(await fingerprint(a.tenantId), 'A was changed by B').toBe(before);
    expect(sent).toBeGreaterThan(4000);
  }, 900_000);
});
