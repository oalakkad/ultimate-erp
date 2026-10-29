import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  accessMeResponseSchema,
  auditListResponseSchema,
  createCompanyResponseSchema,
  dashboardSummarySchema,
  errorResponseSchema,
  handoffResponseSchema,
  invitationListResponseSchema,
  invitationPreviewResponseSchema,
  memberListResponseSchema,
  myCompaniesResponseSchema,
  NOTIFICATION_RECIPIENT_LIMIT,
  notificationListResponseSchema,
  type Role,
  twoFactorSetupResponseSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { Notifier } from '../src/platform/notifications/notifier.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit, tokenFrom } from './support/mailpit.js';
import { codeAt } from './support/totp.js';

// Milestone 1.3b acceptance criteria (docs/modules/access.md §6), against real PostgreSQL and
// a real Mailpit inbox. Companies live at <slug>.localhost (PLATFORM_BASE_DOMAIN=localhost).

const PASSWORD = 'correct horse battery staple';
let database: TestDatabase;
let mailpit: TestMailpit;
let app: INestApplication;
/** Delivers queued emails, as the worker process does in production. */
let worker: INestApplicationContext;
let server: Server;
let admin: pg.Pool;
let appRole: pg.Pool;
let superuser: pg.Pool;
let n = 0;
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${(n += 1)}`;
const errorCode = (res: request.Response) => errorResponseSchema.parse(res.body).error.code;

/** The error a database statement fails with (the test fails if it succeeds). */
async function failure(statement: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await statement;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { ...(e.code ? { code: e.code } : {}), message: e.message ?? '' };
  }
  throw new Error('expected the statement to fail');
}

/** A signed-in browser for one person; `host` sets which address (company) it talks to. */
interface Person {
  email: string;
  totpUri?: string;
  step: number;
  get(path: string, host?: string): request.Test;
  post(path: string, body?: object, host?: string): request.Test;
  put(path: string, body: object, host?: string): request.Test;
  delete(path: string, host?: string): request.Test;
}

function browserFor(email: string): Person {
  const agent = request.agent(server);
  const at = (r: request.Test, host = 'localhost') =>
    r.set('Host', host).set('User-Agent', 'Test/1');
  return {
    email,
    step: 0,
    get: (path, host) => at(agent.get(path), host),
    post: (path, body, host) => at(agent.post(path), host).send(body ?? {}),
    put: (path, body, host) => at(agent.put(path), host).send(body),
    delete: (path, host) => at(agent.delete(path), host),
  };
}

/** A new verified account, signed in on the platform host. */
async function person(prefix = 'user'): Promise<Person> {
  const email = `${unique(prefix)}@example.com`;
  await request(server)
    .post('/api/v1/auth/sign-up')
    .send({ email, password: PASSWORD, name: prefix });
  const token = tokenFrom(await mailpit.waitFor(email, 'Confirm your email'));
  await request(server).get(`/api/v1/auth/verify-email?token=${token}`);
  const p = browserFor(email);
  expect((await p.post('/api/v1/auth/sign-in', { email, password: PASSWORD })).status).toBe(200);
  return p;
}

async function enableTwoFactor(p: Person): Promise<void> {
  const setup = twoFactorSetupResponseSchema.parse(
    (await p.post('/api/v1/auth/two-factor/enable', { password: PASSWORD })).body,
  );
  p.totpUri = setup.totpUri;
  expect(
    (await p.post('/api/v1/auth/two-factor/confirm', { code: await codeAt(setup.totpUri, 0) }))
      .status,
  ).toBe(200);
}

/** A founder with a new company and two-factor on (sensitive roles require it). */
async function founder(): Promise<{ owner: Person; slug: string; host: string }> {
  const owner = await person('founder');
  const slug = unique('co-');
  const res = await owner.post('/api/v1/companies', { slug, nameEn: 'Test Co', nameAr: 'شركة' });
  expect(res.status).toBe(201);
  await enableTwoFactor(owner);
  return { owner, slug, host: `${slug}.localhost` };
}

/** Invites `email` as `role` and returns the token from the emailed link. */
async function invite(owner: Person, host: string, email: string, role: Role): Promise<string> {
  const res = await owner.post('/api/v1/invitations', { email, role }, host);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return tokenFrom(await mailpit.waitFor(email, 'invited'));
}

async function join(p: Person, host: string, owner: Person, role: Role): Promise<string> {
  const token = await invite(owner, host, p.email, role);
  expect((await p.post('/api/v1/invitations/accept', { token }, host)).status).toBe(200);
  return membershipIdOf(owner, host, p.email);
}

async function membershipIdOf(owner: Person, host: string, email: string): Promise<string> {
  const { members } = memberListResponseSchema.parse(
    (await owner.get('/api/v1/members', host)).body,
  );
  const found = members.find((m) => m.email === email);
  if (!found) throw new Error(`${email} is not a member`);
  return found.membershipId;
}

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  admin = new pg.Pool({ connectionString: database.migratorUrl, max: 2 });
  appRole = new pg.Pool({ connectionString: database.appUrl, max: 1 });
  superuser = new pg.Pool({ connectionString: database.adminUrl, max: 1 });
  const config = testConfig({ DATABASE_URL: database.appUrl, ...mailpit.smtpConfig });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await Promise.all([admin.end(), appRole.end(), superuser.end()]);
  await Promise.all([database.stop(), mailpit.stop()]);
});

beforeEach(async () => {
  await admin.query('delete from rate_limit_buckets');
});

describe('company onboarding', () => {
  it('creates the company, its address and the founder as Owner + CEO', async () => {
    const owner = await person('founder');
    const slug = unique('acme-');
    const res = await owner.post('/api/v1/companies', { slug, nameEn: 'Acme', nameAr: 'أكمي' });
    expect(res.status).toBe(201);
    expect(createCompanyResponseSchema.parse(res.body)).toMatchObject({
      slug,
      url: `http://${slug}.localhost:3000`,
      twoFactorRequired: true,
    });
    const profile = await request(server).get('/api/v1/tenant').set('Host', `${slug}.localhost`);
    expect(profile.body).toMatchObject({ slug, name: { en: 'Acme', ar: 'أكمي' } });
    const me = accessMeResponseSchema.parse(
      (await owner.get('/api/v1/access/me', `${slug}.localhost`)).body,
    );
    expect(me.roles.sort()).toEqual(['ceo', 'owner']);
  });

  it('requires a session', async () => {
    const res = await request(server)
      .post('/api/v1/companies')
      .send({ slug: unique('x-'), nameEn: 'X Co', nameAr: 'إكس' });
    expect(res.status).toBe(401);
  });

  it.each([['admin'], ['a'], ['Bad_Slug!']])('refuses the address "%s"', async (slug) => {
    const owner = await person();
    const res = await owner.post('/api/v1/companies', { slug, nameEn: 'X Co', nameAr: 'إكس' });
    expect(res.status).toBe(422);
  });

  it('refuses an address that is taken', async () => {
    const { slug } = await founder();
    const other = await person();
    const res = await other.post('/api/v1/companies', { slug, nameEn: 'Copy', nameAr: 'نسخة' });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CONFLICT');
  });
});

describe('two-factor requirement for sensitive roles', () => {
  it('blocks company routes with MFA_REQUIRED until two-factor is set up', async () => {
    const owner = await person('founder');
    const slug = unique('mfa-');
    await owner.post('/api/v1/companies', { slug, nameEn: 'MFA Co', nameAr: 'شركة' });
    const host = `${slug}.localhost`;

    const blocked = await owner.get('/api/v1/members', host);
    expect(blocked.status).toBe(403);
    expect(errorCode(blocked)).toBe('MFA_REQUIRED');
    const me = accessMeResponseSchema.parse((await owner.get('/api/v1/access/me', host)).body);
    expect(me.twoFactorRequired).toBe(true);

    await enableTwoFactor(owner);
    expect((await owner.get('/api/v1/members', host)).status).toBe(200);
  });

  it('does not require two-factor for non-sensitive roles', async () => {
    const { owner, host } = await founder();
    const employee = await person('employee');
    await join(employee, host, owner, 'employee');
    expect((await employee.get('/api/v1/access/me', host)).status).toBe(200);
  });
});

describe('invitations', () => {
  it('lets the invited person join with the role, once', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    const token = await invite(owner, host, bob.email, 'employee');

    const preview = invitationPreviewResponseSchema.parse(
      (await request(server).get(`/api/v1/invitations/preview?token=${token}`).set('Host', host))
        .body,
    );
    expect(preview.role).toBe('employee');
    expect(preview.emailHint).toMatch(/^b\*\*\*@example\.com$/);

    expect((await bob.post('/api/v1/invitations/accept', { token }, host)).status).toBe(200);
    const me = accessMeResponseSchema.parse((await bob.get('/api/v1/access/me', host)).body);
    expect(me.roles).toEqual(['employee']);

    const reuse = await bob.post('/api/v1/invitations/accept', { token }, host);
    expect(reuse.status).toBe(400);
    expect(errorCode(reuse)).toBe('INVALID_TOKEN');
  });

  it('refuses an invitation accepted by a different account', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    const mallory = await person('mallory');
    const token = await invite(owner, host, bob.email, 'manager');
    const stolen = await mallory.post('/api/v1/invitations/accept', { token }, host);
    expect(stolen.status).toBe(403);
    expect((await mallory.get('/api/v1/access/me', host)).status).toBe(404);
    expect((await bob.post('/api/v1/invitations/accept', { token }, host)).status).toBe(200);
  });

  it('refuses expired and revoked invitations', async () => {
    const { owner, host } = await founder();
    const late = await person('late');
    const expired = await invite(owner, host, late.email, 'employee');
    await admin.query(
      `update invitations set expires_at = now() - interval '1 second' where email = $1`,
      [late.email],
    );
    expect((await late.post('/api/v1/invitations/accept', { token: expired }, host)).status).toBe(
      400,
    );

    const gone = await person('gone');
    const revokedToken = await invite(owner, host, gone.email, 'employee');
    const pending = invitationListResponseSchema.parse(
      (await owner.get('/api/v1/invitations', host)).body,
    ).invitations;
    const id = pending.find((i) => i.email === gone.email)?.id;
    expect((await owner.delete(`/api/v1/invitations/${id}`, host)).status).toBe(200);
    expect(
      (await gone.post('/api/v1/invitations/accept', { token: revokedToken }, host)).status,
    ).toBe(400);
  });

  it('only Owner and CEO can invite', async () => {
    const { owner, host } = await founder();
    const manager = await person('manager');
    await join(manager, host, owner, 'manager');
    const res = await manager.post(
      '/api/v1/invitations',
      { email: 'x@example.com', role: 'employee' },
      host,
    );
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('a CEO cannot invite an Owner', async () => {
    const { owner, host } = await founder();
    const ceo = await person('ceo');
    await join(ceo, host, owner, 'ceo');
    await enableTwoFactor(ceo);
    const res = await ceo.post(
      '/api/v1/invitations',
      { email: 'boss@example.com', role: 'owner' },
      host,
    );
    expect(res.status).toBe(403);
  });
});

describe('role changes cannot escalate privileges', () => {
  it('nobody can change their own roles', async () => {
    const { owner, host } = await founder();
    const own = await membershipIdOf(owner, host, owner.email);
    const res = await owner.put(
      `/api/v1/members/${own}/roles`,
      { roles: ['owner', 'ceo', 'finance'] },
      host,
    );
    expect(res.status).toBe(403);
  });

  it('a CEO cannot change an Owner, and cannot grant Owner', async () => {
    const { owner, host } = await founder();
    const ceo = await person('ceo');
    const ceoId = await join(ceo, host, owner, 'ceo');
    await enableTwoFactor(ceo);
    const ownerId = await membershipIdOf(owner, host, owner.email);
    expect(
      (await ceo.put(`/api/v1/members/${ownerId}/roles`, { roles: ['employee'] }, host)).status,
    ).toBe(403);
    const employee = await person('emp');
    const empId = await join(employee, host, owner, 'employee');
    expect(
      (await ceo.put(`/api/v1/members/${empId}/roles`, { roles: ['owner'] }, host)).status,
    ).toBe(403);
    expect(
      (await ceo.put(`/api/v1/members/${empId}/roles`, { roles: ['manager'] }, host)).status,
    ).toBe(200);
    expect(ceoId).toBeDefined();
  });

  it('unknown roles are rejected by validation', async () => {
    const { owner, host } = await founder();
    const employee = await person('emp');
    const empId = await join(employee, host, owner, 'employee');
    const res = await owner.put(`/api/v1/members/${empId}/roles`, { roles: ['superadmin'] }, host);
    expect(res.status).toBe(422);
  });

  it('two Owners demoting each other at the same moment cannot leave the company without one', async () => {
    const { owner: alice, host } = await founder();
    const bob = await person('bob');
    const bobId = await join(bob, host, alice, 'owner');
    await enableTwoFactor(bob);
    const aliceId = await membershipIdOf(alice, host, alice.email);

    // Force a true overlap: freeze writes to membership_roles (reads still work), start both
    // requests, wait until both are blocked inside their transactions, then release. Without
    // serialization both would pass their checks and commit — leaving no Owner at all.
    const blocker = await admin.connect();
    let results: request.Response[];
    try {
      await blocker.query('begin');
      await blocker.query('lock table membership_roles in exclusive mode');
      const pending = Promise.all([
        alice.put(`/api/v1/members/${bobId}/roles`, { roles: ['ceo'] }, host).then((r) => r),
        bob.put(`/api/v1/members/${aliceId}/roles`, { roles: ['ceo'] }, host).then((r) => r),
      ]);
      const deadline = Date.now() + 10_000;
      for (;;) {
        // Only a superuser may see other roles' wait states in pg_stat_activity.
        const { rows: waiting } = await superuser.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity
           where wait_event_type = 'Lock' and application_name = 'ultimate-erp-api'`,
        );
        if ((waiting[0]?.n ?? 0) >= 2) break;
        if (Date.now() > deadline) throw new Error('requests never reached the lock');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await blocker.query('commit');
      results = await pending;
    } finally {
      blocker.release();
    }
    const [a, b] = results;
    // Serialized: the first wins; the second runs after its sender was already demoted to CEO,
    // so its re-checked permissions refuse it (403) before the last-owner rule is even needed.
    expect([a?.status, b?.status].sort()).toEqual([200, 403]);
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from membership_roles r join memberships m on m.id = r.membership_id
       where r.role = 'owner' and m.status = 'active' and m.tenant_id = (select tenant_id from tenant_domains where hostname = $1)`,
      [host],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('company boundaries', () => {
  it('a member of one company gets 404 in another', async () => {
    const one = await founder();
    const two = await founder();
    expect((await one.owner.get('/api/v1/members', two.host)).status).toBe(404);
    expect((await one.owner.get('/api/v1/access/me', two.host)).status).toBe(404);
  });

  it('removed members lose access immediately', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    const bobId = await join(bob, host, owner, 'employee');
    expect((await owner.post(`/api/v1/members/${bobId}/remove`, {}, host)).status).toBe(200);
    expect((await bob.get('/api/v1/access/me', host)).status).toBe(404);
  });

  it('only members or invitees can sign in on a company address', async () => {
    const { owner, host } = await founder();
    const stranger = await person('stranger');
    const refused = await request(server)
      .post('/api/v1/auth/sign-in')
      .set('Host', host)
      .send({ email: stranger.email, password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(refused.headers['set-cookie']).toBeUndefined();

    await invite(owner, host, stranger.email, 'employee');
    const invited = await request(server)
      .post('/api/v1/auth/sign-in')
      .set('Host', host)
      .send({ email: stranger.email, password: PASSWORD });
    expect(invited.status).toBe(200);
  });
});

describe('trusted devices and sensitive roles', () => {
  it('a sensitive-role user cannot make a device trusted', async () => {
    const { owner } = await founder();
    const fresh = browserFor(owner.email);
    await fresh.post('/api/v1/auth/sign-in', { email: owner.email, password: PASSWORD });
    const verified = await fresh.post('/api/v1/auth/two-factor/verify', {
      code: await codeAt(owner.totpUri ?? '', 1),
      trustDevice: true,
    });
    expect(verified.status).toBe(200);
    await fresh.post('/api/v1/auth/sign-out');
    const again = await fresh.post('/api/v1/auth/sign-in', {
      email: owner.email,
      password: PASSWORD,
    });
    expect(again.body).toEqual({ status: 'two_factor_required' });
  });

  it('gaining a sensitive role cancels existing trusted devices', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    const bobId = await join(bob, host, owner, 'employee');
    await enableTwoFactor(bob);
    const device = browserFor(bob.email);
    await device.post('/api/v1/auth/sign-in', { email: bob.email, password: PASSWORD });
    await device.post('/api/v1/auth/two-factor/verify', {
      code: await codeAt(bob.totpUri ?? '', 1),
      trustDevice: true,
    });
    await device.post('/api/v1/auth/sign-out');
    expect(
      (await device.post('/api/v1/auth/sign-in', { email: bob.email, password: PASSWORD })).body,
    ).toMatchObject({
      status: 'signed_in',
    });
    await device.post('/api/v1/auth/sign-out');

    expect(
      (await owner.put(`/api/v1/members/${bobId}/roles`, { roles: ['finance'] }, host)).status,
    ).toBe(200);
    const after = await device.post('/api/v1/auth/sign-in', {
      email: bob.email,
      password: PASSWORD,
    });
    expect(after.body).toEqual({ status: 'two_factor_required' });
  });
});

describe('company hand-off (sign in once)', () => {
  async function handoffUrl(p: Person, tenantId: string): Promise<URL> {
    const res = await p.post('/api/v1/auth/handoff', { tenantId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return new URL(handoffResponseSchema.parse(res.body).url);
  }

  async function companyId(p: Person, slug: string): Promise<string> {
    const { companies } = myCompaniesResponseSchema.parse(
      (await p.get('/api/v1/auth/companies')).body,
    );
    const found = companies.find((c) => c.slug === slug);
    if (!found) throw new Error(`${slug} not in my companies`);
    return found.tenantId;
  }

  it('lists my companies with their web address', async () => {
    const { owner, slug } = await founder();
    const { companies } = myCompaniesResponseSchema.parse(
      (await owner.get('/api/v1/auth/companies')).body,
    );
    expect(companies).toEqual([
      expect.objectContaining({
        slug,
        url: `http://${slug}.localhost:3000`,
        roles: ['ceo', 'owner'],
      }),
    ]);
  });

  it('moves a signed-in person to the company address with a single-use ticket', async () => {
    const { owner, slug, host } = await founder();
    const url = await handoffUrl(owner, await companyId(owner, slug));
    expect(url.host).toBe(`${slug}.localhost:3000`);
    expect(url.pathname).toBe('/handoff');
    const ticket = url.searchParams.get('ticket') ?? '';

    const browser = browserFor(owner.email); // a fresh browser: no cookies at all
    const redeemed = await browser.post('/api/v1/auth/handoff/redeem', { ticket }, host);
    expect(redeemed.status).toBe(200);
    expect((await browser.get('/api/v1/access/me', host)).status).toBe(200);

    const replay = await browserFor(owner.email).post(
      '/api/v1/auth/handoff/redeem',
      { ticket },
      host,
    );
    expect(replay.status).toBe(400);
    expect(errorCode(replay)).toBe('INVALID_TOKEN');
  });

  it('a ticket works only on its own company address', async () => {
    const one = await founder();
    const two = await founder();
    const url = await handoffUrl(one.owner, await companyId(one.owner, one.slug));
    const ticket = url.searchParams.get('ticket') ?? '';
    const wrongHost = await browserFor(one.owner.email).post(
      '/api/v1/auth/handoff/redeem',
      { ticket },
      two.host,
    );
    expect(wrongHost.status).toBe(400);
    // Still unused: the right company can redeem it.
    expect(
      (await browserFor(one.owner.email).post('/api/v1/auth/handoff/redeem', { ticket }, one.host))
        .status,
    ).toBe(200);
  });

  it('expired tickets are refused', async () => {
    const { owner, slug, host } = await founder();
    const ticket =
      (await handoffUrl(owner, await companyId(owner, slug))).searchParams.get('ticket') ?? '';
    await admin.query(`update handoff_tickets set expires_at = now() - interval '1 second'`);
    expect(
      (await browserFor(owner.email).post('/api/v1/auth/handoff/redeem', { ticket }, host)).status,
    ).toBe(400);
  });

  it('cannot hand off into a company I do not belong to', async () => {
    const { owner, slug } = await founder();
    const tenantId = await companyId(owner, slug);
    const stranger = await person('stranger');
    expect((await stranger.post('/api/v1/auth/handoff', { tenantId })).status).toBe(404);
  });

  it('the new session keeps the original sign-in time (12-hour limit cannot be extended)', async () => {
    const { owner, slug, host } = await founder();
    await admin.query(
      `update sessions set authenticated_at = now() - interval '11 hours'
       where user_id = (select id from users where lower(email) = $1)`,
      [owner.email],
    );
    const ticket =
      (await handoffUrl(owner, await companyId(owner, slug))).searchParams.get('ticket') ?? '';
    const browser = browserFor(owner.email);
    await browser.post('/api/v1/auth/handoff/redeem', { ticket }, host);
    const { rows } = await admin.query<{ hours: number }>(
      `select extract(epoch from now() - max(s.authenticated_at)) / 3600 as hours
       from sessions s join users u on u.id = s.user_id where lower(u.email) = $1`,
      [owner.email],
    );
    expect(Number(rows[0]?.hours)).toBeGreaterThan(10.9);
  });
});

describe('notifications (Milestone 1.5a)', () => {
  const inbox = async (p: Person, host: string) =>
    notificationListResponseSchema.parse((await p.get('/api/v1/notifications', host)).body).items;
  const unread = async (p: Person, host: string) =>
    ((await p.get('/api/v1/notifications/unread-count', host)).body as { count: number }).count;

  it('tells the Owner/CEO when someone joins, not the newcomer; read state is tracked', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    await join(bob, host, owner, 'employee');

    const items = await inbox(owner, host);
    expect(items).toHaveLength(1); // Owner + CEO is one person: one notification
    expect(items[0]).toMatchObject({
      type: 'access.member_joined',
      params: { name: 'bob' },
      link: '/members',
      read: false,
    });
    expect(await inbox(bob, host)).toEqual([]);
    expect(await unread(owner, host)).toBe(1);

    const id = items[0]?.id ?? '';
    expect((await owner.post(`/api/v1/notifications/${id}/read`, {}, host)).status).toBe(200);
    expect(await unread(owner, host)).toBe(0);
    expect((await inbox(owner, host))[0]?.read).toBe(true);
  });

  it('tells a member when their roles change', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    const bobId = await join(bob, host, owner, 'employee');
    expect(
      (await owner.put(`/api/v1/members/${bobId}/roles`, { roles: ['team_leader'] }, host)).status,
    ).toBe(200);
    const [item] = await inbox(bob, host);
    expect(item).toMatchObject({ type: 'access.roles_changed', params: { roles: 'team_leader' } });
    expect((await bob.post('/api/v1/notifications/read-all', {}, host)).status).toBe(200);
    expect(await unread(bob, host)).toBe(0);
  });

  it('nobody can read or mark another member’s notification, in this or another company', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    await join(bob, host, owner, 'employee');
    const [ownersItem] = await inbox(owner, host);
    const id = ownersItem?.id ?? '';

    const sameCompany = await bob.post(`/api/v1/notifications/${id}/read`, {}, host);
    expect(sameCompany.status).toBe(404);
    expect(await unread(owner, host)).toBe(1);

    const other = await founder();
    const elsewhere = await other.owner.post(`/api/v1/notifications/${id}/read`, {}, other.host);
    expect(elsewhere.status).toBe(404);
    expect(await inbox(other.owner, other.host)).toEqual([]);
    // Bob's session is not valid on another company's address at all.
    expect((await bob.get('/api/v1/notifications', other.host)).status).not.toBe(200);
  });

  it('refuses to notify more than the recipient limit in one call', async () => {
    const notifier = app.get(Notifier);
    const recipients = Array.from(
      { length: NOTIFICATION_RECIPIENT_LIMIT + 1 },
      (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    await expect(
      notifier.notify({} as never, {} as never, {
        tenantId: '00000000-0000-7000-8000-000000000000',
        type: 'access.member_joined',
        recipients,
        actor: { userId: '00000000-0000-7000-8000-000000000000' },
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it('shows the invitation email’s delivery status', async () => {
    const { owner, host } = await founder();
    const email = `${unique('carol')}@example.com`;
    await invite(owner, host, email, 'employee');
    // The email has arrived, so the worker has recorded it (or is about to).
    let delivery: string | null | undefined;
    for (let i = 0; i < 50 && delivery !== 'sent'; i++) {
      const { invitations } = invitationListResponseSchema.parse(
        (await owner.get('/api/v1/invitations', host)).body,
      );
      delivery = invitations.find((x) => x.email === email)?.delivery;
      if (delivery !== 'sent') await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(delivery).toBe('sent');
  });
});

describe('dashboard summary (Phase 2b)', () => {
  const summary = async (p: Person, host: string) => {
    const res = await p.get('/api/v1/dashboard/summary', host);
    expect(res.status).toBe(200);
    return dashboardSummarySchema.parse(res.body);
  };

  it('gives the Owner set-up progress, team numbers and recent activity from real records', async () => {
    const { owner, host } = await founder();
    const before = await summary(owner, host);
    expect(before.setup).toEqual({ invitationSent: false, colleagueJoined: false });
    expect(before.team).toEqual({ activeMembers: 1, pendingInvitations: 0 });
    expect(before.activity?.items.map((i) => i.action)).toEqual(['access.company.created']);

    const bob = await person('bob');
    await join(bob, host, owner, 'employee');
    await invite(owner, host, `${unique('later')}@example.com`, 'employee');
    const after = await summary(owner, host);
    expect(after.setup).toEqual({ invitationSent: true, colleagueJoined: true });
    expect(after.team).toEqual({ activeMembers: 2, pendingInvitations: 1 });
    expect(after.activity?.items.map((i) => i.action)).toEqual([
      'access.invitation.created',
      'access.invitation.accepted',
      'access.invitation.created',
      'access.company.created',
    ]);
    // Internal events (notification sends) are not business activity.
    expect(JSON.stringify(after)).not.toContain('notification');
    expect(after.activity?.items[1]?.actorName).toBe('bob');
  });

  it('shows an Employee only what their role allows (no sections today)', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    await join(bob, host, owner, 'employee');
    expect(await summary(bob, host)).toEqual({});
  });

  it('never counts another company’s records', async () => {
    const a = await founder();
    const bob = await person('bob');
    await join(bob, a.host, a.owner, 'employee');
    const b = await founder();
    const other = await summary(b.owner, b.host);
    expect(other.team).toEqual({ activeMembers: 1, pendingInvitations: 0 });
    expect(other.activity?.items.map((i) => i.action)).toEqual(['access.company.created']);
  });
});

describe('audit log', () => {
  it('records each change, readable by the Owner with pagination', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    const bobId = await join(bob, host, owner, 'employee');
    await owner.put(`/api/v1/members/${bobId}/roles`, { roles: ['manager'] }, host);

    const all = auditListResponseSchema.parse(
      (await owner.get('/api/v1/audit-events?limit=50', host)).body,
    );
    expect(all.items.map((e) => e.action)).toEqual([
      'notifications.notification.sent', // Bob is told about his new role
      'access.member.roles_changed',
      'notifications.notification.sent', // the Owner is told Bob joined
      'access.invitation.accepted',
      'access.invitation.created',
      'access.company.created',
    ]);
    expect(all.items[0]?.details).toEqual({ type: 'access.roles_changed', recipients: 1 });
    expect(all.items[1]?.details).toEqual({ before: ['employee'], after: ['manager'] });
    expect(all.items[1]?.requestId).toBeTruthy();

    const first = auditListResponseSchema.parse(
      (await owner.get('/api/v1/audit-events?limit=3', host)).body,
    );
    expect(first.items).toHaveLength(3);
    const second = auditListResponseSchema.parse(
      (await owner.get(`/api/v1/audit-events?limit=3&cursor=${first.nextCursor}`, host)).body,
    );
    expect(second.items.map((e) => e.id)).toEqual(all.items.slice(3, 6).map((e) => e.id));
    expect(second.nextCursor).toBeNull();
  });

  it('is hidden from members without the permission', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    await join(bob, host, owner, 'manager');
    expect((await bob.get('/api/v1/audit-events', host)).status).toBe(403);
  });

  it('cannot be changed or deleted, by the app or even by the table owner', async () => {
    await founder();
    expect(
      (await failure(appRole.query('update audit_events set action = $1', ['x.y']))).code,
    ).toBe('42501');
    expect((await failure(appRole.query('delete from audit_events'))).code).toBe('42501');
    for (const statement of [
      "update audit_events set action = 'x.y'",
      'delete from audit_events',
      'truncate audit_events',
    ]) {
      expect((await failure(admin.query(statement))).message, statement).toContain('append-only');
    }
  });
});
