import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  clientActivitySchema,
  clientDocumentListResponseSchema,
  clientListResponseSchema,
  clientSchema,
  contactListResponseSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  interactionListResponseSchema,
  meResponseSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 3 acceptance (docs/modules/clients.md §7) against real Postgres + Mailpit.

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
const base = (en: string, ar = `عميل ${en}`) => ({ legalNameEn: en, legalNameAr: ar });

async function company() {
  const { owner, host } = await founder();
  const manager = await person('manager');
  await join(manager, host, owner, 'manager');
  return { owner, manager, host };
}

async function createClient(p: Person, host: string, body: object) {
  const res = await p.post('/api/v1/clients', body, host);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return clientSchema.parse(res.body);
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

// Each test signs people up from one IP; reset the (working) sign-up rate limit between tests.
beforeEach(async () => {
  await admin.query('delete from rate_limit_buckets');
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await admin.end();
  await Promise.all([database.stop(), mailpit.stop()]);
});

describe('creating clients', () => {
  it('a Manager creates clients with numbers C-0001, C-0002 and bilingual names', async () => {
    const { manager, host } = await company();
    const first = await createClient(manager, host, {
      ...base('Al Noor Trading Co. W.L.L.', 'شركة النور للتجارة ذ.م.م'),
      commercialRegistration: '123456',
      status: 'active',
      email: 'Info@AlNoor.example',
    });
    expect(first).toMatchObject({
      number: 'C-0001',
      legalName: { en: 'Al Noor Trading Co. W.L.L.', ar: 'شركة النور للتجارة ذ.م.م' },
      status: 'active',
      country: 'KW',
      email: 'info@alnoor.example',
      version: 1,
    });
    expect((await createClient(manager, host, base('Gulf Audit'))).number).toBe('C-0002');
  });

  it('refuses a second client with the same commercial registration number', async () => {
    const { manager, host } = await company();
    await createClient(manager, host, { ...base('First'), commercialRegistration: 'cr-77' });
    const res = await manager.post(
      '/api/v1/clients',
      { ...base('Second'), commercialRegistration: 'CR-77' },
      host,
    );
    expect(res.status).toBe(409);
    expect(errorOf(res.body).details).toEqual([
      { path: 'commercialRegistration', code: 'duplicate' },
    ]);
  });

  it('warns about a very similar name, in English or Arabic, until confirmed', async () => {
    const { manager, host } = await company();
    await createClient(manager, host, base('Al-Noor Trading Co.', 'شركة النور للتجارة'));
    for (const body of [
      base('AL NOOR TRADING K.S.C.C.', 'اسم مختلف'),
      base('Different', 'شركه النُّور للتجاره'),
    ]) {
      const res = await manager.post('/api/v1/clients', body, host);
      expect(res.status).toBe(409);
      expect(errorOf(res.body).details).toEqual([
        { path: 'legalNameEn', code: 'possible_duplicate' },
      ]);
    }
    await createClient(manager, host, { ...base('al noor trading'), confirmDuplicate: true });
  });

  it('rejects invalid input with field details', async () => {
    const { manager, host } = await company();
    const res = await manager.post(
      '/api/v1/clients',
      { legalNameEn: '', legalNameAr: 'x', email: 'not-an-email', unexpected: 1 },
      host,
    );
    expect(res.status).toBe(422);
    const paths = errorOf(res.body).details?.map((d) => d.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining(['legalNameEn', 'email']));
  });
});

describe('editing and archiving', () => {
  it('saves an edit based on the current version and refuses a stale one', async () => {
    const { manager, host } = await company();
    const c = await createClient(manager, host, base('Edit Me'));
    const ok = await manager.patch(
      `/api/v1/clients/${c.id}`,
      { version: 1, city: 'Kuwait City', status: 'active' },
      host,
    );
    expect(ok.status).toBe(200);
    expect(clientSchema.parse(ok.body)).toMatchObject({
      city: 'Kuwait City',
      status: 'active',
      version: 2,
    });
    const stale = await manager.patch(
      `/api/v1/clients/${c.id}`,
      { version: 1, city: 'Salmiya' },
      host,
    );
    expect(stale.status).toBe(409);
    expect(errorOf(stale.body).details).toEqual([{ path: 'version', code: 'stale' }]);

    const activity = clientActivitySchema.parse(
      (await manager.get(`/api/v1/clients/${c.id}/activity`, host)).body,
    );
    expect(activity.items[0]).toMatchObject({
      action: 'clients.client.updated',
      actorName: 'manager',
    });
    expect(activity.items[0]?.fields.sort()).toEqual(['city', 'status']);
  });

  it('archive hides a client from the default list but keeps it readable; restore brings it back (Owner only)', async () => {
    const { owner, manager, host } = await company();
    const c = await createClient(manager, host, base('Archive Me'));
    expect((await manager.post(`/api/v1/clients/${c.id}/archive`, {}, host)).status).toBe(403);
    expect((await owner.post(`/api/v1/clients/${c.id}/archive`, {}, host)).status).toBe(200);
    const list = clientListResponseSchema.parse((await manager.get('/api/v1/clients', host)).body);
    expect(list.items.map((i) => i.id)).not.toContain(c.id);
    const archived = clientListResponseSchema.parse(
      (await manager.get('/api/v1/clients?archived=true', host)).body,
    );
    expect(archived.items.map((i) => i.id)).toEqual([c.id]);
    expect(
      clientSchema.parse((await manager.get(`/api/v1/clients/${c.id}`, host)).body).archived,
    ).toBe(true);
    await owner.post(`/api/v1/clients/${c.id}/restore`, {}, host);
    expect(
      clientListResponseSchema.parse((await manager.get('/api/v1/clients', host)).body).items,
    ).toHaveLength(1);
  });
});

describe('finding clients', () => {
  it('searches English and Arabic names, numbers and CR numbers; filters, sorts and pages', async () => {
    const { manager, host } = await company();
    const names = ['Delta', 'Alpha', 'Echo', 'Charlie', 'Bravo'];
    for (const [i, name] of names.entries()) {
      await createClient(manager, host, {
        ...base(name, `عميل ${i}`),
        commercialRegistration: `CR${i}`,
        status: i % 2 === 0 ? 'active' : 'prospect',
      });
    }
    const q = async (query: string) =>
      clientListResponseSchema.parse((await manager.get(`/api/v1/clients?${query}`, host)).body);

    expect((await q('search=char')).items.map((c) => c.legalName.en)).toEqual(['Charlie']);
    expect(
      (await q(`search=${encodeURIComponent('عميل 4')}`)).items.map((c) => c.legalName.en),
    ).toEqual(['Bravo']);
    expect((await q('search=CR2')).items.map((c) => c.legalName.en)).toEqual(['Echo']);
    expect((await q('search=%25')).items).toEqual([]); // "%" is literal, not a wildcard
    expect((await q('status=active')).items.map((c) => c.legalName.en)).toEqual([
      'Bravo',
      'Delta',
      'Echo',
    ]);
    expect((await q('sort=name&dir=desc')).items.map((c) => c.legalName.en)).toEqual([
      'Echo',
      'Delta',
      'Charlie',
      'Bravo',
      'Alpha',
    ]);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof q>> = await q(
        `limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.items.map((c) => c.legalName.en));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    expect((await manager.get('/api/v1/clients?cursor=garbage', host)).status).toBe(422);
  });
});

describe('contacts, communication history and documents', () => {
  it('keeps one primary contact and flags authorized representatives', async () => {
    const { manager, host } = await company();
    const c = await createClient(manager, host, base('Contacts Co'));
    const add = (body: object) => manager.post(`/api/v1/clients/${c.id}/contacts`, body, host);
    expect(
      (await add({ name: 'Sara', isPrimary: true, isAuthorizedRepresentative: true })).status,
    ).toBe(201);
    expect(
      (await add({ name: 'Omar', isPrimary: true, email: 'omar@client.example' })).status,
    ).toBe(201);
    const list = contactListResponseSchema.parse(
      (await manager.get(`/api/v1/clients/${c.id}/contacts`, host)).body,
    );
    expect(list.items.map((x) => [x.name, x.isPrimary, x.isAuthorizedRepresentative])).toEqual([
      ['Omar', true, false],
      ['Sara', false, true],
    ]);
    // The list row (client card) shows the current primary contact.
    const row = clientListResponseSchema
      .parse((await manager.get('/api/v1/clients?search=Contacts', host)).body)
      .items.find((x) => x.id === c.id);
    expect(row?.primaryContact).toBe('Omar');
    expect(row?.accountManagerName).toBeNull();
  });

  it('logs interactions linked to a contact of the same client only', async () => {
    const { manager, host } = await company();
    const a = await createClient(manager, host, base('Client A'));
    const b = await createClient(manager, host, base('Client B'));
    const sara = (await manager.post(`/api/v1/clients/${a.id}/contacts`, { name: 'Sara' }, host))
      .body as { id: string };
    const log = (clientId: string, body: object) =>
      manager.post(
        `/api/v1/clients/${clientId}/interactions`,
        {
          kind: 'call',
          occurredAt: '2026-10-29T10:00:00+03:00',
          summary: 'Discussed the audit scope',
          ...body,
        },
        host,
      );
    expect((await log(a.id, { contactId: sara.id })).status).toBe(201);
    const wrong = await log(b.id, { contactId: sara.id });
    expect(wrong.status).toBe(422);
    expect(errorOf(wrong.body).details).toEqual([{ path: 'contactId', code: 'not_found' }]);
    const history = interactionListResponseSchema.parse(
      (await manager.get(`/api/v1/clients/${a.id}/interactions`, host)).body,
    );
    expect(history.items[0]).toMatchObject({
      kind: 'call',
      contact: { name: 'Sara' },
      authorName: 'manager',
      occurredAt: '2026-10-29T07:00:00.000Z',
    });
  });

  it('attaches only my own files, never infected ones; downloads need a clean file', async () => {
    const { owner, manager, host } = await company();
    const c = await createClient(manager, host, base('Docs Co'));
    const managerId = meResponseSchema.parse((await manager.get('/api/v1/auth/me', host)).body).user
      .id;
    const ownerId = meResponseSchema.parse((await owner.get('/api/v1/auth/me', host)).body).user.id;
    const tenantId = ((await manager.get('/api/v1/access/me', host)).body as { tenantId: string })
      .tenantId;
    const fileRow = async (userId: string, status: string) => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into files (tenant_id, uploaded_by_user_id, display_name, content_type, size_bytes, sha256, storage_key, status)
         values ($1::uuid, $2, 'letter.pdf', 'application/pdf', 10, 'x', 'tenants/' || $1::text || '/files/' || gen_random_uuid(), $3) returning id`,
        [tenantId, userId, status],
      );
      return rows[0]?.id ?? '';
    };
    const attach = (fileId: string) =>
      manager.post(`/api/v1/clients/${c.id}/documents`, { fileId }, host);

    expect(errorOf((await attach(await fileRow(ownerId, 'clean'))).body).details).toEqual([
      { path: 'fileId', code: 'not_found' },
    ]);
    expect(errorOf((await attach(await fileRow(managerId, 'infected'))).body).details).toEqual([
      { path: 'fileId', code: 'infected' },
    ]);
    const pending = await fileRow(managerId, 'pending');
    expect((await attach(pending)).status).toBe(201);
    expect((await attach(pending)).status).toBe(409);
    const docs = clientDocumentListResponseSchema.parse(
      (await owner.get(`/api/v1/clients/${c.id}/documents`, host)).body,
    );
    expect(docs.items.map((d) => [d.file.id, d.file.status, d.addedByName])).toEqual([
      [pending, 'pending', 'manager'],
    ]);
    const download = await owner.post(
      `/api/v1/clients/${c.id}/documents/${pending}/download`,
      {},
      host,
    );
    expect(download.status).toBe(409);
    expect(errorOf(download.body).code).toBe('FILE_NOT_READY');
    expect(
      (await manager.delete(`/api/v1/clients/${c.id}/documents/${pending}`, host)).status,
    ).toBe(200);
    const activity = clientActivitySchema.parse(
      (await owner.get(`/api/v1/clients/${c.id}/activity`, host)).body,
    );
    expect(activity.items.map((i) => i.action).slice(0, 2)).toEqual([
      'clients.document.detached',
      'clients.document.attached',
    ]);
  });
});

describe('export', () => {
  it('Owner downloads an Excel-friendly CSV with formulas neutralised; Manager may not', async () => {
    const { owner, manager, host } = await company();
    await createClient(manager, host, base('=HYPERLINK("http://evil.example","x")', 'عميل عربي'));
    expect((await manager.get('/api/v1/clients/export.csv', host)).status).toBe(403);
    const res = await owner
      .get('/api/v1/clients/export.csv', host)
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (c: Buffer) => (text += c.toString('utf8')));
        r.on('end', () => {
          cb(null, text);
        });
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    const body = res.body as string;
    expect(body.startsWith('﻿"Number"')).toBe(true);
    expect(body).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(body).toContain('"عميل عربي"');
  });
});

describe('permissions and company boundaries', () => {
  it('an Employee cannot read or create clients', async () => {
    const { owner, host } = await company();
    const employee = await person('employee');
    await join(employee, host, owner, 'employee');
    expect((await employee.get('/api/v1/clients', host)).status).toBe(403);
    expect((await employee.post('/api/v1/clients', base('Nope'), host)).status).toBe(403);
  });

  it('another company cannot see, change or attach to my clients (404)', async () => {
    const mine = await company();
    const c = await createClient(mine.manager, mine.host, base('Private Client'));
    const other = await founder();
    for (const res of [
      await other.owner.get(`/api/v1/clients/${c.id}`, other.host),
      await other.owner.patch(`/api/v1/clients/${c.id}`, { version: 1, city: 'x' }, other.host),
      await other.owner.post(`/api/v1/clients/${c.id}/contacts`, { name: 'Spy' }, other.host),
      await other.owner.get(`/api/v1/clients/${c.id}/activity`, other.host),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(
      clientListResponseSchema.parse((await other.owner.get('/api/v1/clients', other.host)).body)
        .items,
    ).toEqual([]);
  });

  it('the dashboard counts active clients and new ones this month', async () => {
    const { owner, manager, host } = await company();
    await createClient(manager, host, { ...base('Active One'), status: 'active' });
    await createClient(manager, host, base('Prospect One'));
    const summary = dashboardSummarySchema.parse(
      (await owner.get('/api/v1/dashboard/summary', host)).body,
    );
    expect(summary.clients).toEqual({ active: 1, newThisMonth: 2 });
  });
});
