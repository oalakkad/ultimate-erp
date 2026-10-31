import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestMailpit, tokenFrom } from '../support/mailpit.js';
import { codeAt } from '../support/totp.js';
import { type LoadResult, runLoad, type Scenario, Session, send, table } from './load.js';
import { seedVolume, VOLUME } from './volume-seed.js';

// Phase 15c performance test (docs/performance.md): `pnpm perf`. A company at the architecture
// target (architecture.md section 7b) behind the BUILT API and worker running as separate
// processes; reads must stay under 300 ms and writes under 500 ms at the 95th percentile.

const PORT = 3199;
const API_DIR = fileURLToPath(new URL('../../', import.meta.url));
const PASSWORD = 'perf correct horse battery staple';
const READ_TARGET_MS = 300;
const WRITE_TARGET_MS = 500;
// Reports aggregate up to a year of data (~1 million time entries at target size).
const REPORT_TARGET_MS = 2000;
/** The executive dashboard combines ~15 counts and sums across modules. */
const DASHBOARD_TARGET_MS = 500;

let database: TestDatabase;
let mailpit: TestMailpit;
const processes: ChildProcess[] = [];
let owner: Session;
let employee: Session;
let host: string;
let employeeTaskId: string;
const results: LoadResult[] = [];
const log = (line: string) => process.stdout.write(`${line}\n`);

function start(script: string): ChildProcess {
  const child = spawn(process.execPath, ['--enable-source-maps', script], {
    cwd: API_DIR,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'development',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: 'false',
      API_HOST: '127.0.0.1',
      API_PORT: String(PORT),
      DATABASE_URL: database.appUrl,
      AUTH_SECRET: 'perf-run-auth-secret-0123456789-abcdefghijklmnop',
      DATA_ENCRYPTION_KEY: 'perf-run-data-key-0123456789-abcdefghijklmnopqrs',
      APP_PUBLIC_URL: `http://localhost:${PORT}`,
      PASSWORD_BREACH_CHECK: 'false',
      CLAMAV_PORT: '1',
      ...mailpit.smtpConfig,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
  child.stdout.resume();
  processes.push(child);
  return child;
}

async function account(prefix: string): Promise<{ session: Session; email: string }> {
  const email = `${prefix}-${Date.now().toString(36)}@example.com`;
  const session = new Session(PORT);
  expect(
    (
      await session.call('POST', '/api/v1/auth/sign-up', 'localhost', {
        email,
        password: PASSWORD,
        name: prefix,
      })
    ).status,
  ).toBe(202);
  const token = tokenFrom(await mailpit.waitFor(email, 'Confirm your email'));
  await session.call('GET', `/api/v1/auth/verify-email?token=${token}`, 'localhost');
  const signIn = await session.call('POST', '/api/v1/auth/sign-in', 'localhost', {
    email,
    password: PASSWORD,
  });
  expect(signIn.status, signIn.body).toBe(200);
  return { session, email };
}

const scalar = async (sql: string, params: unknown[] = []): Promise<string> => {
  const client = new pg.Client({ connectionString: database.migratorUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ v: string }>(sql, params);
    return rows[0]?.v ?? '';
  } finally {
    await client.end();
  }
};

beforeAll(async () => {
  [database, mailpit] = await Promise.all([
    startTestDatabase({
      serverSettings: {
        shared_preload_libraries: 'pg_stat_statements',
        'pg_stat_statements.track': 'top',
      },
    }),
    TestMailpit.start(),
  ]);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('create extension if not exists pg_stat_statements');
  // The seed uses temporary tables; production roles deliberately lack this right.
  const dbName = new URL(database.adminUrl).pathname.slice(1);
  await admin.query(
    `grant temporary on database ${admin.escapeIdentifier(dbName)} to erp_migrator`,
  );
  await admin.end();

  start('dist/main.js');
  start('dist/worker.js');
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ok = await send({
      port: PORT,
      method: 'GET',
      path: '/api/v1/health',
      host: 'localhost',
    }).then(
      (r) => r.status === 200,
      () => false,
    );
    if (ok) break;
    if (Date.now() > deadline) throw new Error('API did not start');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Real accounts through the API: the owner (with two-factor) and one employee.
  const o = await account('perf-owner');
  owner = o.session;
  const slug = `perf-${Date.now().toString(36)}`;
  host = `${slug}.localhost`;
  expect(
    (
      await owner.call('POST', '/api/v1/companies', 'localhost', {
        slug,
        nameEn: 'Perf Audit Co',
        nameAr: 'شركة الأداء',
      })
    ).status,
  ).toBe(201);
  const setup = JSON.parse(
    (
      await owner.call('POST', '/api/v1/auth/two-factor/enable', 'localhost', {
        password: PASSWORD,
      })
    ).body,
  ) as { totpUri: string };
  expect(
    (
      await owner.call('POST', '/api/v1/auth/two-factor/confirm', 'localhost', {
        code: await codeAt(setup.totpUri, 0),
      })
    ).status,
  ).toBe(200);
  const e = await account('perf-employee');
  employee = e.session;

  const tenantId = await scalar(
    'select tenant_id::text as v from tenant_domains where hostname = $1',
    [host],
  );
  const ownerUserId = await scalar('select id::text as v from users where email = $1', [o.email]);
  const ownerMembershipId = await scalar(
    'select id::text as v from memberships where tenant_id = $1 and user_id = $2',
    [tenantId, ownerUserId],
  );
  const employeeUserId = await scalar('select id::text as v from users where email = $1', [
    e.email,
  ]);

  log(
    `Seeding ${VOLUME.employees} people, ${VOLUME.projects} projects, ~${(VOLUME.employees * VOLUME.weeks * 5 * VOLUME.entriesPerDay).toLocaleString('en')} time entries:`,
  );
  const seeded = Date.now();
  await seedVolume(
    database.migratorUrl,
    { tenantId, ownerUserId, ownerMembershipId, employeeUserId },
    log,
  );
  log(`Seed finished in ${((Date.now() - seeded) / 60_000).toFixed(1)} min.`);
  employeeTaskId = await scalar(
    `select a.task_id::text as v from task_allocations a join memberships m on m.tenant_id = a.tenant_id and m.id = a.membership_id
      where m.user_id = $1 order by a.task_id limit 1`,
    [employeeUserId],
  );
  const admin2 = new pg.Client({ connectionString: database.adminUrl });
  await admin2.connect();
  await admin2.query('select pg_stat_statements_reset()');
  await admin2.end();
}, 30 * 60_000);

afterAll(async () => {
  for (const child of processes) child.kill();
  const started = database as TestDatabase | undefined;
  if (started) {
    const admin = new pg.Client({ connectionString: started.adminUrl });
    await admin.connect();
    const { rows } = await admin.query<{ calls: string; mean: string; max: string; query: string }>(
      `select calls::text, round(mean_exec_time::numeric, 1)::text as mean, round(max_exec_time::numeric, 1)::text as max,
              left(query, 160) as query
         from pg_stat_statements where calls >= 3 and query not ilike '%pg_stat_statements%' order by mean_exec_time desc limit 15`,
    );
    await admin.end();
    log(`\nSlowest statements during the load test (mean ms, ${rows.length} shown):`);
    for (const r of rows)
      log(
        `  ${r.mean.padStart(8)} ms  max ${r.max.padStart(8)}  x${r.calls.padStart(5)}  ${r.query}`,
      );
  }
  if (results.length > 0) {
    const report = table(results);
    log(`\n${report}\n`);
    writeFileSync(new URL('./last-run.md', import.meta.url), `${report}\n`);
  }
  await Promise.all([started?.stop(), (mailpit as TestMailpit | undefined)?.stop()]);
}, 120_000);

const year = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 364 * 86_400_000);
  return `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
};

async function measure(
  session: Session,
  scenarios: Scenario[],
  options: { concurrency: number; durationMs?: number; requests?: number },
) {
  for (const scenario of scenarios) {
    // Warm-up: first requests compile query plans and fill caches.
    await runLoad({
      port: PORT,
      host,
      cookie: session.cookie,
      scenario,
      concurrency: 1,
      requests: 2,
    });
    const result = await runLoad({
      port: PORT,
      host,
      cookie: session.cookie,
      scenario,
      ...options,
    });
    results.push(result);
    log(
      `${scenario.name.padEnd(28)} p95 ${result.p95.toFixed(0).padStart(5)} ms  (${result.requests} requests, ${result.failures} failed)`,
    );
  }
}

describe(`a company with ${VOLUME.employees} people, ${VOLUME.projects} projects and 2 million time entries`, () => {
  it(
    `owner screens: reads stay under ${READ_TARGET_MS} ms at p95 with 10 people at once`,
    async () => {
      const scenarios: Scenario[] = [
        { name: 'access (every page)', kind: 'read', path: '/api/v1/access/me' },
        { name: 'unread notifications', kind: 'read', path: '/api/v1/notifications/unread-count' },
        { name: 'dashboard', kind: 'read', path: '/api/v1/dashboard/summary' },
        { name: 'projects list', kind: 'read', path: '/api/v1/projects' },
        { name: 'tasks list', kind: 'read', path: '/api/v1/tasks' },
        { name: 'workload', kind: 'read', path: '/api/v1/workload' },
        { name: 'time approvals', kind: 'read', path: '/api/v1/approvals/time' },
        { name: 'time summary (year)', kind: 'read', path: `/api/v1/time/summary?${year()}` },
        { name: 'clients list', kind: 'read', path: '/api/v1/clients' },
        { name: 'invoices list', kind: 'read', path: '/api/v1/invoices' },
        { name: 'receivables aging', kind: 'read', path: '/api/v1/billing/aging' },
        {
          name: 'revenue (year)',
          kind: 'read',
          path: `/api/v1/billing/revenue?year=${new Date().getFullYear()}`,
        },
        { name: 'people list', kind: 'read', path: '/api/v1/people' },
        { name: 'members', kind: 'read', path: '/api/v1/members' },
        { name: 'audit log', kind: 'read', path: '/api/v1/audit-events' },
      ];
      await measure(owner, scenarios, { concurrency: 10, durationMs: 8_000 });
      for (const r of results.filter((x) => scenarios.some((s) => s.name === x.name))) {
        expect.soft(r.failures, `${r.name}: failures ${JSON.stringify(r.statuses)}`).toBe(0);
        expect
          .soft(r.p95, `${r.name} p95`)
          .toBeLessThan(r.name === 'dashboard' ? DASHBOARD_TARGET_MS : READ_TARGET_MS);
      }
    },
    15 * 60_000,
  );

  it(
    `employee screens stay under ${READ_TARGET_MS} ms at p95`,
    async () => {
      const scenarios: Scenario[] = [
        { name: 'employee: my tasks', kind: 'read', path: '/api/v1/tasks' },
        { name: 'employee: my timesheet', kind: 'read', path: '/api/v1/timesheets/mine' },
        { name: 'employee: dashboard', kind: 'read', path: '/api/v1/dashboard/summary' },
      ];
      await measure(employee, scenarios, { concurrency: 10, durationMs: 8_000 });
      for (const r of results.filter((x) => scenarios.some((s) => s.name === x.name))) {
        expect.soft(r.failures, `${r.name}: failures ${JSON.stringify(r.statuses)}`).toBe(0);
        expect
          .soft(r.p95, `${r.name} p95`)
          .toBeLessThan(r.name === 'dashboard' ? DASHBOARD_TARGET_MS : READ_TARGET_MS);
      }
    },
    10 * 60_000,
  );

  it(
    `reports over a whole year stay under ${REPORT_TARGET_MS} ms at p95`,
    async () => {
      // 15 runs each keeps the owner inside the report limit (120 per 10 minutes).
      const scenarios: Scenario[] = [
        'utilization',
        'timesheets',
        'profitability',
        'projects',
        'tasks',
        'revenue',
        'receivables',
      ].map((key) => ({
        name: `report: ${key}`,
        kind: 'read' as const,
        path: `/api/v1/reports/${key}?${year()}`,
      }));
      await measure(owner, scenarios, { concurrency: 3, requests: 13 });
      for (const r of results.filter((x) => scenarios.some((s) => s.name === x.name))) {
        expect.soft(r.failures, `${r.name}: failures ${JSON.stringify(r.statuses)}`).toBe(0);
        expect.soft(r.p95, `${r.name} p95`).toBeLessThan(REPORT_TARGET_MS);
      }
    },
    10 * 60_000,
  );

  it(
    `writes stay under ${WRITE_TARGET_MS} ms at p95`,
    async () => {
      const weekStart = new Date();
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      const days = new Date().getUTCDay() + 1;
      await measure(
        owner,
        [
          {
            name: 'create client',
            kind: 'write',
            method: 'POST',
            path: '/api/v1/clients',
            body: (n) => ({
              confirmDuplicate: true,
              legalNameEn: `Load Client ${randomUUID()}`,
              legalNameAr: `عميل ${n}`,
            }),
          },
        ],
        { concurrency: 5, requests: 100 },
      );
      await measure(
        employee,
        [
          {
            name: 'employee: log time',
            kind: 'write',
            method: 'POST',
            path: '/api/v1/time-entries',
            body: (n) => ({
              taskId: employeeTaskId,
              workDate: new Date(weekStart.getTime() + (n % days) * 86_400_000)
                .toISOString()
                .slice(0, 10),
              hours: '0.25',
              description: `Load ${n}`,
              confirmDuplicate: true,
            }),
          },
        ],
        { concurrency: 5, requests: 40 },
      );
      for (const r of results.filter((x) => x.kind === 'write')) {
        expect.soft(r.failures, `${r.name}: failures ${JSON.stringify(r.statuses)}`).toBe(0);
        expect.soft(r.p95, `${r.name} p95`).toBeLessThan(WRITE_TARGET_MS);
      }
    },
    10 * 60_000,
  );
});
