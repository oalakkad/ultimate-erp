import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  errorResponseSchema,
  meResponseSchema,
  sessionListResponseSchema,
  signInResponseSchema,
  twoFactorSetupResponseSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit, tokenFrom } from './support/mailpit.js';
import { codeAt } from './support/totp.js';

// Milestone 1.3a acceptance criteria (docs/modules/identity.md §7), against real PostgreSQL
// and a real Mailpit inbox. Each test uses its own email address.

const PASSWORD = 'correct horse battery staple';
const BREACHED_PASSWORD = 'password1234567890';

let database: TestDatabase;
let mailpit: TestMailpit;
let breachApi: Server;
let app: INestApplication;
/** Delivers queued emails, as the worker process does in production. */
let worker: INestApplicationContext;
let server: Server;
let admin: pg.Pool;
let counter = 0;

const uniqueEmail = () => `user${Date.now()}-${(counter += 1)}@example.com`;
const errorCode = (res: request.Response) => errorResponseSchema.parse(res.body).error.code;

/** A browser: keeps cookies between requests and sends a fixed User-Agent. */
function browser(userAgent = 'TestBrowser/1.0') {
  const agent = request.agent(server);
  const withUa = (r: request.Test) => r.set('User-Agent', userAgent);
  return {
    get: (path: string) => withUa(agent.get(path)),
    post: (path: string, body?: object) => withUa(agent.post(path)).send(body ?? {}),
    delete: (path: string) => withUa(agent.delete(path)),
  };
}

async function signUpAndVerify(email: string, password = PASSWORD) {
  const res = await request(server)
    .post('/api/v1/auth/sign-up')
    .send({ email, password, name: 'Test User' });
  expect(res.status).toBe(202);
  const token = tokenFrom(await mailpit.waitFor(email, 'Confirm your email'));
  expect((await request(server).get(`/api/v1/auth/verify-email?token=${token}`)).status).toBe(200);
}

async function signedIn(email: string, userAgent?: string) {
  const b = browser(userAgent);
  const res = await b.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
  expect(res.status).toBe(200);
  return b;
}

async function enableTwoFactor(b: ReturnType<typeof browser>) {
  const setup = twoFactorSetupResponseSchema.parse(
    (await b.post('/api/v1/auth/two-factor/enable', { password: PASSWORD })).body,
  );
  const confirm = await b.post('/api/v1/auth/two-factor/confirm', {
    code: await codeAt(setup.totpUri, 0),
  });
  expect(confirm.status).toBe(200);
  return setup;
}

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  admin = new pg.Pool({ connectionString: database.migratorUrl, max: 2 });

  // Stand-in for the Have I Been Pwned range API (test fixture; no internet in tests).
  const hash = createHash('sha1').update(BREACHED_PASSWORD).digest('hex').toUpperCase();
  breachApi = createServer((req, res) => {
    res.end(req.url === `/range/${hash.slice(0, 5)}` ? `${hash.slice(5)}:42\r\nABC:0` : 'ABC:0');
  });
  await new Promise<void>((resolve) => breachApi.listen(0, '127.0.0.1', resolve));
  const { port } = breachApi.address() as AddressInfo;

  const config = testConfig({
    DATABASE_URL: database.appUrl,
    ...mailpit.smtpConfig,
    PASSWORD_BREACH_CHECK: 'true',
    PASSWORD_BREACH_API_URL: `http://127.0.0.1:${port}`,
  });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await admin.end();
  breachApi.close();
  await Promise.all([database.stop(), mailpit.stop()]);
});

// Every request comes from 127.0.0.1, so per-IP limits would leak between tests.
beforeEach(async () => {
  await admin.query('delete from rate_limit_buckets');
});

describe('sign-up and email verification', () => {
  it('requires a verified email before sign-in', async () => {
    const email = uniqueEmail();
    await request(server)
      .post('/api/v1/auth/sign-up')
      .send({ email, password: PASSWORD, name: 'A' });
    const blocked = await request(server)
      .post('/api/v1/auth/sign-in')
      .send({ email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(errorCode(blocked)).toBe('EMAIL_NOT_VERIFIED');

    const token = tokenFrom(await mailpit.waitFor(email, 'Confirm your email'));
    expect((await request(server).get(`/api/v1/auth/verify-email?token=${token}`)).status).toBe(
      200,
    );

    const b = browser();
    const res = await b.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    expect(signInResponseSchema.parse(res.body)).toMatchObject({ status: 'signed_in' });
    const me = meResponseSchema.parse((await b.get('/api/v1/auth/me')).body);
    expect(me.user).toMatchObject({ email, emailVerified: true, twoFactorEnabled: false });
  });

  it('sends the verification email in the chosen language', async () => {
    const email = uniqueEmail();
    await request(server)
      .post('/api/v1/auth/sign-up')
      .send({ email, password: PASSWORD, name: 'عمر', locale: 'ar' });
    const mail = await mailpit.waitFor(email, 'تأكيد');
    expect(mail.text).toContain('مرحبًا عمر');
  });

  it('answers an existing email exactly like a new one, and warns the real owner', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const again = await request(server)
      .post('/api/v1/auth/sign-up')
      .send({ email, password: 'another long password 1', name: 'Imposter' });
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ status: 'accepted' });
    await mailpit.waitFor(email, 'Someone tried to sign up');
    const { rows } = await admin.query<{ n: number }>(
      'select count(*)::int as n from users where lower(email) = $1',
      [email],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('rejects a tampered verification token', async () => {
    const res = await request(server).get('/api/v1/auth/verify-email?token=not-a-real-token');
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_TOKEN');
  });

  it.each([
    ['an unknown field (mass assignment)', { role: 'owner' }],
    ['a short password', { password: 'short' }],
    ['an invalid email', { email: 'not-an-email' }],
  ])('rejects %s with VALIDATION_FAILED', async (_case, change) => {
    const body = { email: uniqueEmail(), password: PASSWORD, name: 'A', ...change };
    const res = await request(server).post('/api/v1/auth/sign-up').send(body);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
  });

  it('refuses a password found in data breaches', async () => {
    const res = await request(server)
      .post('/api/v1/auth/sign-up')
      .send({ email: uniqueEmail(), password: BREACHED_PASSWORD, name: 'A' });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('PASSWORD_COMPROMISED');
  });
});

describe('sign-in protection', () => {
  it('gives the same answer for a wrong password and an unknown email', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const wrong = await request(server)
      .post('/api/v1/auth/sign-in')
      .send({ email, password: 'wrong password!!' });
    const unknown = await request(server)
      .post('/api/v1/auth/sign-in')
      .send({ email: uniqueEmail(), password: 'wrong password!!' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
    expect(errorResponseSchema.parse(wrong.body).error.message).toBe(
      errorResponseSchema.parse(unknown.body).error.message,
    );
  });

  it('locks the account after 5 failures, even for the right password, and emails the owner', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    for (let i = 0; i < 5; i += 1) {
      await request(server)
        .post('/api/v1/auth/sign-in')
        .send({ email, password: 'wrong password!!' });
    }
    const locked = await request(server)
      .post('/api/v1/auth/sign-in')
      .send({ email, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(errorCode(locked)).toBe('RATE_LIMITED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    await mailpit.waitFor(email, 'temporarily locked');
  });

  it('limits sign-in attempts per IP address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const res = await request(server)
        .post('/api/v1/auth/sign-in')
        .send({ email: uniqueEmail(), password: 'wrong password!!' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('never adopts a session cookie chosen by an attacker (session fixation)', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const planted = 'erp.session_token=attacker-chosen-value.signature';
    const res = await request(server)
      .post('/api/v1/auth/sign-in')
      .set('Cookie', planted)
      .send({ email, password: PASSWORD });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('erp.session_token='));
    expect(session).toBeDefined();
    expect(session).not.toContain('attacker-chosen-value');
    const me = await request(server).get('/api/v1/auth/me').set('Cookie', planted);
    expect(me.status).toBe(401);
  });

  it('refuses cross-site requests (CSRF)', async () => {
    const res = await request(server)
      .post('/api/v1/auth/sign-in')
      .set('Origin', 'https://evil.example.com')
      .send({ email: uniqueEmail(), password: PASSWORD });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('emails the user on sign-in from a new browser, not from a known one', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    await signedIn(email, 'FirstBrowser/1.0');
    await signedIn(email, 'FirstBrowser/1.0');
    expect(await mailpit.count(email, 'New sign-in')).toBe(0);
    await signedIn(email, 'SecondBrowser/2.0');
    const notice = await mailpit.waitFor(email, 'New sign-in');
    expect(notice.text).toContain('SecondBrowser/2.0');
  });
});

describe('sessions', () => {
  it('lists own sessions without tokens and revokes them immediately', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const laptop = await signedIn(email, 'Laptop/1.0');
    const phone = await signedIn(email, 'Phone/1.0');

    const list = sessionListResponseSchema.parse((await laptop.get('/api/v1/auth/sessions')).body);
    expect(list.sessions).toHaveLength(2);
    expect(JSON.stringify(list)).not.toMatch(/token/i);
    const phoneSession = list.sessions.find((s) => !s.current);
    expect(phoneSession?.userAgent).toBe('Phone/1.0');

    expect((await laptop.delete(`/api/v1/auth/sessions/${phoneSession?.id}`)).status).toBe(200);
    expect((await phone.get('/api/v1/auth/me')).status).toBe(401);
    expect((await laptop.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('cannot revoke someone else’s session', async () => {
    const alice = uniqueEmail();
    const bob = uniqueEmail();
    await signUpAndVerify(alice);
    await signUpAndVerify(bob);
    const aliceBrowser = await signedIn(alice);
    const bobBrowser = await signedIn(bob);
    const bobs = sessionListResponseSchema.parse(
      (await bobBrowser.get('/api/v1/auth/sessions')).body,
    );
    const res = await aliceBrowser.delete(`/api/v1/auth/sessions/${bobs.sessions[0]?.id}`);
    expect(res.status).toBe(404);
    expect((await bobBrowser.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('revokes all other sessions, and sign-out ends the current one', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const a = await signedIn(email);
    const b = await signedIn(email);
    expect((await a.post('/api/v1/auth/sessions/revoke-others')).status).toBe(200);
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);
    expect((await a.post('/api/v1/auth/sign-out')).status).toBe(200);
    expect((await a.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('expires sessions after 12 hours even when active (absolute lifetime)', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const b = await signedIn(email);
    await admin.query(
      `update sessions set created_at = now() - interval '13 hours',
         authenticated_at = now() - interval '13 hours'
       where user_id = (select id from users where lower(email) = $1)`,
      [email],
    );
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('expires idle sessions', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const b = await signedIn(email);
    await admin.query(
      `update sessions set expires_at = now() - interval '1 second'
       where user_id = (select id from users where lower(email) = $1)`,
      [email],
    );
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('requires a session for protected routes', async () => {
    const res = await request(server).get('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
  });
});

describe('password reset and change', () => {
  it('resets with a single-use emailed link and signs out everywhere', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const oldBrowser = await signedIn(email);

    expect(
      (await request(server).post('/api/v1/auth/password/forgot').send({ email })).status,
    ).toBe(202);
    const token = tokenFrom(await mailpit.waitFor(email, 'Reset your password'));
    expect((await request(server).get(`/api/v1/auth/password/reset?token=${token}`)).status).toBe(
      200,
    );

    const newPassword = 'a brand new long password';
    const reset = await request(server)
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword });
    expect(reset.status).toBe(200);
    expect((await oldBrowser.get('/api/v1/auth/me')).status).toBe(401);
    await mailpit.waitFor(email, 'password was changed');

    const reuse = await request(server)
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: 'yet another long password' });
    expect(reuse.status).toBe(400);
    expect(errorCode(reuse)).toBe('INVALID_TOKEN');

    const oldLogin = await request(server)
      .post('/api/v1/auth/sign-in')
      .send({ email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(server)
      .post('/api/v1/auth/sign-in')
      .send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
  });

  it('rejects an expired reset link', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    await request(server).post('/api/v1/auth/password/forgot').send({ email });
    const token = tokenFrom(await mailpit.waitFor(email, 'Reset your password'));
    await admin.query(`update verifications set expires_at = now() - interval '1 second'`);
    const res = await request(server)
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: 'a brand new long password' });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_TOKEN');
  });

  it('stores reset tokens hashed, never as sent', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    await request(server).post('/api/v1/auth/password/forgot').send({ email });
    const token = tokenFrom(await mailpit.waitFor(email, 'Reset your password'));
    const { rows } = await admin.query('select identifier from verifications');
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('answers forgot-password the same for unknown emails, without sending anything', async () => {
    const email = uniqueEmail();
    const res = await request(server).post('/api/v1/auth/password/forgot').send({ email });
    expect(res.status).toBe(202);
    expect(await mailpit.count(email, 'Reset')).toBe(0);
  });

  it('changes the password only with the current one, and refuses breached passwords', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const b = await signedIn(email);
    const wrong = await b.post('/api/v1/auth/password/change', {
      currentPassword: 'not my password!!',
      newPassword: 'a brand new long password',
    });
    expect(wrong.status).toBe(401);
    const breached = await b.post('/api/v1/auth/password/change', {
      currentPassword: PASSWORD,
      newPassword: BREACHED_PASSWORD,
    });
    expect(errorCode(breached)).toBe('PASSWORD_COMPROMISED');
    const ok = await b.post('/api/v1/auth/password/change', {
      currentPassword: PASSWORD,
      newPassword: 'a brand new long password',
    });
    expect(ok.status).toBe(200);
    await mailpit.waitFor(email, 'password was changed');
  });
});

describe('two-factor authentication', () => {
  it('requires the password to start setup', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const b = await signedIn(email);
    const res = await b.post('/api/v1/auth/two-factor/enable', { password: 'not my password!!' });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
  });

  it('asks for a code at sign-in, accepts it once, and refuses a replay', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const setup = await enableTwoFactor(await signedIn(email));
    expect(setup.backupCodes).toHaveLength(10);
    await mailpit.waitFor(email, 'Two-factor authentication turned on');

    const b = browser();
    const first = await b.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    expect(first.body).toEqual({ status: 'two_factor_required' });
    expect((await b.get('/api/v1/auth/me')).status).toBe(401);

    const wrong = await b.post('/api/v1/auth/two-factor/verify', { code: '000000' });
    expect(errorCode(wrong)).toBe('INVALID_CODE');

    // The confirmation used the current code; use the next step's code (allowed ±1 step).
    const code = await codeAt(setup.totpUri, 1);
    const ok = await b.post('/api/v1/auth/two-factor/verify', { code });
    expect(signInResponseSchema.parse(ok.body)).toMatchObject({ status: 'signed_in' });
    expect((await b.get('/api/v1/auth/me')).status).toBe(200);

    const attacker = browser('Attacker/1.0');
    await attacker.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    const replay = await attacker.post('/api/v1/auth/two-factor/verify', { code });
    expect(replay.status).toBe(401);
    expect(errorCode(replay)).toBe('INVALID_CODE');
    expect((await attacker.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('accepts each backup code once', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const setup = await enableTwoFactor(await signedIn(email));
    const backupCode = setup.backupCodes[0] ?? '';

    const b = browser();
    await b.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    const ok = await b.post('/api/v1/auth/two-factor/verify-backup-code', { code: backupCode });
    expect(ok.status).toBe(200);

    const c = browser();
    await c.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    const reuse = await c.post('/api/v1/auth/two-factor/verify-backup-code', { code: backupCode });
    expect(reuse.status).toBe(401);
    expect(errorCode(reuse)).toBe('INVALID_CODE');
  });

  it('skips the code prompt on a trusted device only', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const setup = await enableTwoFactor(await signedIn(email));

    const trusted = browser('Trusted/1.0');
    await trusted.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    await trusted.post('/api/v1/auth/two-factor/verify', {
      code: await codeAt(setup.totpUri, 1),
      trustDevice: true,
    });
    await trusted.post('/api/v1/auth/sign-out');
    const again = await trusted.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    expect(again.body).toMatchObject({ status: 'signed_in' });

    const other = browser('Other/1.0');
    const fresh = await other.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    expect(fresh.body).toEqual({ status: 'two_factor_required' });
  });

  it('turning two-factor off requires the password', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const b = await signedIn(email);
    await enableTwoFactor(b);
    const wrong = await b.post('/api/v1/auth/two-factor/disable', {
      password: 'not my password!!',
    });
    expect(wrong.status).toBe(401);
    expect((await b.post('/api/v1/auth/two-factor/disable', { password: PASSWORD })).status).toBe(
      200,
    );
    await mailpit.waitFor(email, 'turned off');
  });

  it('stores the authenticator secret encrypted', async () => {
    const email = uniqueEmail();
    await signUpAndVerify(email);
    const setup = await enableTwoFactor(await signedIn(email));
    const secret = new URL(setup.totpUri).searchParams.get('secret') ?? '';
    const { rows } = await admin.query('select secret, backup_codes from two_factors');
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(setup.backupCodes[0]);
  });
});
