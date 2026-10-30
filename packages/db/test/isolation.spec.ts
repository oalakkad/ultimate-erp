import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/admin.js';
import {
  assertSafeAppRole,
  createDatabase,
  type Database,
  clientContacts,
  clientInteractions,
  clients,
  memberships,
  notifications,
  resolveTenantByHost,
  tenantDomains,
  tenants,
  UnsafeDatabaseRoleError,
  users,
  withTenant,
} from '../src/index.js';
import { startTestDatabase, type TestDatabase } from '../src/testing/index.js';

// Release-blocking (ADR-0003, testing.md §3): company B must never reach company A's data.

let testDb: TestDatabase;
let migratorPool: pg.Pool;
let appPool: pg.Pool;
let app: Database;
let asMigrator: Database;

const ids = {} as {
  tenantA: string;
  tenantB: string;
  suspended: string;
  userA: string;
  userB: string;
  memberA: string;
  memberB: string;
};

/** PostgreSQL error code of a rejected promise (e.g. 42501 = insufficient privilege). */
async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    return (err as { code?: string }).code ?? cause?.code;
  }
  return undefined;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  migratorPool = new pg.Pool({ connectionString: testDb.migratorUrl });
  appPool = new pg.Pool({ connectionString: testDb.appUrl, max: 1 });
  app = createDatabase(appPool);
  asMigrator = createDatabase(migratorPool);

  // Fixtures are written as the migrator (trusted, bypasses tenant policies by explicit policy).
  const [a, b, s] = await asMigrator
    .insert(tenants)
    .values([
      { slug: 'alpha', nameEn: 'Alpha', nameAr: 'ألفا' },
      { slug: 'beta', nameEn: 'Beta', nameAr: 'بيتا' },
      { slug: 'suspended', nameEn: 'Suspended', nameAr: 'موقوف', status: 'suspended' },
    ])
    .returning({ id: tenants.id });
  const [ua, ub] = await asMigrator
    .insert(users)
    .values([
      { email: 'a@example.com', name: 'User A' },
      { email: 'b@example.com', name: 'User B' },
    ])
    .returning({ id: users.id });
  if (!a || !b || !s || !ua || !ub) throw new Error('fixture insert failed');
  Object.assign(ids, { tenantA: a.id, tenantB: b.id, suspended: s.id, userA: ua.id, userB: ub.id });

  await asMigrator.insert(tenantDomains).values([
    { tenantId: a.id, hostname: 'alpha.localhost', kind: 'subdomain', verifiedAt: new Date() },
    { tenantId: b.id, hostname: 'beta.localhost', kind: 'subdomain', verifiedAt: new Date() },
    { tenantId: b.id, hostname: 'unverified.example.com', kind: 'custom' },
    { tenantId: s.id, hostname: 'suspended.localhost', kind: 'subdomain', verifiedAt: new Date() },
  ]);
  const [ma, mb] = await asMigrator
    .insert(memberships)
    .values([
      { tenantId: a.id, userId: ua.id, status: 'active' },
      { tenantId: b.id, userId: ub.id, status: 'active' },
    ])
    .returning({ id: memberships.id });
  if (!ma || !mb) throw new Error('fixture insert failed');
  Object.assign(ids, { memberA: ma.id, memberB: mb.id });
});

afterAll(async () => {
  await appPool.end();
  await migratorPool.end();
  await testDb.stop();
});

describe('database roles', () => {
  it('accepts the app role as safe', async () => {
    await expect(assertSafeAppRole(app)).resolves.toBeUndefined();
  });

  it('rejects a superuser connection', async () => {
    const adminPool = new pg.Pool({ connectionString: testDb.adminUrl, max: 1 });
    try {
      await expect(assertSafeAppRole(createDatabase(adminPool))).rejects.toBeInstanceOf(
        UnsafeDatabaseRoleError,
      );
    } finally {
      await adminPool.end();
    }
  });

  it('rejects the migrator (table owner) as the app connection', async () => {
    await expect(assertSafeAppRole(asMigrator)).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
  });

  it('the app role owns nothing and cannot create, alter or disable security', async () => {
    const owned = await migratorPool.query<{ n: number }>(
      `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner
       where r.rolname = 'erp_app'`,
    );
    expect(owned.rows[0]?.n).toBe(0);
    expect(await pgErrorCode(app.execute(sql`create table evil (id int)`))).toBe('42501');
    expect(
      await pgErrorCode(app.execute(sql`alter table memberships disable row level security`)),
    ).toBe('42501');
    expect(
      await pgErrorCode(app.execute(sql`drop policy memberships_isolation on memberships`)),
    ).toBe('42501');
  });

  it('the app role uses the job queue but cannot change its structure', async () => {
    expect(await pgErrorCode(app.execute(sql`create table pgboss.evil (id int)`))).toBe('42501');
    expect(await pgErrorCode(app.execute(sql`drop table pgboss.job`))).toBe('42501');
    const queues = await app.execute(sql`select name from pgboss.queue order by name`);
    expect(queues.rows.map((r) => r.name)).toContain('email.send');
  });
});

describe('every tenant-owned table is protected (catalog guard for future tables)', () => {
  it('has RLS enabled and forced, an app policy, and a (tenant_id, id) unique key', async () => {
    const { rows } = await migratorPool.query<{
      table: string;
      rls: boolean;
      forced: boolean;
      app_policies: number;
      composite_key: boolean;
    }>(`
      select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        (select count(*)::int from pg_policies p
          where p.tablename = c.relname and 'erp_app' = any(p.roles)) as app_policies,
        exists (
          -- a primary or unique key that includes tenant_id (target for composite foreign keys)
          select 1 from pg_constraint k
          where k.conrelid = c.oid and k.contype in ('u', 'p') and array_length(k.conkey, 1) > 1
            and exists (select 1 from pg_attribute a
                        where a.attrelid = c.oid and a.attnum = any(k.conkey) and a.attname = 'tenant_id')
        ) as composite_key
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
    `);
    expect(rows.map((r) => r.table).sort()).toEqual([
      'audit_events',
      'client_contacts',
      'client_documents',
      'client_interactions',
      'clients',
      'contract_templates',
      'contract_versions',
      'contracts',
      'departments',
      'employee_checklist_items',
      'employee_documents',
      'employee_emergency_contacts',
      'employee_history',
      'employee_private',
      'employees',
      'files',
      'handoff_tickets',
      'invitations',
      'membership_roles',
      'memberships',
      'notifications',
      'number_sequences',
      'project_budget_revisions',
      'project_documents',
      'project_members',
      'projects',
      'task_allocations',
      'task_comments',
      'task_dependencies',
      'task_documents',
      'tasks',
      'team_members',
      'teams',
      'tenant_domains',
      'time_entries',
      'time_timers',
      'timesheets',
    ]);
    for (const row of rows) {
      expect(row, row.table).toMatchObject({ rls: true, forced: true, composite_key: true });
      expect(row.app_policies, row.table).toBeGreaterThan(0);
    }
  });

  it('tables without tenant_id are exactly the reviewed global tables', async () => {
    // Adding a table here is a security decision: it will be visible regardless of tenant.
    const { rows } = await migratorPool.query<{ table: string }>(`
      select c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_attribute a
                        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
      order by 1
    `);
    expect(rows.map((r) => r.table)).toEqual([
      'accounts',
      'email_deliveries',
      'rate_limit_buckets',
      'sessions',
      'tenants',
      'two_factors',
      'used_totp_codes',
      'user_known_devices',
      'users',
      'verifications',
    ]);
  });

  it('the tenants table itself is protected', async () => {
    const { rows } = await migratorPool.query(
      `select relrowsecurity, relforcerowsecurity from pg_class where relname = 'tenants'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe('no tenant context ⇒ no rows (fail closed)', () => {
  it.each([
    ['tenants', tenants],
    ['tenant_domains', tenantDomains],
    ['memberships', memberships],
  ] as const)('%s returns nothing without withTenant', async (_name, table) => {
    expect(await app.select().from(table)).toEqual([]);
  });

  it('the tenant setting does not leak to the next use of a pooled connection', async () => {
    // appPool has max 1 connection, so both calls use the same physical connection.
    const inside = await withTenant(app, ids.tenantA, (tx) => tx.select().from(memberships));
    expect(inside).toHaveLength(1);
    expect(await app.select().from(memberships)).toEqual([]);
  });
});

describe('company B cannot reach company A', () => {
  it('reads and lists only its own rows', async () => {
    const rows = await withTenant(app, ids.tenantB, async (tx) => ({
      tenants: await tx.select({ id: tenants.id }).from(tenants),
      members: await tx.select({ id: memberships.id }).from(memberships),
      domains: await tx.select({ host: tenantDomains.hostname }).from(tenantDomains),
    }));
    expect(rows.tenants).toEqual([{ id: ids.tenantB }]);
    expect(rows.members).toEqual([{ id: ids.memberB }]);
    expect(rows.domains.map((d) => d.host).sort()).toEqual([
      'beta.localhost',
      'unverified.example.com',
    ]);
  });

  it('a direct lookup of A’s record by ID finds nothing', async () => {
    const found = await withTenant(app, ids.tenantB, (tx) =>
      tx.select().from(memberships).where(eq(memberships.id, ids.memberA)),
    );
    expect(found).toEqual([]);
  });

  it('updates and deletes of A’s rows affect zero rows', async () => {
    const result = await withTenant(app, ids.tenantB, async (tx) => ({
      updatedMember: await tx
        .update(memberships)
        .set({ status: 'suspended' })
        .where(eq(memberships.id, ids.memberA))
        .returning(),
      updatedTenant: await tx
        .update(tenants)
        .set({ nameEn: 'Hacked' })
        .where(eq(tenants.id, ids.tenantA))
        .returning(),
      deletedDomain: await tx
        .delete(tenantDomains)
        .where(eq(tenantDomains.hostname, 'alpha.localhost'))
        .returning(),
    }));
    expect(result).toEqual({ updatedMember: [], updatedTenant: [], deletedDomain: [] });
    const [member] = await asMigrator
      .select()
      .from(memberships)
      .where(eq(memberships.id, ids.memberA));
    expect(member?.status).toBe('active');
  });

  it('cannot insert a row into A while working as B', async () => {
    const code = await pgErrorCode(
      withTenant(app, ids.tenantB, (tx) =>
        tx.insert(memberships).values({ tenantId: ids.tenantA, userId: ids.userB }),
      ),
    );
    expect(code).toBe('42501'); // new row violates row-level security policy
  });

  it('cannot move its own row into A', async () => {
    const code = await pgErrorCode(
      withTenant(app, ids.tenantB, (tx) =>
        tx
          .update(memberships)
          .set({ tenantId: ids.tenantA })
          .where(eq(memberships.id, ids.memberB)),
      ),
    );
    expect(code).toBe('42501');
  });

  it('cannot link its record to A’s record, even bypassing RLS (composite foreign key)', async () => {
    // As the migrator (no RLS restrictions) the database itself still refuses the cross-tenant link.
    const code = await pgErrorCode(
      asMigrator
        .update(memberships)
        .set({ invitedByMembershipId: ids.memberA })
        .where(eq(memberships.id, ids.memberB)),
    );
    expect(code).toBe('23503'); // foreign key violation
  });

  it('can link records within the same tenant', async () => {
    const [inviter] = await withTenant(app, ids.tenantA, (tx) =>
      tx
        .insert(memberships)
        .values({ tenantId: ids.tenantA, userId: ids.userB, invitedByMembershipId: ids.memberA })
        .returning({ id: memberships.id }),
    );
    expect(inviter?.id).toBeDefined();
  });

  it('the app role may never delete tenants or memberships', async () => {
    expect(
      await pgErrorCode(
        withTenant(app, ids.tenantA, (tx) =>
          tx.delete(memberships).where(eq(memberships.id, ids.memberA)),
        ),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(
        withTenant(app, ids.tenantA, (tx) => tx.delete(tenants).where(eq(tenants.id, ids.tenantA))),
      ),
    ).toBe('42501');
  });
});

describe('notifications', () => {
  it('are visible only inside their company', async () => {
    await withTenant(app, ids.tenantA, (tx) =>
      tx
        .insert(notifications)
        .values({ tenantId: ids.tenantA, userId: ids.userA, type: 'test.created' }),
    );
    const inB = await withTenant(app, ids.tenantB, (tx) => tx.select().from(notifications));
    expect(inB).toEqual([]);
    const inA = await withTenant(app, ids.tenantA, (tx) => tx.select().from(notifications));
    expect(inA).toHaveLength(1);
  });

  it('can only be addressed to a member of that company (composite foreign key)', async () => {
    const [outsider] = await asMigrator
      .insert(users)
      .values({ email: 'outsider@example.com', name: 'Outsider' })
      .returning({ id: users.id });
    const code = await pgErrorCode(
      withTenant(app, ids.tenantA, (tx) =>
        tx
          .insert(notifications)
          .values({ tenantId: ids.tenantA, userId: outsider?.id ?? '', type: 'test.created' }),
      ),
    );
    expect(code).toBe('23503');
  });

  it('links must be relative paths', async () => {
    const code = await pgErrorCode(
      withTenant(app, ids.tenantA, (tx) =>
        tx.insert(notifications).values({
          tenantId: ids.tenantA,
          userId: ids.userA,
          type: 'test.created',
          link: '//evil.example',
        }),
      ),
    );
    expect(code).toBe('23514');
    // The company app's home page is a valid link.
    await withTenant(app, ids.tenantA, (tx) =>
      tx
        .insert(notifications)
        .values({ tenantId: ids.tenantA, userId: ids.userA, type: 'test.created', link: '/' }),
    );
  });

  it('the app role can mark read but not rewrite or delete them', async () => {
    await withTenant(app, ids.tenantA, (tx) =>
      tx.update(notifications).set({ readAt: new Date() }),
    );
    expect(
      await pgErrorCode(
        withTenant(app, ids.tenantA, (tx) =>
          tx.update(notifications).set({ type: 'test.changed' }),
        ),
      ),
    ).toBe('42501');
    expect(await pgErrorCode(withTenant(app, ids.tenantA, (tx) => tx.delete(notifications)))).toBe(
      '42501',
    );
  });
});

describe('clients', () => {
  const newClient = (name: string) =>
    withTenant(app, ids.tenantA, async (tx) => {
      const [row] = await tx
        .insert(clients)
        .values({
          tenantId: ids.tenantA,
          number: `C-${name}`,
          legalNameEn: name,
          legalNameAr: name,
          nameKey: name,
          createdByUserId: ids.userA,
        })
        .returning({ id: clients.id });
      if (!row) throw new Error('client insert failed');
      return row.id;
    });

  it('an interaction cannot name a contact of another client (composite foreign key)', async () => {
    const first = await newClient('first');
    const second = await newClient('second');
    const contactId = await withTenant(app, ids.tenantA, async (tx) => {
      const [row] = await tx
        .insert(clientContacts)
        .values({ tenantId: ids.tenantA, clientId: first, name: 'Sara' })
        .returning({ id: clientContacts.id });
      return row?.id ?? '';
    });
    const code = await pgErrorCode(
      withTenant(app, ids.tenantA, (tx) =>
        tx.insert(clientInteractions).values({
          tenantId: ids.tenantA,
          clientId: second,
          contactId,
          kind: 'call',
          occurredAt: new Date(),
          summary: 'wrong client',
          createdByUserId: ids.userA,
        }),
      ),
    );
    expect(code).toBe('23503');
  });

  it('communication history cannot be rewritten or deleted by the app', async () => {
    const clientId = await newClient('history');
    await withTenant(app, ids.tenantA, (tx) =>
      tx.insert(clientInteractions).values({
        tenantId: ids.tenantA,
        clientId,
        kind: 'note',
        occurredAt: new Date(),
        summary: 'original',
        createdByUserId: ids.userA,
      }),
    );
    expect(
      await pgErrorCode(
        withTenant(app, ids.tenantA, (tx) =>
          tx.update(clientInteractions).set({ summary: 'edited' }),
        ),
      ),
    ).toBe('42501');
    expect(
      await pgErrorCode(withTenant(app, ids.tenantA, (tx) => tx.delete(clientInteractions))),
    ).toBe('42501');
    expect(await pgErrorCode(withTenant(app, ids.tenantA, (tx) => tx.delete(clients)))).toBe(
      '42501',
    );
  });
});

describe('withTenant', () => {
  it('rejects a tenant ID that is not a UUID', async () => {
    await expect(withTenant(app, "x' or '1'='1", () => Promise.resolve(1))).rejects.toThrow(
      TypeError,
    );
  });

  it('rolls everything back when the work fails', async () => {
    await expect(
      withTenant(app, ids.tenantA, async (tx) => {
        await tx.update(tenants).set({ nameEn: 'Changed' }).where(eq(tenants.id, ids.tenantA));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [tenant] = await asMigrator.select().from(tenants).where(eq(tenants.id, ids.tenantA));
    expect(tenant?.nameEn).toBe('Alpha');
  });

  it('maintains updated_at automatically', async () => {
    const [before] = await asMigrator.select().from(tenants).where(eq(tenants.id, ids.tenantA));
    await withTenant(app, ids.tenantA, (tx) =>
      tx.update(tenants).set({ timezone: 'Asia/Kuwait' }).where(eq(tenants.id, ids.tenantA)),
    );
    const [after] = await asMigrator.select().from(tenants).where(eq(tenants.id, ids.tenantA));
    if (!before || !after) throw new Error('tenant row missing');
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
});

describe('host-based tenant resolution', () => {
  it('resolves a verified host of an active tenant, case-insensitively', async () => {
    expect(await resolveTenantByHost(app, 'alpha.localhost')).toBe(ids.tenantA);
    expect(await resolveTenantByHost(app, 'BETA.localhost')).toBe(ids.tenantB);
  });

  it.each([
    ['an unknown host', 'nobody.localhost'],
    ['an unverified domain', 'unverified.example.com'],
    ['a suspended tenant', 'suspended.localhost'],
    ['a wildcard attempt', '%.localhost'],
  ])('returns null for %s', async (_case, host) => {
    expect(await resolveTenantByHost(app, host)).toBeNull();
  });
});

describe('platform role (tenant directory only)', () => {
  async function asPlatform(query: string) {
    const client = new pg.Client({ connectionString: testDb.adminUrl });
    await client.connect();
    try {
      await client.query('set role erp_platform');
      return await client.query(query);
    } finally {
      await client.end();
    }
  }

  it('can list all tenants', async () => {
    const { rows } = await asPlatform('select slug from tenants order by slug');
    expect(rows.map((r: { slug: string }) => r.slug)).toEqual(['alpha', 'beta', 'suspended']);
  });

  it.each(['memberships', 'tenant_domains', 'users'])('cannot read %s', async (table) => {
    expect(await pgErrorCode(asPlatform(`select * from ${table}`))).toBe('42501');
  });
});

describe('migrations', () => {
  it('re-running migrations is a no-op', async () => {
    await expect(runMigrations(testDb.migratorUrl)).resolves.toBeUndefined();
  });
});
