import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import { fileSchema, invoiceSchema, myCompaniesResponseSchema } from '@ultimate-erp/contracts';
import { clients, createDatabase, withTenant } from '@ultimate-erp/db';
import {
  startEmptyTestDatabase,
  startTestDatabase,
  type TestDatabase,
} from '@ultimate-erp/db/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { BackupIntegrityError } from '../src/ops/backup-crypto.js';
import { BackupFormatError, MANIFEST_FILE } from '../src/ops/backup-manifest.js';
import { BackupStorage, type StorageSettings } from '../src/ops/backup-storage.js';
import { type BackupResult, createBackup } from '../src/ops/backup.js';
import { isEmptyDatabase, unprotectedTenantTables } from '../src/ops/database-inventory.js';
import { RestoreError, restoreBackup } from '../src/ops/restore.js';
import { BackupKeyError, verifyBackup } from '../src/ops/verify.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';
import { PASSWORD, type Person, people } from './support/people.js';
import { startObjectStorage } from './support/storage.js';

// Phase 15a restore drill (docs/hardening.md section 2, docs/operations.md section 4): real data
// from two companies -> encrypted backup -> restore into a brand-new server and bucket -> the
// same rows, the same protection, working sign-in and byte-identical files.

const KEY = 'drill-backup-key-not-for-production-0123456789';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const CLIENT_A = 'Al Noor Trading Company';

let source: TestDatabase;
let target: TestDatabase;
let mailpit: TestMailpit;
let objectStorage: Awaited<ReturnType<typeof startObjectStorage>>;
let app: INestApplication;
let worker: INestApplicationContext;
let server: Server;
let restoredApp: INestApplication | undefined;
let workDir: string;
let backup: BackupResult;
let sourceStorage: StorageSettings;
let targetStorage: StorageSettings;
const fixture = {} as {
  employee: Person;
  hostA: string;
  tenantA: string;
  tenantB: string;
  invoiceNumber: string;
  fileSha256: string;
};
const {
  person,
  founder,
  join: joinCompany,
} = people(
  () => server,
  () => mailpit,
);
// No virus scanner in this test: uploads simply stay "pending" (the scan has its own tests).
const config = (overrides: Record<string, string>) =>
  testConfig({ ...mailpit.smtpConfig, ...objectStorage.config, CLAMAV_PORT: '1', ...overrides });
const secrets = () => {
  const c = config({ DATABASE_URL: source.appUrl });
  return { dataEncryptionKey: c.DATA_ENCRYPTION_KEY, authSecret: c.AUTH_SECRET };
};
const scalar = async (url: string, sql: string): Promise<string | undefined> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ v: string }>(sql);
    return rows[0]?.v;
  } finally {
    await client.end();
  }
};

beforeAll(async () => {
  [source, target, mailpit, objectStorage] = await Promise.all([
    startTestDatabase(),
    startEmptyTestDatabase(),
    TestMailpit.start(),
    startObjectStorage(),
  ]);
  const s3 = objectStorage.config;
  const settings = (bucket: string): StorageSettings => ({
    endpoint: s3.S3_ENDPOINT ?? '',
    region: 'us-east-1',
    bucket,
    accessKey: s3.S3_ACCESS_KEY ?? '',
    secretKey: s3.S3_SECRET_KEY ?? '',
  });
  sourceStorage = settings(s3.S3_BUCKET ?? 'test-files');
  targetStorage = settings('restored-files');
  workDir = await mkdtemp(join(tmpdir(), 'uerp-drill-'));

  app = await createApp(config({ DATABASE_URL: source.appUrl }));
  await app.init();
  worker = await createWorker(config({ DATABASE_URL: source.appUrl }));
  server = app.getHttpServer() as Server;

  // Company A: owner, an employee, a client, a project, an ISSUED invoice and an uploaded file.
  const a = await founder();
  const employee = await person('drill-employee');
  const employeeId = await joinCompany(employee, a.host, a.owner, 'employee');
  const client = await a.owner.post(
    '/api/v1/clients',
    { legalNameEn: CLIENT_A, legalNameAr: 'شركة النور للتجارة' },
    a.host,
  );
  expect(client.status, JSON.stringify(client.body)).toBe(201);
  const clientId = (client.body as { id: string }).id;
  const project = await a.owner.post(
    '/api/v1/projects',
    {
      clientId,
      nameEn: 'Statutory audit 2026',
      nameAr: 'التدقيق القانوني 2026',
      managerMembershipId: employeeId,
      budgetHours: '120',
      memberIds: [employeeId],
    },
    a.host,
  );
  expect(project.status, JSON.stringify(project.body)).toBe(201);
  const draft = invoiceSchema.parse(
    (
      await a.owner.post(
        '/api/v1/invoices',
        {
          clientId,
          lines: [{ description: 'Audit fieldwork', quantity: '10', unitPrice: '25.000' }],
        },
        a.host,
      )
    ).body,
  );
  const issued = invoiceSchema.parse(
    (await a.owner.post(`/api/v1/invoices/${draft.id}/issue`, {}, a.host)).body,
  );
  expect(issued.status).toBe('issued');
  const uploaded = await a.owner.attach('/api/v1/files', PDF, 'engagement-letter.pdf', a.host);
  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
  fileSchema.parse(uploaded.body);

  // Company B: its own client.
  const b = await founder();
  expect(
    (
      await b.owner.post(
        '/api/v1/clients',
        { legalNameEn: 'Beta Holding', legalNameAr: 'بيتا القابضة' },
        b.host,
      )
    ).status,
  ).toBe(201);

  const tenantOf = async (host: string) =>
    (await scalar(
      source.migratorUrl,
      `select tenant_id as v from tenant_domains where hostname = '${host}'`,
    )) ?? '';
  Object.assign(fixture, {
    employee,
    hostA: a.host,
    tenantA: await tenantOf(a.host),
    tenantB: await tenantOf(b.host),
    invoiceNumber: issued.number ?? '',
    fileSha256: createHash('sha256').update(PDF).digest('hex'),
  });
}, 300_000);

afterAll(async () => {
  await restoredApp?.close();
  await worker.close();
  await app.close();
  await rm(workDir, { recursive: true, force: true });
  await Promise.all([source.stop(), target.stop(), mailpit.stop(), objectStorage.stop()]);
});

describe('backup', () => {
  it('captures every table and the stored files, encrypted', async () => {
    backup = await createBackup({
      migratorUrl: source.migratorUrl,
      pg: { kind: 'container', containerId: source.containerId },
      storage: sourceStorage,
      dir: join(workDir, 'backups'),
      encryptionKey: KEY,
      secrets: secrets(),
    });
    const { manifest } = backup;
    expect(manifest.warnings).toEqual([]);
    expect(manifest.database.tables['public.invoices']).toBe(1);
    expect(manifest.database.tables['public.clients']).toBe(2);
    expect(manifest.database.tables['public.tenants']).toBe(2);
    expect(manifest.database.forcedRls).toContain('public.invoices');
    expect(manifest.objects).toMatchObject({ included: true, count: 1, bytes: PDF.length });
    expect(manifest.secretFingerprints.DATA_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{16}$/);
    // Encrypted at rest: no client name in the database file.
    const dump = await readFile(join(backup.path, manifest.database.dumpFile));
    expect(dump.includes(Buffer.from(CLIENT_A))).toBe(false);
    // And the backup checks out.
    const verified = await verifyBackup(backup.path, KEY);
    expect(verified.objects).toHaveLength(1);
  }, 120_000);

  it('detects damage, a wrong key and a tampered manifest', async () => {
    const copy = join(workDir, 'damaged');
    await cp(backup.path, copy, { recursive: true });
    await expect(verifyBackup(copy, 'a-different-key-that-is-long-enough-012345')).rejects.toThrow(
      BackupKeyError,
    );

    const dumpPath = join(copy, backup.manifest.database.dumpFile);
    const bytes = await readFile(dumpPath);
    bytes[100] = (bytes[100] ?? 0) ^ 0x01;
    await writeFile(dumpPath, bytes);
    await expect(verifyBackup(copy, KEY)).rejects.toThrow(BackupIntegrityError);

    const manifestPath = join(copy, MANIFEST_FILE);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      files: { name: string }[];
    };
    const first = manifest.files[0];
    if (first) first.name = '../outside.enc';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(verifyBackup(copy, KEY)).rejects.toThrow(BackupFormatError);
  }, 60_000);
});

describe('restore safety checks (nothing is written)', () => {
  it('refuses a database that already has data', async () => {
    await expect(
      restoreBackup({
        dir: backup.path,
        adminUrl: source.adminUrl,
        migratorUrl: source.migratorUrl,
        appUrl: source.appUrl,
        pg: { kind: 'container', containerId: source.containerId },
        storage: targetStorage,
        encryptionKey: KEY,
        secrets: secrets(),
      }),
    ).rejects.toThrow(/not empty/);
    expect(await scalar(source.migratorUrl, 'select count(*)::text as v from invoices')).toBe('1');
  }, 60_000);

  it('refuses application secrets that differ from the backup', async () => {
    await expect(
      restoreBackup({
        dir: backup.path,
        adminUrl: target.adminUrl,
        migratorUrl: target.migratorUrl,
        appUrl: target.appUrl,
        pg: { kind: 'container', containerId: target.containerId },
        storage: targetStorage,
        encryptionKey: KEY,
        secrets: { ...secrets(), dataEncryptionKey: 'some-other-data-key-0123456789-0123456789' },
      }),
    ).rejects.toThrow(RestoreError);
    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    try {
      expect(await isEmptyDatabase(admin)).toBe(true);
    } finally {
      await admin.end();
    }
  }, 60_000);

  it('refuses a file bucket that is not empty', async () => {
    await expect(
      restoreBackup({
        dir: backup.path,
        adminUrl: target.adminUrl,
        migratorUrl: target.migratorUrl,
        appUrl: target.appUrl,
        pg: { kind: 'container', containerId: target.containerId },
        storage: sourceStorage,
        encryptionKey: KEY,
        secrets: secrets(),
      }),
    ).rejects.toThrow(/bucket .* is not empty/);
  }, 60_000);
});

describe('restore into a brand-new server', () => {
  it('restores the same rows, protection and files, and people can sign in', async () => {
    const result = await restoreBackup({
      dir: backup.path,
      adminUrl: target.adminUrl,
      migratorUrl: target.migratorUrl,
      appUrl: target.appUrl,
      pg: { kind: 'container', containerId: target.containerId },
      storage: targetStorage,
      encryptionKey: KEY,
      secrets: secrets(),
      signOutEveryone: true,
    });
    const expectedRows = Object.values(backup.manifest.database.tables).reduce((s, n) => s + n, 0);
    expect(result.rows).toBe(expectedRows);
    expect(result.objects).toBe(1);
    expect(result.migrationsApplied).toBe(0);

    // The issued invoice kept its number and state (guards did not block loading it).
    expect(await scalar(target.migratorUrl, 'select number || status as v from invoices')).toBe(
      `${fixture.invoiceNumber}issued`,
    );
    expect(await scalar(target.migratorUrl, 'select count(*)::text as v from sessions')).toBe('0');

    // Isolation survives: forced RLS everywhere, and company B cannot see company A.
    const migrator = new pg.Client({ connectionString: target.migratorUrl });
    await migrator.connect();
    try {
      expect(await unprotectedTenantTables(migrator)).toEqual([]);
    } finally {
      await migrator.end();
    }
    const appPool = new pg.Pool({ connectionString: target.appUrl, max: 1 });
    try {
      const db = createDatabase(appPool);
      const seenByB = await withTenant(db, fixture.tenantB, (tx) =>
        tx.select({ name: clients.legalNameEn, tenantId: clients.tenantId }).from(clients),
      );
      expect(seenByB.map((c) => c.name)).toEqual(['Beta Holding']);
      const seenByA = await withTenant(db, fixture.tenantA, (tx) =>
        tx.select({ name: clients.legalNameEn }).from(clients),
      );
      expect(seenByA.map((c) => c.name)).toEqual([CLIENT_A]);
    } finally {
      await appPool.end();
    }

    // Stored files are byte-identical.
    const restored = new BackupStorage(targetStorage);
    try {
      const key = await scalar(target.migratorUrl, 'select storage_key as v from files');
      const { body } = await restored.read(key ?? '');
      const hash = createHash('sha256');
      for await (const chunk of body) hash.update(chunk);
      expect(hash.digest('hex')).toBe(fixture.fileSha256);
    } finally {
      restored.close();
    }

    // The restored system works: a person signs in with their password and sees their company.
    restoredApp = await createApp(
      config({ DATABASE_URL: target.appUrl, S3_BUCKET: targetStorage.bucket }),
    );
    await restoredApp.init();
    const agent = request.agent(restoredApp.getHttpServer() as Server);
    const signIn = await agent
      .post('/api/v1/auth/sign-in')
      .set('Host', 'localhost')
      .set('User-Agent', 'Test/1')
      .send({ email: fixture.employee.email, password: PASSWORD });
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);
    const companies = myCompaniesResponseSchema.parse(
      (
        await agent
          .get('/api/v1/auth/companies')
          .set('Host', 'localhost')
          .set('User-Agent', 'Test/1')
      ).body,
    );
    expect(companies.companies.map((c) => c.tenantId)).toEqual([fixture.tenantA]);
  }, 180_000);
});
