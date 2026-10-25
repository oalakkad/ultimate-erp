// `pnpm db:seed` — DEVELOPMENT FIXTURES ONLY. Creates two clearly fictional demo companies
// so tenant routing and isolation can be tried locally. Refuses to run outside development.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';
import { tenantDomains, tenants } from '../schema/index.js';
import { readEnv, urls } from './env.js';
import { runCli } from './run.js';

const env = readEnv({
  DATABASE_MIGRATOR_URL: urls.DATABASE_MIGRATOR_URL,
  NODE_ENV: z.literal('development'),
  APP_PROFILE: z.literal('dev'),
});

const DEMO_TENANTS = [
  { slug: 'acme', nameEn: 'Acme Audit (demo)', nameAr: 'أكمي للتدقيق (تجريبي)', locale: 'en' },
  { slug: 'globex', nameEn: 'Globex Risk (demo)', nameAr: 'جلوبكس للمخاطر (تجريبي)', locale: 'ar' },
] as const;

await runCli(async () => {
  const pool = new pg.Pool({ connectionString: env.DATABASE_MIGRATOR_URL, max: 1 });
  try {
    const db = drizzle(pool);
    for (const demo of DEMO_TENANTS) {
      const [tenant] = await db
        .insert(tenants)
        .values({
          slug: demo.slug,
          nameEn: demo.nameEn,
          nameAr: demo.nameAr,
          defaultLocale: demo.locale,
        })
        .onConflictDoUpdate({ target: tenants.slug, set: { slug: sql`excluded.slug` } })
        .returning({ id: tenants.id });
      if (!tenant) throw new Error(`Could not create demo tenant ${demo.slug}`);
      await db
        .insert(tenantDomains)
        .values({
          tenantId: tenant.id,
          hostname: `${demo.slug}.localhost`,
          kind: 'subdomain',
          verifiedAt: new Date(),
        })
        .onConflictDoNothing({ target: tenantDomains.hostname });
      process.stdout.write(`Demo tenant ready: http://${demo.slug}.localhost:3000/api/v1/tenant\n`);
    }
  } finally {
    await pool.end();
  }
});
