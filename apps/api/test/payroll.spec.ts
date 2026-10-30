import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  errorResponseSchema,
  leaveRequestSchema,
  leaveTypeListResponseSchema,
  type PayrollRun,
  payrollRunSchema,
  payslipListResponseSchema,
  ruleSetListResponseSchema,
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

// Phase 11 acceptance (docs/modules/payroll.md §8) against real Postgres + Mailpit.

let database: TestDatabase;
let mailpit: TestMailpit;
let app: INestApplication;
let worker: INestApplicationContext;
let server: Server;
let admin: pg.Pool;
const { person, founder, join, enableTwoFactor } = people(
  () => server,
  () => mailpit,
);
const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

/** Last month as "YYYY-MM" and its first Sunday + Monday (two working days). */
function lastMonth() {
  const today = new Date(`${kuwaitToday()}T00:00:00Z`);
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const period = first.toISOString().slice(0, 7);
  const sunday = new Date(first.getTime() + ((7 - first.getUTCDay()) % 7) * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { period, sunday: iso(sunday), monday: iso(new Date(sunday.getTime() + 86_400_000)) };
}

interface Firm {
  owner: Person;
  ceo: Person;
  hr: Person;
  a: Person;
  aId: string;
  b: Person;
  bId: string;
  host: string;
}

async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const ceo = await person('ceo');
  await join(ceo, host, owner, 'ceo');
  await enableTwoFactor(ceo);
  const hr = await person('hr');
  await join(hr, host, owner, 'hr_payroll');
  await enableTwoFactor(hr);
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
  const b = await person('empb');
  const bId = await join(b, host, owner, 'employee');
  for (const id of [aId, bId]) {
    expect(
      (await owner.post('/api/v1/people', { membershipId: id, joinDate: '2026-01-01' }, host))
        .status,
    ).toBe(201);
  }
  const salary = (membershipId: string, basic: string, allowances: object[]) =>
    hr.post(
      '/api/v1/payroll/salaries',
      { membershipId, effectiveFrom: '2026-01-01', basic, allowances, socialInsurance: true },
      host,
    );
  expect(
    (await salary(aId, '1000.000', [{ code: 'housing', label: 'Housing', amount: '150.000' }]))
      .status,
  ).toBe(201);
  expect((await salary(bId, '800.000', [])).status).toBe(201);
  return { owner, ceo, hr, a, aId, b, bId, host };
}

const ok = (res: { status: number; body: unknown }, status = 200): PayrollRun => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return payrollRunSchema.parse(res.body);
};
const enableOvertime = (f: Firm) =>
  f.hr.post(
    '/api/v1/payroll/rules',
    {
      effectiveFrom: '2026-01-01',
      note: 'Overtime on (to be verified)',
      rules: {
        workingDaysDivisor: '26',
        monthlyHours: '208',
        overtime: { enabled: true, multiplier: '1.25' },
        unpaidLeave: { enabled: true },
        lateDeduction: { enabled: false },
        socialInsurance: { enabled: false, employeePercent: '0' },
      },
    },
    f.host,
  );

/** A calculated last-month run: A has 4 overtime hours, a 50 KWD bonus and 2 unpaid-leave days. */
async function calculatedRun(f: Firm) {
  const m = lastMonth();
  const types = leaveTypeListResponseSchema.parse(
    (await f.a.get('/api/v1/leave/types', f.host)).body,
  );
  const unpaid = types.items.find((t) => t.code === 'unpaid')?.id ?? '';
  const leave = leaveRequestSchema.parse(
    (
      await f.a.post(
        '/api/v1/leave/requests',
        { leaveTypeId: unpaid, startDate: m.sunday, endDate: m.monday },
        f.host,
      )
    ).body,
  );
  await f.owner.post(`/api/v1/leave/requests/${leave.id}/approve`, {}, f.host);
  await enableOvertime(f);
  const run = ok(await f.hr.post('/api/v1/payroll/runs', { period: m.period }, f.host), 201);
  ok(
    await f.hr.put(
      `/api/v1/payroll/runs/${run.id}/inputs`,
      {
        inputs: [
          { membershipId: f.aId, kind: 'overtime_hours', value: '4' },
          { membershipId: f.aId, kind: 'bonus', value: '50', note: 'Q3 bonus' },
        ],
      },
      f.host,
    ),
  );
  return {
    run: ok(await f.hr.post(`/api/v1/payroll/runs/${run.id}/calculate`, {}, f.host)),
    period: m.period,
  };
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

describe('rules and salaries', () => {
  it('starts with flagged rules, versions every change and keeps salaries private', async () => {
    const f = await firm();
    const rules = ruleSetListResponseSchema.parse(
      (await f.hr.get('/api/v1/payroll/rules', f.host)).body,
    );
    expect(rules.items).toHaveLength(1);
    expect(rules.items[0]).toMatchObject({
      version: 1,
      toVerify: true,
      rules: {
        overtime: { enabled: false },
        socialInsurance: { enabled: false, employeePercent: '0' },
      },
    });
    const v2 = ruleSetListResponseSchema.parse((await enableOvertime(f)).body);
    expect(v2.items.map((r) => r.version)).toEqual([2, 1]);
    expect(v2.items[0]?.toVerify).toBe(true);

    // Employees see no salaries, rules or runs (the founder is Owner and CEO, so has payroll).
    expect((await f.a.get('/api/v1/payroll/salaries', f.host)).status).toBe(403);
    expect((await f.a.post('/api/v1/payroll/runs', { period: '2026-01' }, f.host)).status).toBe(
      403,
    );
    // Reading salaries is audited; amounts never reach the audit log.
    await f.hr.get('/api/v1/payroll/salaries', f.host);
    const audits = await admin.query<{ details: unknown }>(
      `select details from audit_events where action like 'payroll.salar%'`,
    );
    expect(audits.rowCount).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audits.rows)).not.toContain('1000');
  });
});

describe('a payroll run', () => {
  it('calculates traceable payslips exactly and prevents a second run for the month', async () => {
    const f = await firm();
    const { run, period } = await calculatedRun(f);
    expect(run).toMatchObject({ status: 'calculated', testRun: true, ruleSetVersion: 2 });
    const a = run.payslips.find((p) => p.person.membershipId === f.aId);
    expect(a?.lines.map((l) => [l.code, l.amount])).toEqual([
      ['basic', '1000.000'],
      ['allowance.housing', '150.000'],
      ['overtime', '24.038'],
      ['bonus', '50.000'],
      ['unpaid_leave', '-76.923'],
    ]);
    expect(a).toMatchObject({ gross: '1224.038', deductions: '76.923', net: '1147.115' });
    expect(run.payslips.find((p) => p.person.membershipId === f.bId)?.net).toBe('800.000');
    expect(run.totals).toMatchObject({ people: 2, net: '1947.115' });
    const again = await f.hr.post('/api/v1/payroll/runs', { period }, f.host);
    expect(again.status).toBe(409);
    expect(errorOf(again.body).details?.[0]?.code).toBe('exists');
    // Employees see nothing before approval.
    expect(
      payslipListResponseSchema.parse((await f.a.get('/api/v1/payroll/payslips/mine', f.host)).body)
        .items,
    ).toHaveLength(0);
  });

  it('separates preparation, approval and payment, and never pays a test run', async () => {
    const f = await firm();
    const { run } = await calculatedRun(f);
    ok(await f.hr.post(`/api/v1/payroll/runs/${run.id}/submit`, {}, f.host));
    expect((await f.hr.post(`/api/v1/payroll/runs/${run.id}/calculate`, {}, f.host)).status).toBe(
      409,
    );
    expect((await f.hr.post(`/api/v1/payroll/runs/${run.id}/approve`, {}, f.host)).status).toBe(
      403,
    );
    const approved = ok(await f.ceo.post(`/api/v1/payroll/runs/${run.id}/approve`, {}, f.host));
    expect(approved.status).toBe('approved');
    expect(approved.actions).not.toContain('pay');

    // Payslips: own only, after approval.
    const mine = payslipListResponseSchema.parse(
      (await f.a.get('/api/v1/payroll/payslips/mine', f.host)).body,
    );
    expect(mine.items.map((p) => p.net)).toEqual(['1147.115']);
    expect(mine.items[0]?.run.testRun).toBe(true);
    expect(
      (await f.b.get(`/api/v1/payroll/payslips/${mine.items[0]?.id ?? ''}`, f.host)).status,
    ).toBe(404);

    // A test run (unverified rules) is never paid — in the API and in the database.
    const pay = await f.ceo.post(`/api/v1/payroll/runs/${run.id}/pay`, {}, f.host);
    expect(errorOf(pay.body).details?.[0]?.code).toBe('rules_not_verified');
    const { rows } = await admin.query<{ id: string }>(
      `select id from memberships where tenant_id = (select tenant_id from payroll_runs where id = $1::uuid) limit 1`,
      [run.id],
    );
    expect(rows.length).toBe(1);
    await expect(
      admin.query(
        `update payroll_runs set status = 'paid', paid_by_user_id = approved_by_user_id where id = $1::uuid`,
        [run.id],
      ),
    ).rejects.toThrow(/not verified/);
    await expect(
      admin.query(`delete from payslips where run_id = $1::uuid`, [run.id]),
    ).rejects.toThrow(/can no longer change/);

    // Export (authorised, audited) and payment after verification — once.
    expect((await f.hr.get(`/api/v1/payroll/runs/${run.id}/export.csv`, f.host)).status).toBe(403);
    const csv = await f.ceo.get(`/api/v1/payroll/runs/${run.id}/export.csv`, f.host);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('"1147.115"');
    const rules = ruleSetListResponseSchema.parse(
      (await f.ceo.get('/api/v1/payroll/rules', f.host)).body,
    );
    const v2 = rules.items.find((r) => r.version === 2)?.id ?? '';
    expect(
      (await f.hr.post(`/api/v1/payroll/rules/${v2}/verify`, { confirm: true, note: 'x' }, f.host))
        .status,
    ).toBe(403);
    await f.ceo.post(
      `/api/v1/payroll/rules/${v2}/verify`,
      { confirm: true, note: 'Checked by our accountant' },
      f.host,
    );
    const paid = ok(await f.ceo.post(`/api/v1/payroll/runs/${run.id}/pay`, {}, f.host));
    expect(paid).toMatchObject({ status: 'paid', testRun: false });
    expect((await f.ceo.post(`/api/v1/payroll/runs/${run.id}/pay`, {}, f.host)).status).toBe(409);
    expect((await f.hr.post(`/api/v1/payroll/runs/${run.id}/cancel`, {}, f.host)).status).toBe(409);
  });

  it('never lets the preparer approve, keeps old runs on their rule version, and frees a cancelled month', async () => {
    const f = await firm();
    const { run } = await calculatedRun(f);
    // The CEO prepares a second month and cannot approve it themself.
    const own = ok(await f.ceo.post('/api/v1/payroll/runs', { period: '2026-01' }, f.host), 201);
    ok(await f.ceo.post(`/api/v1/payroll/runs/${own.id}/calculate`, {}, f.host));
    ok(await f.ceo.post(`/api/v1/payroll/runs/${own.id}/submit`, {}, f.host));
    expect((await f.ceo.post(`/api/v1/payroll/runs/${own.id}/approve`, {}, f.host)).status).toBe(
      403,
    );

    // A new rule version does not change an existing run.
    await f.hr.post(
      '/api/v1/payroll/rules',
      {
        effectiveFrom: '2026-01-01',
        note: 'v3',
        rules: {
          workingDaysDivisor: '30',
          monthlyHours: '208',
          overtime: { enabled: true, multiplier: '1.5' },
          unpaidLeave: { enabled: true },
          lateDeduction: { enabled: false },
          socialInsurance: { enabled: false, employeePercent: '0' },
        },
      },
      f.host,
    );
    const same = ok(await f.hr.get(`/api/v1/payroll/runs/${run.id}`, f.host));
    expect(same.ruleSetVersion).toBe(2);
    expect(same.payslips.find((p) => p.person.membershipId === f.aId)?.net).toBe('1147.115');

    ok(await f.hr.post(`/api/v1/payroll/runs/${own.id}/cancel`, {}, f.host));
    ok(await f.hr.post('/api/v1/payroll/runs', { period: '2026-01' }, f.host), 201);
  });
});
