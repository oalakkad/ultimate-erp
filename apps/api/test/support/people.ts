import { type Server } from 'node:http';
import {
  memberListResponseSchema,
  type Role,
  twoFactorSetupResponseSchema,
} from '@ultimate-erp/contracts';
import request from 'supertest';
import { expect } from 'vitest';
import { type TestMailpit, tokenFrom } from './mailpit.js';
import { codeAt } from './totp.js';

export const PASSWORD = 'correct horse battery staple';

/** A signed-in browser for one person; `host` sets which address (company) it talks to. */
export interface Person {
  email: string;
  get(path: string, host?: string): request.Test;
  post(path: string, body?: object, host?: string): request.Test;
  patch(path: string, body: object, host?: string): request.Test;
  put(path: string, body: object, host?: string): request.Test;
  delete(path: string, host?: string): request.Test;
}

/**
 * Real sign-up → email confirmation (from Mailpit) → sign-in, company founding and invitations,
 * exactly as people do it — shared by the module test suites.
 */
export function people(server: () => Server, mailpit: () => TestMailpit) {
  let n = 0;
  const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${(n += 1)}`;

  const browserFor = (email: string): Person => {
    const agent = request.agent(server());
    const at = (r: request.Test, host = 'localhost') =>
      r.set('Host', host).set('User-Agent', 'Test/1');
    return {
      email,
      get: (path, host) => at(agent.get(path), host),
      post: (path, body, host) => at(agent.post(path), host).send(body ?? {}),
      patch: (path, body, host) => at(agent.patch(path), host).send(body),
      put: (path, body, host) => at(agent.put(path), host).send(body),
      delete: (path, host) => at(agent.delete(path), host),
    };
  };

  const person = async (prefix = 'user'): Promise<Person> => {
    const email = `${unique(prefix)}@example.com`;
    await request(server())
      .post('/api/v1/auth/sign-up')
      .send({ email, password: PASSWORD, name: prefix });
    const token = tokenFrom(await mailpit().waitFor(email, 'Confirm your email'));
    await request(server()).get(`/api/v1/auth/verify-email?token=${token}`);
    const p = browserFor(email);
    expect((await p.post('/api/v1/auth/sign-in', { email, password: PASSWORD })).status).toBe(200);
    return p;
  };

  const founder = async (): Promise<{ owner: Person; host: string }> => {
    const owner = await person('founder');
    const slug = unique('co-');
    const res = await owner.post('/api/v1/companies', { slug, nameEn: 'Test Co', nameAr: 'شركة' });
    expect(res.status).toBe(201);
    const setup = twoFactorSetupResponseSchema.parse(
      (await owner.post('/api/v1/auth/two-factor/enable', { password: PASSWORD })).body,
    );
    await owner.post('/api/v1/auth/two-factor/confirm', { code: await codeAt(setup.totpUri, 0) });
    return { owner, host: `${slug}.localhost` };
  };

  /** Invites `p` with `role` and accepts; returns the new membership ID. */
  const join = async (p: Person, host: string, owner: Person, role: Role): Promise<string> => {
    const invited = await owner.post('/api/v1/invitations', { email: p.email, role }, host);
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    const token = tokenFrom(await mailpit().waitFor(p.email, 'invited'));
    expect((await p.post('/api/v1/invitations/accept', { token }, host)).status).toBe(200);
    const { members } = memberListResponseSchema.parse(
      (await owner.get('/api/v1/members', host)).body,
    );
    const found = members.find((m) => m.email === p.email);
    if (!found) throw new Error(`${p.email} is not a member`);
    return found.membershipId;
  };

  /** Turns two-factor on (sensitive roles such as CEO or HR & payroll need it). */
  const enableTwoFactor = async (p: Person): Promise<void> => {
    const setup = twoFactorSetupResponseSchema.parse(
      (await p.post('/api/v1/auth/two-factor/enable', { password: PASSWORD })).body,
    );
    const confirmed = await p.post('/api/v1/auth/two-factor/confirm', {
      code: await codeAt(setup.totpUri, 0),
    });
    expect(confirmed.status).toBe(200);
  };

  return { unique, person, founder, join, enableTwoFactor };
}
