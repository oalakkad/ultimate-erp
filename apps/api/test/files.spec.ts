import { type Server } from 'node:http';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import {
  auditListResponseSchema,
  fileDownloadResponseSchema,
  type FileInfo,
  fileSchema,
  memberListResponseSchema,
  twoFactorSetupResponseSchema,
} from '@ultimate-erp/contracts';
import { JOB_SCHEMA } from '@ultimate-erp/db';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import { PgBoss } from 'pg-boss';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { FileScanHandler } from '../src/modules/files/files.service.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit, tokenFrom } from './support/mailpit.js';
import { startClamav, startObjectStorage } from './support/storage.js';
import { TcpRelay } from './support/tcp-relay.js';
import { codeAt } from './support/totp.js';

// Milestone 1.5b acceptance 1–4 (docs/modules/files-monitoring.md §5) against real Postgres,
// RustFS (S3) and ClamAV.

const PASSWORD = 'correct horse battery staple';
const MAX_BYTES = 64 * 1024;
// The industry-standard harmless antivirus test file, assembled at run time so this source file
// itself is not flagged by the developer's own antivirus.
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(
  '',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let database: TestDatabase;
let mailpit: TestMailpit;
let storage: Awaited<ReturnType<typeof startObjectStorage>>;
let clamav: Awaited<ReturnType<typeof startClamav>>;
let scanner: TcpRelay;
let app: INestApplication;
let worker: INestApplicationContext;
let server: Server;
let n = 0;

interface Person {
  email: string;
  agent: ReturnType<typeof request.agent>;
}

const at = (r: request.Test, host: string) => r.set('Host', host).set('User-Agent', 'Test/1');

async function person(prefix: string): Promise<Person> {
  const email = `${prefix}-${Date.now().toString(36)}${(n += 1)}@example.com`;
  await request(server)
    .post('/api/v1/auth/sign-up')
    .send({ email, password: PASSWORD, name: prefix });
  const token = tokenFrom(await mailpit.waitFor(email, 'Confirm your email'));
  await request(server).get(`/api/v1/auth/verify-email?token=${token}`);
  const agent = request.agent(server);
  const res = await at(agent.post('/api/v1/auth/sign-in'), 'localhost').send({
    email,
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
  return { email, agent };
}

/** A founder of a new company with two-factor on; returns the company host. */
async function founder(): Promise<{ owner: Person; host: string }> {
  const owner = await person('founder');
  const slug = `files-${Date.now().toString(36)}${(n += 1)}`;
  expect(
    (
      await at(owner.agent.post('/api/v1/companies'), 'localhost').send({
        slug,
        nameEn: 'Co',
        nameAr: 'شركة',
      })
    ).status,
  ).toBe(201);
  const setup = twoFactorSetupResponseSchema.parse(
    (
      await at(owner.agent.post('/api/v1/auth/two-factor/enable'), 'localhost').send({
        password: PASSWORD,
      })
    ).body,
  );
  await at(owner.agent.post('/api/v1/auth/two-factor/confirm'), 'localhost').send({
    code: await codeAt(setup.totpUri, 0),
  });
  return { owner, host: `${slug}.localhost` };
}

async function joinAsEmployee(p: Person, owner: Person, host: string) {
  await at(owner.agent.post('/api/v1/invitations'), host).send({
    email: p.email,
    role: 'employee',
  });
  const token = tokenFrom(await mailpit.waitFor(p.email, 'invited'));
  expect((await at(p.agent.post('/api/v1/invitations/accept'), host).send({ token })).status).toBe(
    200,
  );
}

const upload = (p: Person, host: string, content: Buffer | string, name: string) =>
  at(p.agent.post('/api/v1/files'), host).attach('file', Buffer.from(content), name);

async function statusOf(p: Person, host: string, id: string): Promise<FileInfo['status']> {
  return fileSchema.parse((await at(p.agent.get(`/api/v1/files/${id}`), host)).body).status;
}

async function until(check: () => Promise<boolean>, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`condition not met within ${ms} ms`);
}

beforeAll(async () => {
  [database, mailpit, storage, clamav] = await Promise.all([
    startTestDatabase(),
    TestMailpit.start(),
    startObjectStorage(),
    startClamav(),
  ]);
  // Production waits 30 s, 60 s, … between scan attempts; the test shortens that.
  const boss = new PgBoss({
    connectionString: database.migratorUrl,
    schema: JOB_SCHEMA,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await boss.updateQueue('file.scan', { retryDelay: 1, retryBackoff: false });
  await boss.stop({ graceful: false, close: true });

  scanner = new TcpRelay(clamav.host, clamav.port);
  await scanner.up();
  const config = testConfig({
    DATABASE_URL: database.appUrl,
    ...mailpit.smtpConfig,
    ...storage.config,
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: String(scanner.port),
    FILE_MAX_BYTES: String(MAX_BYTES),
  });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  server = app.getHttpServer() as Server;
}, 420_000);

afterAll(async () => {
  await worker.close();
  await app.close();
  await scanner.down();
  await Promise.all([database.stop(), mailpit.stop(), storage.stop(), clamav.stop()]);
});

describe('uploads', () => {
  it('accepts an allowed file, scans it clean and gives a working 5-minute download link', async () => {
    const { owner, host } = await founder();
    const res = await upload(owner, host, PDF, 'engagement letter.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const file = fileSchema.parse(res.body);
    expect(file).toMatchObject({
      name: 'engagement letter.pdf',
      contentType: 'application/pdf',
      status: 'pending',
    });

    await until(async () => (await statusOf(owner, host, file.id)) === 'clean');
    const link = fileDownloadResponseSchema.parse(
      (await at(owner.agent.post(`/api/v1/files/${file.id}/download`), host)).body,
    );
    expect(link.expiresInSeconds).toBe(300);
    expect(new URL(link.url).searchParams.get('X-Amz-Expires')).toBe('300');
    const download = await fetch(link.url);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(PDF);

    // A tampered link (e.g. asking to display inline instead of download) is refused.
    const tampered = new URL(link.url);
    tampered.searchParams.set('response-content-disposition', 'inline');
    expect((await fetch(tampered)).status).toBe(403);
  });

  it('refuses disguised executables, unknown types, markup and over-size files', async () => {
    const { owner, host } = await founder();
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
    const cases: [Buffer | string, string, number][] = [
      [exe, 'invoice.pdf', 415],
      [Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]), 'data.bin', 415],
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'notes.txt', 415],
      [Buffer.alloc(MAX_BYTES + 1, 0x41), 'big.txt', 413],
    ];
    for (const [content, name, status] of cases) {
      expect((await upload(owner, host, content, name)).status, name).toBe(status);
    }
    expect((await upload(owner, host, 'name,amount\nA,1.500\n', 'fees.csv')).status).toBe(201);
  });

  it('detects the EICAR test virus: infected, deleted from storage, audited, never downloadable', async () => {
    const { owner, host } = await founder();
    const file = fileSchema.parse((await upload(owner, host, EICAR, 'eicar.txt')).body);
    await until(async () => (await statusOf(owner, host, file.id)) === 'infected');
    const res = await at(owner.agent.post(`/api/v1/files/${file.id}/download`), host);
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('FILE_NOT_READY');
    const audit = auditListResponseSchema.parse(
      (await at(owner.agent.get('/api/v1/audit-events'), host)).body,
    );
    expect(audit.items.find((e) => e.action === 'files.file.infected')?.targetId).toBe(file.id);
  });

  it('keeps files pending while the scanner is down, retries, and finally marks scan_failed', async () => {
    const { owner, host } = await founder();
    await scanner.down();
    try {
      const file = fileSchema.parse((await upload(owner, host, PDF, 'a.pdf')).body);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(await statusOf(owner, host, file.id)).toBe('pending');
      expect((await at(owner.agent.post(`/api/v1/files/${file.id}/download`), host)).status).toBe(
        409,
      );
      await until(async () => (await statusOf(owner, host, file.id)) === 'scan_failed', 90_000);
    } finally {
      await scanner.up();
    }
  }, 120_000);
});

describe('file boundaries', () => {
  it('another member, or another company, cannot see or download a file (404)', async () => {
    const { owner, host } = await founder();
    const bob = await person('bob');
    await joinAsEmployee(bob, owner, host);
    const file = fileSchema.parse((await upload(owner, host, PDF, 'private.pdf')).body);
    await until(async () => (await statusOf(owner, host, file.id)) === 'clean');

    expect((await at(bob.agent.get(`/api/v1/files/${file.id}`), host)).status).toBe(404);
    expect((await at(bob.agent.post(`/api/v1/files/${file.id}/download`), host)).status).toBe(404);

    const other = await founder();
    expect((await at(other.owner.agent.get(`/api/v1/files/${file.id}`), other.host)).status).toBe(
      404,
    );
    expect(
      (await at(other.owner.agent.post(`/api/v1/files/${file.id}/download`), other.host)).status,
    ).toBe(404);
  });

  it('a scan job carrying another company’s ID cannot touch this company’s file', async () => {
    const a = await founder();
    const b = await founder();
    await scanner.down(); // keep A's file pending
    try {
      const file = fileSchema.parse((await upload(a.owner, a.host, PDF, 'a.pdf')).body);
      const tenantB = await tenantIdOf(b.owner, b.host);
      const forged = { id: 'forged', retryCount: 0, data: { tenantId: tenantB, fileId: file.id } };
      // Runs B's context: row-level security hides A's row, so nothing is read or changed.
      await worker.get(FileScanHandler).handle(forged as never, true);
      expect(await statusOf(a.owner, a.host, file.id)).toBe('pending');
    } finally {
      await scanner.up();
    }
  });
});

async function tenantIdOf(owner: Person, host: string): Promise<string> {
  const me = (await at(owner.agent.get('/api/v1/access/me'), host)).body as { tenantId: string };
  // Sanity: the owner is a member there.
  memberListResponseSchema.parse((await at(owner.agent.get('/api/v1/members'), host)).body);
  return me.tenantId;
}
