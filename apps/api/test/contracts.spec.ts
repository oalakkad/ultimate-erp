import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  type Contract,
  contractListResponseSchema,
  contractSchema,
  contractVersionListResponseSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  meResponseSchema,
  notificationListResponseSchema,
  templateSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { ContractsDailyHandler, kuwaitToday } from '../src/modules/contracts/contracts.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 4 acceptance (docs/modules/contracts.md §7) against real Postgres + Mailpit.

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
  host: string;
  clientId: string;
}

async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  await join(manager, host, owner, 'manager');
  const client = await owner.post(
    '/api/v1/clients',
    { legalNameEn: 'Al Noor Trading', legalNameAr: 'شركة النور للتجارة' },
    host,
  );
  expect(client.status).toBe(201);
  return { owner, manager, host, clientId: (client.body as { id: string }).id };
}

const ok = (res: { status: number; body: unknown }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return contractSchema.parse(res.body);
};

async function blank(f: Firm, terms: object = {}): Promise<Contract> {
  return ok(
    await f.manager.post(
      '/api/v1/contracts',
      {
        kind: 'contract',
        clientId: f.clientId,
        titleEn: 'Audit services',
        titleAr: 'خدمات التدقيق',
        ...terms,
      },
      f.host,
    ),
    201,
  );
}

/** A clean file uploaded by `p` (inserted directly: the files suite covers real uploads). */
async function cleanFileOf(p: Person, host: string): Promise<string> {
  const userId = meResponseSchema.parse((await p.get('/api/v1/auth/me', host)).body).user.id;
  const tenantId = ((await p.get('/api/v1/access/me', host)).body as { tenantId: string }).tenantId;
  const { rows } = await admin.query<{ id: string }>(
    `insert into files (tenant_id, uploaded_by_user_id, display_name, content_type, size_bytes, sha256, storage_key, status)
     values ($1::uuid, $2, 'signed.pdf', 'application/pdf', 10, 'x', 'tenants/' || $1::text || '/files/' || gen_random_uuid(), 'clean') returning id`,
    [tenantId, userId],
  );
  return rows[0]?.id ?? '';
}

/** Takes a document with text all the way to "active" (Manager prepares, Owner approves). */
async function activate(f: Firm, terms: object = {}): Promise<Contract> {
  const c = await blank(f, terms);
  ok(
    await f.manager.post(
      `/api/v1/contracts/${c.id}/versions`,
      { bodyEn: 'Terms', bodyAr: 'الشروط' },
      f.host,
    ),
    201,
  );
  ok(await f.manager.post(`/api/v1/contracts/${c.id}/submit`, {}, f.host));
  ok(await f.owner.post(`/api/v1/contracts/${c.id}/approve`, {}, f.host));
  ok(await f.manager.post(`/api/v1/contracts/${c.id}/send`, {}, f.host));
  ok(
    await f.manager.post(
      `/api/v1/contracts/${c.id}/sign`,
      { fileId: await cleanFileOf(f.manager, f.host) },
      f.host,
    ),
  );
  return ok(await f.manager.post(`/api/v1/contracts/${c.id}/activate`, {}, f.host));
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

describe('templates, numbering and versions', () => {
  it('fills a bilingual template for a client and numbers documents per kind', async () => {
    const f = await firm();
    const template = templateSchema.parse(
      (
        await f.owner.post(
          '/api/v1/contract-templates',
          {
            kind: 'engagement_letter',
            name: 'Annual audit',
            bodyEn:
              'Dear {{client.name}}, letter {{document.number}} from {{company.name}} for {{ value }}. {{unknown}}',
            bodyAr: 'السادة {{client.name}}، خطاب رقم {{document.number}}',
          },
          f.host,
        )
      ).body,
    );
    expect(
      (
        await f.manager.post(
          '/api/v1/contract-templates',
          { kind: 'contract', name: 'x', bodyEn: 'x', bodyAr: 'x' },
          f.host,
        )
      ).status,
    ).toBe(403);

    const letter = ok(
      await f.manager.post(
        '/api/v1/contracts',
        {
          kind: 'engagement_letter',
          clientId: f.clientId,
          templateId: template.id,
          titleEn: 'Audit FY2026',
          titleAr: 'تدقيق 2026',
          valueAmount: '12500.500',
        },
        f.host,
      ),
      201,
    );
    expect(letter).toMatchObject({
      number: 'EL-0001',
      currentVersion: 1,
      status: 'draft',
      valueAmount: '12500.500',
      currency: 'KWD',
    });
    expect((await blank(f)).number).toBe('CT-0001');

    const [v1] = contractVersionListResponseSchema.parse(
      (await f.manager.get(`/api/v1/contracts/${letter.id}/versions`, f.host)).body,
    ).items;
    expect(v1?.bodyEn).toBe(
      'Dear Al Noor Trading, letter EL-0001 from Test Co for 12500.500 KWD. {{unknown}}',
    );
    expect(v1?.bodyAr).toBe('السادة شركة النور للتجارة، خطاب رقم EL-0001');
  });

  it('keeps every text change as a version, and only drafts can change', async () => {
    const f = await firm();
    const c = await blank(f);
    expect((await f.manager.post(`/api/v1/contracts/${c.id}/submit`, {}, f.host)).status).toBe(422); // no text yet
    ok(
      await f.manager.post(
        `/api/v1/contracts/${c.id}/versions`,
        { bodyEn: 'v1', bodyAr: 'ن1' },
        f.host,
      ),
      201,
    );
    ok(
      await f.manager.post(
        `/api/v1/contracts/${c.id}/versions`,
        { bodyEn: 'v2', bodyAr: 'ن2', changeNote: 'fees' },
        f.host,
      ),
      201,
    );
    const versions = contractVersionListResponseSchema.parse(
      (await f.manager.get(`/api/v1/contracts/${c.id}/versions`, f.host)).body,
    );
    expect(versions.items.map((v) => [v.versionNo, v.bodyEn, v.authorName])).toEqual([
      [2, 'v2', 'manager'],
      [1, 'v1', 'manager'],
    ]);
    ok(await f.manager.post(`/api/v1/contracts/${c.id}/submit`, {}, f.host));
    const late = await f.manager.post(
      `/api/v1/contracts/${c.id}/versions`,
      { bodyEn: 'v3', bodyAr: 'ن3' },
      f.host,
    );
    expect(late.status).toBe(409);
    expect(errorOf(late.body).details).toEqual([{ path: 'status', code: 'not_draft' }]);
  });

  it('refuses an end date before the start date', async () => {
    const f = await firm();
    const res = await f.manager.post(
      '/api/v1/contracts',
      {
        kind: 'contract',
        clientId: f.clientId,
        titleEn: 'x',
        titleAr: 'x',
        startDate: '2026-12-01',
        endDate: '2026-11-01',
      },
      f.host,
    );
    expect(res.status).toBe(422);
  });
});

describe('approval workflow', () => {
  it('nobody approves what they submitted; approvers are notified; reject returns to draft with the reason', async () => {
    const f = await firm();
    const mine = await blank(f);
    ok(
      await f.owner.post(
        `/api/v1/contracts/${mine.id}/versions`,
        { bodyEn: 'x', bodyAr: 'x' },
        f.host,
      ),
      201,
    );
    ok(await f.owner.post(`/api/v1/contracts/${mine.id}/submit`, {}, f.host));
    const self = await f.owner.post(`/api/v1/contracts/${mine.id}/approve`, {}, f.host);
    expect(self.status).toBe(403);

    const c = await blank(f);
    ok(
      await f.manager.post(
        `/api/v1/contracts/${c.id}/versions`,
        { bodyEn: 'x', bodyAr: 'x' },
        f.host,
      ),
      201,
    );
    const submitted = ok(await f.manager.post(`/api/v1/contracts/${c.id}/submit`, {}, f.host));
    expect(submitted.actions).toEqual([]); // the Manager can neither approve nor edit now
    expect((await f.manager.post(`/api/v1/contracts/${c.id}/approve`, {}, f.host)).status).toBe(
      403,
    );
    const inbox = notificationListResponseSchema.parse(
      (await f.owner.get('/api/v1/notifications', f.host)).body,
    );
    expect(
      inbox.items.some((n) => n.type === 'contracts.submitted' && n.link === `/contracts/${c.id}`),
    ).toBe(true);

    const rejected = ok(
      await f.owner.post(`/api/v1/contracts/${c.id}/reject`, { reason: 'Fee is wrong' }, f.host),
    );
    expect(rejected).toMatchObject({
      status: 'draft',
      reviewNote: 'Fee is wrong',
      submittedBy: null,
    });
    const managerInbox = notificationListResponseSchema.parse(
      (await f.manager.get('/api/v1/notifications', f.host)).body,
    );
    expect(managerInbox.items[0]?.type).toBe('contracts.rejected');
  });

  it('runs sent → signed (with a counter-signed copy) → active → terminated, and refuses skipped steps', async () => {
    const f = await firm();
    const c = await blank(f);
    const skip = await f.manager.post(`/api/v1/contracts/${c.id}/activate`, {}, f.host);
    expect(skip.status).toBe(409);
    expect(errorOf(skip.body).details).toEqual([{ path: 'status', code: 'invalid_transition' }]);

    ok(
      await f.manager.post(
        `/api/v1/contracts/${c.id}/versions`,
        { bodyEn: 'x', bodyAr: 'x' },
        f.host,
      ),
      201,
    );
    ok(await f.manager.post(`/api/v1/contracts/${c.id}/submit`, {}, f.host));
    const approved = ok(await f.owner.post(`/api/v1/contracts/${c.id}/approve`, {}, f.host));
    expect(approved.approvedBy?.name).toBe('founder');
    ok(await f.manager.post(`/api/v1/contracts/${c.id}/send`, {}, f.host));
    const noFile = await f.manager.post(
      `/api/v1/contracts/${c.id}/sign`,
      { fileId: '00000000-0000-7000-8000-000000000000' },
      f.host,
    );
    expect(noFile.status).toBe(422);
    const ownersFile = await cleanFileOf(f.owner, f.host);
    expect(
      (await f.manager.post(`/api/v1/contracts/${c.id}/sign`, { fileId: ownersFile }, f.host))
        .status,
    ).toBe(422);
    const signed = ok(
      await f.manager.post(
        `/api/v1/contracts/${c.id}/sign`,
        { fileId: await cleanFileOf(f.manager, f.host), signedOn: '2026-10-20' },
        f.host,
      ),
    );
    expect(signed).toMatchObject({ status: 'signed', signedFile: { status: 'clean' } });
    expect(signed.actions.sort()).toEqual(['activate', 'terminate']);
    ok(await f.manager.post(`/api/v1/contracts/${c.id}/activate`, {}, f.host));
    expect((await f.manager.post(`/api/v1/contracts/${c.id}/terminate`, {}, f.host)).status).toBe(
      422,
    ); // reason required
    const ended = ok(
      await f.manager.post(
        `/api/v1/contracts/${c.id}/terminate`,
        { reason: 'Client closed' },
        f.host,
      ),
    );
    expect(ended).toMatchObject({
      status: 'terminated',
      terminationReason: 'Client closed',
      actions: [],
    });
  });
});

describe('daily contract check', () => {
  it('reminds once before the end date and expires contracts after it — per company', async () => {
    const f = await firm();
    const soon = await activate(f, { endDate: day(10), renewalNoticeDays: 30 });
    const late = await activate(f, { startDate: day(-40), endDate: day(-1) });
    const far = await activate(f, { endDate: day(200) });
    const other = await firm();
    const theirs = await activate(other, { endDate: day(5) });

    const handler = worker.get(ContractsDailyHandler);
    await handler.handle({ id: 'test-run-1' });
    const after = async (c: Contract, p: Firm) =>
      contractSchema.parse((await p.manager.get(`/api/v1/contracts/${c.id}`, p.host)).body).status;
    expect(await after(late, f)).toBe('expired');
    expect(await after(soon, f)).toBe('active');
    expect(await after(far, f)).toBe('active');
    expect(await after(theirs, other)).toBe('active');

    const inbox = async (p: Person, host: string) =>
      notificationListResponseSchema.parse(
        (await p.get('/api/v1/notifications?limit=50', host)).body,
      ).items;
    const mine = (await inbox(f.owner, f.host)).filter(
      (n) => n.type === 'contracts.renewal_due' || n.type === 'contracts.expired',
    );
    expect(mine.map((n) => [n.type, n.params.number]).sort()).toEqual([
      ['contracts.expired', late.number],
      ['contracts.renewal_due', soon.number],
    ]);
    const theirsInbox = (await inbox(other.owner, other.host)).filter(
      (n) => n.type === 'contracts.renewal_due',
    );
    expect(theirsInbox.map((n) => n.params.number)).toEqual([theirs.number]);

    await handler.handle({ id: 'test-run-2' });
    const again = (await inbox(f.owner, f.host)).filter((n) => n.type === 'contracts.renewal_due');
    expect(again).toHaveLength(1); // reminded once only
  });
});

describe('lists, dashboard, permissions and boundaries', () => {
  it('filters by client, status and expiring soon; the dashboard counts real contracts', async () => {
    const f = await firm();
    await activate(f, { endDate: day(20) });
    await activate(f, { endDate: day(300) });
    await blank(f);
    const list = async (q: string) =>
      contractListResponseSchema.parse((await f.manager.get(`/api/v1/contracts?${q}`, f.host)).body)
        .items;
    expect(await list(`clientId=${f.clientId}`)).toHaveLength(3);
    expect(await list('status=active')).toHaveLength(2);
    expect(await list('expiringWithinDays=60')).toHaveLength(1);
    expect((await list('search=النور')).length).toBe(3);
    const summary = dashboardSummarySchema.parse(
      (await f.owner.get('/api/v1/dashboard/summary', f.host)).body,
    );
    expect(summary.contracts).toEqual({ active: 2, expiringSoon: 1 });
  });

  it('an Employee cannot see contracts; another company gets 404', async () => {
    const f = await firm();
    const c = await blank(f);
    const employee = await person('employee');
    await join(employee, f.host, f.owner, 'employee');
    expect((await employee.get('/api/v1/contracts', f.host)).status).toBe(403);
    const other = await founder();
    expect((await other.owner.get(`/api/v1/contracts/${c.id}`, other.host)).status).toBe(404);
    expect(
      (await other.owner.post(`/api/v1/contracts/${c.id}/submit`, {}, other.host)).status,
    ).toBe(404);
    const foreignClient = await other.owner.post(
      '/api/v1/contracts',
      { kind: 'contract', clientId: f.clientId, titleEn: 'x', titleAr: 'x' },
      other.host,
    );
    expect(foreignClient.status).toBe(422);
  });
});
