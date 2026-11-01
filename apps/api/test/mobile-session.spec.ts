import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  accessMeResponseSchema,
  AUTH_STATE_HEADER,
  errorResponseSchema,
  handoffResponseSchema,
  myCompaniesResponseSchema,
  signInResponseSchema,
  twoFactorSetupResponseSchema,
} from '@ultimate-erp/contracts';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit, tokenFrom } from './support/mailpit.js';
import { PASSWORD, people } from './support/people.js';
import { codeAt } from './support/totp.js';

// Phase 16 (docs/modules/mobile.md §4, §7): the cookie-less session transport used by the mobile
// app. A client that sends `X-Auth-State` gets its cookies back in that header instead of
// Set-Cookie and authenticates with it afterwards. Real Postgres + Mailpit.

let database: TestDatabase;
let mailpit: TestMailpit;
let app: INestApplication;
let worker: INestApplicationContext;
let server: Server;
const { person, founder } = people(
  () => server,
  () => mailpit,
);

/** The mobile app: no cookie jar, one auth state per host, sent and received in the header. */
function mobile(host = 'localhost') {
  let state = '';
  const send = (r: request.Test) =>
    r.set('Host', host).set('User-Agent', 'UltimateERP-Mobile/1').set(AUTH_STATE_HEADER, state);
  const remember = async (r: request.Test) => {
    const res = await r;
    const next = res.headers[AUTH_STATE_HEADER];
    if (typeof next === 'string') state = next;
    return res;
  };
  return {
    get: (path: string) => remember(send(request(server).get(path))),
    post: (path: string, body: object = {}) =>
      remember(send(request(server).post(path)).send(body)),
    state: () => state,
    setState: (next: string) => {
      state = next;
    },
  };
}

const decode = (state: string) =>
  JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as Record<string, string>;

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  const config = testConfig({ DATABASE_URL: database.appUrl, ...mailpit.smtpConfig });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
});

afterAll(async () => {
  await worker.close();
  await app.close();
  await Promise.all([database.stop(), mailpit.stop()]);
});

describe('session state in a header (mobile app)', () => {
  it('signs in without cookies: the state comes back in the header and authenticates', async () => {
    const { email } = await person('mobile');
    const phone = mobile();
    const signedIn = await phone.post('/api/v1/auth/sign-in', { email, password: PASSWORD });
    expect(signedIn.status).toBe(200);
    expect(signInResponseSchema.parse(signedIn.body).status).toBe('signed_in');
    expect(signedIn.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(decode(phone.state()))).toContain('erp.session_token');

    const me = await phone.get('/api/v1/auth/me');
    expect(me.status).toBe(200);

    // Without the state → not signed in; with a tampered state → not signed in.
    const anonymous = mobile();
    expect((await anonymous.get('/api/v1/auth/me')).status).toBe(401);
    const tampered = mobile();
    const cookies = decode(phone.state());
    cookies['erp.session_token'] = `${cookies['erp.session_token']?.slice(0, -4) ?? ''}AAAA`;
    tampered.setState(Buffer.from(JSON.stringify(cookies)).toString('base64url'));
    expect((await tampered.get('/api/v1/auth/me')).status).toBe(401);

    // A malformed header is refused outright.
    const broken = await request(server)
      .get('/api/v1/auth/me')
      .set(AUTH_STATE_HEADER, Buffer.from('["x"]').toString('base64url'));
    expect(broken.status).toBe(400);
    expect(errorResponseSchema.parse(broken.body).error.code).toBe('BAD_REQUEST');

    // Sign-out removes the session from the state.
    expect((await phone.post('/api/v1/auth/sign-out')).status).toBe(200);
    expect(decode(phone.state())['erp.session_token']).toBeUndefined();
    expect((await phone.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('completes two-factor sign-in through the header alone', async () => {
    const browser = await person('mobile2fa');
    const setup = twoFactorSetupResponseSchema.parse(
      (await browser.post('/api/v1/auth/two-factor/enable', { password: PASSWORD })).body,
    );
    expect(
      (
        await browser.post('/api/v1/auth/two-factor/confirm', {
          code: await codeAt(setup.totpUri, 0),
        })
      ).status,
    ).toBe(200);

    const phone = mobile();
    const first = await phone.post('/api/v1/auth/sign-in', {
      email: browser.email,
      password: PASSWORD,
    });
    expect(signInResponseSchema.parse(first.body).status).toBe('two_factor_required');
    expect(first.headers['set-cookie']).toBeUndefined();
    expect(phone.state()).not.toBe('');
    expect((await phone.get('/api/v1/auth/me')).status).toBe(401);

    const second = await phone.post('/api/v1/auth/two-factor/verify', {
      code: await codeAt(setup.totpUri, 1),
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(signInResponseSchema.parse(second.body).status).toBe('signed_in');
    expect((await phone.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('moves into a company with a hand-off ticket, once', async () => {
    const { owner, host } = await founder();
    const member = await person('member');
    const memberPhone = mobile();
    expect(
      (await memberPhone.post('/api/v1/auth/sign-in', { email: member.email, password: PASSWORD }))
        .status,
    ).toBe(200);
    // Not yet in any company.
    const none = myCompaniesResponseSchema.parse(
      (await memberPhone.get('/api/v1/auth/companies')).body,
    );
    expect(none.companies).toEqual([]);

    // Owner invites them from the web; they accept there (the invitation flow is web-only).
    const invited = await owner.post(
      '/api/v1/invitations',
      { email: member.email, role: 'employee' },
      host,
    );
    expect(invited.status).toBe(201);
    const token = tokenFrom(await mailpit.waitFor(member.email, 'invited'));
    expect((await member.post('/api/v1/invitations/accept', { token }, host)).status).toBe(200);

    const { companies } = myCompaniesResponseSchema.parse(
      (await memberPhone.get('/api/v1/auth/companies')).body,
    );
    expect(companies.map((c) => c.slug)).toEqual([host.replace('.localhost', '')]);
    const company = companies[0];
    if (!company) throw new Error('no company');

    const { url } = handoffResponseSchema.parse(
      (await memberPhone.post('/api/v1/auth/handoff', { tenantId: company.tenantId })).body,
    );
    const ticket = new URL(url).searchParams.get('ticket') ?? '';
    expect(ticket).not.toBe('');

    const companyPhone = mobile(host);
    const redeemed = await companyPhone.post('/api/v1/auth/handoff/redeem', { ticket });
    expect(redeemed.status, JSON.stringify(redeemed.body)).toBe(200);
    expect(redeemed.headers['set-cookie']).toBeUndefined();
    const access = accessMeResponseSchema.parse((await companyPhone.get('/api/v1/access/me')).body);
    expect(access.roles).toEqual(['employee']);

    // The ticket is single use.
    const again = mobile(host);
    expect((await again.post('/api/v1/auth/handoff/redeem', { ticket })).status).toBe(400);
  });

  it('is not subject to the cross-site Origin check (no ambient credential), cookies still are', async () => {
    const { email } = await person('origin');
    const withCookies = await request(server)
      .post('/api/v1/auth/sign-in')
      .set('Origin', 'https://evil.example')
      .send({ email, password: PASSWORD });
    expect(withCookies.status).toBe(403);

    const withHeader = await request(server)
      .post('/api/v1/auth/sign-in')
      .set('Origin', 'https://evil.example')
      .set(AUTH_STATE_HEADER, '')
      .send({ email, password: PASSWORD });
    expect(withHeader.status).toBe(200);
    expect(withHeader.headers['set-cookie']).toBeUndefined();
  });
});
