import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import pg from 'pg';

// Helpers for the full-stack journey (docs/testing.md): the real dev API, database and Mailpit
// from `pnpm dev`. Nothing here is mocked — the test reads the emails the API really sent.

try {
  process.loadEnvFile('../../.env');
} catch {
  // CI passes the same variables through the environment instead of a .env file.
}

const MAILPIT = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? '8025'}/api/v1`;

/**
 * Empties the sign-up / sign-in rate-limit counters so repeated local runs are not blocked.
 * Refuses anything but a local development database.
 */
export async function resetDevRateLimits(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production' || !url) {
    throw new Error('resetDevRateLimits: needs a development DATABASE_URL');
  }
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`resetDevRateLimits: refusing non-local database host ${host}`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DELETE FROM rate_limit_buckets');
  } finally {
    await client.end();
  }
}

interface MessageSummary {
  ID: string;
}

async function messageIdsTo(to: string): Promise<string[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT}/search?query=${query}`);
  const { messages } = (await res.json()) as { messages: MessageSummary[] };
  return messages.map((m) => m.ID);
}

/** Waits (max 15 s) for an email to `to` containing a link with `pathAndQuery`; returns the link. */
export async function linkFromEmail(to: string, pathAndQuery: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const id of await messageIdsTo(to)) {
      const { Text } = (await (await fetch(`${MAILPIT}/message/${id}`)).json()) as { Text: string };
      const link = Text.match(/https?:\/\/\S+/g)?.find((url) => url.includes(pathAndQuery));
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No email to ${to} with a ${pathAndQuery} link within 15 s`);
}

/** Deletes this run's emails so the owner's dev inbox stays clean. */
export async function deleteEmailsTo(...addresses: string[]): Promise<void> {
  const ids = (await Promise.all(addresses.map(messageIdsTo))).flat();
  if (ids.length === 0) return;
  await fetch(`${MAILPIT}/messages`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ IDs: ids }),
  });
}

/** The 6-digit code an authenticator app would show now for this base32 secret. */
export async function totpNow(secret: string): Promise<string> {
  const step = Math.floor(Date.now() / 1000 / 30);
  return createOTP(base32.decode(secret)).hotp(step);
}

/**
 * Waits until the dev API answers steadily. `pnpm e2e:journey` rebuilds the shared packages
 * first, which makes the API's file watcher restart it; starting before that settles fails
 * at sign-up for no real reason.
 */
export async function waitForSteadyApi(timeoutMs = 60_000): Promise<void> {
  const health = `http://127.0.0.1:${process.env.API_PORT ?? '3000'}/api/v1/health`;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + timeoutMs;
  let healthyInRow = 0;
  await pause(5000);
  while (Date.now() < deadline) {
    const ok = await fetch(health).then(
      (r) => r.ok,
      () => false,
    );
    healthyInRow = ok ? healthyInRow + 1 : 0;
    if (healthyInRow >= 8) return;
    await pause(1000);
  }
  throw new Error(`The dev API at ${health} did not become steady within ${timeoutMs} ms`);
}
