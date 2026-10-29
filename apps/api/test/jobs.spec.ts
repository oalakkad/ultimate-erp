import { connect, createServer, type Server, type Socket } from 'node:net';
import { type INestApplication, type INestApplicationContext } from '@nestjs/common';
import { type Database, emailDeliveries, JOB_SCHEMA } from '@ultimate-erp/db';
import { startTestDatabase, type TestDatabase } from '@ultimate-erp/db/testing';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { DB } from '../src/platform/database/database.tokens.js';
import { EmailOutbox } from '../src/platform/mail/email-outbox.js';
import { type EmailMessage } from '../src/platform/mail/mailer.js';
import { createWorker } from '../src/worker-bootstrap.js';
import { testConfig } from './support/config.js';
import { TestMailpit } from './support/mailpit.js';

// Milestone 1.5a acceptance 1–3 and 5 (docs/modules/platform-jobs.md §7): email goes through
// the outbox and the worker, survives a mail-server outage, never outlives a rollback, and
// never rests readable in the queue. Real Postgres, real Mailpit, real worker.

/**
 * A switchable relay in front of Mailpit: `down()` makes the SMTP port refuse connections,
 * as a crashed mail server would; `up()` restores it on the same port.
 */
class SmtpRelay {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  port = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  async up(): Promise<void> {
    this.server = createServer((client) => {
      const upstream = connect(this.targetPort, this.targetHost);
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on('error', () => s.destroy());
        s.on('close', () => this.sockets.delete(s));
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve) => this.server?.listen(this.port, '127.0.0.1', resolve));
    const address = this.server.address();
    if (address && typeof address === 'object') this.port = address.port;
  }

  async down(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

let database: TestDatabase;
let mailpit: TestMailpit;
let relay: SmtpRelay;
let app: INestApplication;
let worker: INestApplicationContext;
let outbox: EmailOutbox;
let db: Database;
let admin: pg.Pool;
let n = 0;

const message = (to: string, extra: Record<string, string> = {}): EmailMessage => ({
  to,
  locale: 'en',
  template: 'passwordChanged',
  params: { name: 'Test', ...extra },
});
const address = () => `jobs-${++n}@example.com`;

async function delivery(id: string) {
  const [row] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.id, id));
  return row;
}

/** Polls an explicit condition (max `ms`), as the mail tests do. */
async function until(check: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`condition not met within ${ms} ms`);
}

beforeAll(async () => {
  [database, mailpit] = await Promise.all([startTestDatabase(), TestMailpit.start()]);
  admin = new pg.Pool({ connectionString: database.migratorUrl, max: 2 });

  // Production waits 30 s, 60 s, … between attempts; the test shortens that (same retry count).
  const boss = new PgBoss({
    connectionString: database.migratorUrl,
    schema: JOB_SCHEMA,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  await boss.updateQueue('email.send', { retryDelay: 1, retryBackoff: false });
  await boss.stop({ graceful: false, close: true });

  const smtp = mailpit.smtpConfig;
  relay = new SmtpRelay(smtp.SMTP_HOST ?? '127.0.0.1', Number(smtp.SMTP_PORT));
  await relay.up();
  const config = testConfig({
    DATABASE_URL: database.appUrl,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(relay.port),
  });
  app = await createApp(config);
  await app.init();
  worker = await createWorker(config);
  outbox = app.get(EmailOutbox);
  db = app.get<Database>(DB);
}, 120_000);

afterAll(async () => {
  await worker.close();
  await app.close();
  await relay.down();
  await admin.end();
  await Promise.all([database.stop(), mailpit.stop()]);
});

describe('email outbox', () => {
  it('delivers a queued email through the worker and records it as sent', async () => {
    const to = address();
    const id = await outbox.enqueue(message(to));
    expect((await delivery(id))?.status).toBe('queued');
    await mailpit.waitFor(to, '');
    await until(async () => (await delivery(id))?.status === 'sent');
    expect(await delivery(id)).toMatchObject({ status: 'sent', attempts: 1, lastErrorCode: null });
  });

  it('sends nothing when the transaction that queued the email rolls back', async () => {
    const to = address();
    await expect(
      db.transaction(async (tx) => {
        await outbox.enqueue(message(to), tx);
        throw new Error('the business change failed');
      }),
    ).rejects.toThrow('the business change failed');
    const rows = await db.select().from(emailDeliveries).where(eq(emailDeliveries.recipient, to));
    expect(rows).toEqual([]);
    // Give a (wrongly) queued job ample time to be delivered before concluding.
    const sentLater = await new Promise<number>((resolve) =>
      setTimeout(
        () =>
          void mailpit.messagesTo(to).then((m) => {
            resolve(m.length);
          }),
        4_000,
      ),
    );
    expect(sentLater).toBe(0);
  });

  it('keeps one-time links and the recipient encrypted while queued', async () => {
    const to = address();
    const secret = 'one-time-token-7f3a9c';
    const id = await outbox.enqueue({
      to,
      locale: 'en',
      template: 'resetPassword',
      params: { name: 'Test', url: `http://localhost:5173/reset-password?token=${secret}` },
    });
    const { rows } = await admin.query<{ data: unknown }>(
      `select data from ${JOB_SCHEMA}.job where data->>'deliveryId' = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows[0]?.data);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(to);
    expect((rows[0]?.data as { message: string }).message).toMatch(/^v1\./);
    // …and the worker can still read it.
    expect((await mailpit.waitFor(to, '')).text).toContain(secret);
  });

  it('retries while the mail server is down and delivers once it is back', async () => {
    const to = address();
    await relay.down();
    const id = await outbox.enqueue(message(to));
    await until(async () => ((await delivery(id))?.attempts ?? 0) >= 2);
    expect(await delivery(id)).toMatchObject({
      status: 'queued',
      lastErrorCode: 'SMTP_UNAVAILABLE',
    });
    await relay.up();
    await until(async () => (await delivery(id))?.status === 'sent');
    expect(await mailpit.messagesTo(to)).toHaveLength(1);
  }, 60_000);

  it('marks the email failed after the last attempt, storing only an error code', async () => {
    const to = address();
    await relay.down();
    try {
      const id = await outbox.enqueue(message(to));
      await until(async () => (await delivery(id))?.status === 'failed', 50_000);
      expect(await delivery(id)).toMatchObject({ attempts: 6, lastErrorCode: 'SMTP_UNAVAILABLE' });
      const { rows } = await admin.query<{ state: string; output: unknown }>(
        `select state, output from ${JOB_SCHEMA}.job where data->>'deliveryId' = $1`,
        [id],
      );
      expect(rows[0]?.state).toBe('failed');
      expect(JSON.stringify(rows[0]?.output)).not.toContain(to);
    } finally {
      await relay.up();
    }
  }, 70_000);
});
