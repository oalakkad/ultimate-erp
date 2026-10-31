import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  announcementListResponseSchema,
  announcementPreviewSchema,
  announcementSchema,
  errorResponseSchema,
  invoiceSchema,
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
  projectSchema,
  taskSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { type Person, people } from './support/people.js';

// Phase 13 acceptance (docs/modules/notifications.md §6) against real Postgres + Mailpit.

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
const inbox = async (p: Person, host: string) =>
  notificationListResponseSchema.parse((await p.get('/api/v1/notifications?limit=50', host)).body)
    .items;

interface Firm {
  owner: Person;
  manager: Person;
  managerId: string;
  a: Person;
  aId: string;
  host: string;
  projectId: string;
  clientId: string;
}

async function firm(): Promise<Firm> {
  const { owner, host } = await founder();
  const manager = await person('manager');
  const managerId = await join(manager, host, owner, 'manager');
  const a = await person('empa');
  const aId = await join(a, host, owner, 'employee');
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
          nameEn: 'Audit',
          nameAr: 'تدقيق',
          managerMembershipId: managerId,
          budgetHours: '100',
          memberIds: [aId],
        },
        host,
      )
    ).body,
  );
  return { owner, manager, managerId, a, aId, host, projectId: project.id, clientId };
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

describe('notification preferences', () => {
  it('lets people mute types in the app and ask for email copies, except mandatory ones', async () => {
    const f = await firm();
    const prefs = notificationPreferencesResponseSchema.parse(
      (await f.a.get('/api/v1/notifications/preferences', f.host)).body,
    );
    expect(prefs.items.find((p) => p.type === 'tasks.assigned')).toEqual({
      type: 'tasks.assigned',
      inApp: true,
      email: false,
      mandatory: false,
    });
    expect(prefs.items.find((p) => p.type === 'announcements.published')?.mandatory).toBe(true);

    const saved = notificationPreferencesResponseSchema.parse(
      (
        await f.a.put(
          '/api/v1/notifications/preferences',
          {
            items: [
              { type: 'tasks.assigned', inApp: false, email: true },
              { type: 'access.roles_changed', inApp: false, email: false },
            ],
          },
          f.host,
        )
      ).body,
    );
    expect(saved.items.find((p) => p.type === 'tasks.assigned')).toMatchObject({
      inApp: false,
      email: true,
    });
    expect(saved.items.find((p) => p.type === 'access.roles_changed')?.inApp).toBe(true);

    taskSchema.parse(
      (
        await f.manager.post(
          '/api/v1/tasks',
          {
            projectId: f.projectId,
            title: 'Inventory count',
            allocations: [{ membershipId: f.aId, hours: '5' }],
          },
          f.host,
        )
      ).body,
    );
    // Not in the app (muted) …
    expect((await inbox(f.a, f.host)).some((n) => n.type === 'tasks.assigned')).toBe(false);
    // … but an email copy, in the person's language, with a link to the company's own address.
    const mail = await mailpit.waitFor(f.a.email, 'Inventory count');
    expect(mail.text).toContain(`http://${f.host}:`);
    expect(mail.text).toContain('/tasks/');
  });
});

describe('announcements', () => {
  it('publishes to a confirmed number of people, in the app and by email, and records it', async () => {
    const f = await firm();
    expect((await f.a.post('/api/v1/announcements/preview', { roles: [] }, f.host)).status).toBe(
      403,
    );
    const preview = announcementPreviewSchema.parse(
      (await f.owner.post('/api/v1/announcements/preview', { roles: [] }, f.host)).body,
    );
    expect(preview.recipients).toBe(3);
    const body = {
      titleEn: 'Office closed Thursday',
      titleAr: 'المكتب مغلق يوم الخميس',
      bodyEn: 'For National Day.',
      bodyAr: 'بمناسبة العيد الوطني.',
      roles: [],
      email: true,
    };
    const wrong = await f.owner.post(
      '/api/v1/announcements',
      { ...body, confirmRecipients: 2 },
      f.host,
    );
    expect(wrong.status).toBe(409);
    expect(errorOf(wrong.body).details?.[0]?.code).toBe('recipient_count_changed');

    // Even someone who muted announcements sees them (mandatory in the app).
    await f.a.put(
      '/api/v1/notifications/preferences',
      { items: [{ type: 'announcements.published', inApp: false, email: false }] },
      f.host,
    );
    const published = announcementSchema.parse(
      (await f.owner.post('/api/v1/announcements', { ...body, confirmRecipients: 3 }, f.host)).body,
    );
    expect(published).toMatchObject({ recipients: 3, email: true });
    expect((await inbox(f.a, f.host)).some((n) => n.type === 'announcements.published')).toBe(true);
    const mail = await mailpit.waitFor(f.a.email, 'Office closed Thursday');
    expect(mail.text).toContain('For National Day.');
    const audit = await admin.query(
      `select details from audit_events where action = 'announcements.announcement.published'`,
    );
    expect(audit.rowCount).toBe(1);

    // Delivery status for publishers; employees see the announcement without it.
    const forOwner = announcementListResponseSchema.parse(
      (await f.owner.get('/api/v1/announcements', f.host)).body,
    );
    const delivery = forOwner.items[0]?.delivery;
    expect(delivery).not.toBeNull();
    expect((delivery?.queued ?? 0) + (delivery?.sent ?? 0)).toBe(3);
    const forA = announcementListResponseSchema.parse(
      (await f.a.get('/api/v1/announcements', f.host)).body,
    );
    expect(forA.items.map((i) => i.title.en)).toEqual(['Office closed Thursday']);
    expect(forA.items[0]?.delivery).toBeNull();
  });

  it('targets roles and keeps other companies out', async () => {
    const f = await firm();
    const preview = announcementPreviewSchema.parse(
      (await f.owner.post('/api/v1/announcements/preview', { roles: ['manager'] }, f.host)).body,
    );
    expect(preview.recipients).toBe(1);
    await f.owner.post(
      '/api/v1/announcements',
      {
        titleEn: 'Managers meeting',
        titleAr: 'اجتماع المدراء',
        bodyEn: 'Sunday 9:00.',
        bodyAr: 'الأحد ٩:٠٠.',
        roles: ['manager'],
        email: false,
        confirmRecipients: 1,
      },
      f.host,
    );
    const forA = announcementListResponseSchema.parse(
      (await f.a.get('/api/v1/announcements', f.host)).body,
    );
    expect(forA.items).toHaveLength(0);
    const forManager = announcementListResponseSchema.parse(
      (await f.manager.get('/api/v1/announcements', f.host)).body,
    );
    expect(forManager.items.map((i) => i.title.en)).toEqual(['Managers meeting']);
    const g = await founder();
    expect(
      announcementListResponseSchema.parse(
        (await g.owner.get('/api/v1/announcements', g.host)).body,
      ).items,
    ).toHaveLength(0);
  });

  it('refuses more than 10 announcements a day in one company', async () => {
    const f = await firm();
    const body = {
      titleEn: 'Note',
      titleAr: 'ملاحظة',
      bodyEn: 'Text.',
      bodyAr: 'نص.',
      roles: ['manager'],
      email: false,
      confirmRecipients: 1,
    };
    for (let i = 0; i < 10; i++) {
      expect((await f.owner.post('/api/v1/announcements', body, f.host)).status).toBe(201);
    }
    const eleventh = await f.owner.post('/api/v1/announcements', body, f.host);
    expect(eleventh.status).toBe(409);
    expect(errorOf(eleventh.body).details?.[0]?.code).toBe('daily_limit');
  });
});

describe('cross-module notifications', () => {
  it('alerts at budget thresholds and tells the project manager about invoices', async () => {
    const f = await firm();
    await f.manager.post(
      '/api/v1/tasks',
      {
        projectId: f.projectId,
        title: 'Planning',
        allocations: [{ membershipId: f.aId, hours: '50' }],
      },
      f.host,
    );
    expect((await inbox(f.owner, f.host)).some((n) => n.type === 'projects.budget_threshold')).toBe(
      false,
    );
    await f.manager.post(
      '/api/v1/tasks',
      {
        projectId: f.projectId,
        title: 'Fieldwork',
        allocations: [{ membershipId: f.aId, hours: '35' }],
      },
      f.host,
    );
    const threshold = (await inbox(f.owner, f.host)).find(
      (n) => n.type === 'projects.budget_threshold',
    );
    expect(threshold?.params).toMatchObject({ percent: '80' });
    expect(threshold?.link).toBe(`/projects/${f.projectId}`);

    const draft = invoiceSchema.parse(
      (
        await f.owner.post(
          '/api/v1/invoices',
          {
            clientId: f.clientId,
            projectId: f.projectId,
            lines: [{ description: 'Fee', quantity: '1', unitPrice: '100' }],
          },
          f.host,
        )
      ).body,
    );
    await f.owner.post(`/api/v1/invoices/${draft.id}/issue`, {}, f.host);
    const issued = (await inbox(f.manager, f.host)).find((n) => n.type === 'billing.issued');
    expect(issued?.params).toMatchObject({ number: 'INV-0001', total: '100.000' });
  });
});
