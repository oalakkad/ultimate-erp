import pg from 'pg';

/**
 * Volume data for the performance test (docs/hardening.md 15c, architecture.md section 7b): one
 * company at the target size, written directly as erp_migrator (its policy may write every row),
 * valid by construction so every constraint and guard trigger stays enabled. Real accounts (the
 * owner and one employee) are created through the API first; the employee becomes person #0.
 */
export const VOLUME = {
  employees: 500,
  clients: 1_000,
  projects: 5_000,
  tasksPerProject: 8,
  weeks: 100,
  /** Entries per working day (Sunday to Thursday), one hour each. */
  entriesPerDay: 8,
  invoicesPerProject: 2,
  auditEvents: 200_000,
} as const;

export interface SeedTarget {
  tenantId: string;
  ownerUserId: string;
  ownerMembershipId: string;
  /** A real account (signed up through the API) that becomes one of the employees. */
  employeeUserId: string;
}

const num = (prefix: string, n: string) =>
  `'${prefix}-' || case when ${n} < 10000 then lpad((${n})::text, 4, '0') else (${n})::text end`;

/** Runs the seed and returns the number of rows written per table, with timings. */
export async function seedVolume(
  migratorUrl: string,
  target: SeedTarget,
  log: (line: string) => void,
): Promise<Record<string, number>> {
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  const counts: Record<string, number> = {};
  const p = [target.tenantId, target.ownerUserId, target.ownerMembershipId, target.employeeUserId];
  const step = async (name: string, sql: string, params: unknown[] = p) => {
    const started = Date.now();
    const result = await client.query(sql, params);
    counts[name] = (counts[name] ?? 0) + (result.rowCount ?? 0);
    log(
      `  ${name}: ${result.rowCount ?? 0} rows in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  };
  const V = VOLUME;
  try {
    await client.query("set work_mem = '256MB'");

    await step(
      'users',
      `insert into users (email, name, email_verified)
       select format('perf-%s@example.test', lpad(g::text, 4, '0')), format('Employee %s', lpad(g::text, 4, '0')), true
       from generate_series(1, ${V.employees - 1}) g`,
      [],
    );
    await step(
      'memberships',
      `insert into memberships (tenant_id, user_id, status, joined_at)
       select $1::uuid, u.id, 'active', now() - interval '800 days' from users u
        where u.email like 'perf-%@example.test' or u.id = $2::uuid`,
      [target.tenantId, target.employeeUserId],
    );
    // Person #0 is the real employee account; every 10th person (not #0) is also a manager.
    await client.query(
      `create temporary table people as
       select row_number() over (order by (m.user_id = $2::uuid) desc, m.id) - 1 as i, m.id as mid, m.user_id as uid
         from memberships m where m.tenant_id = $1 and m.id <> $3::uuid`,
      [target.tenantId, target.employeeUserId, target.ownerMembershipId],
    );
    await step(
      'membership_roles',
      `insert into membership_roles (tenant_id, membership_id, role)
       select $1::uuid, mid, 'employee' from people
       union all select $1::uuid, mid, 'manager' from people where i % 10 = 0 and i > 0`,
      [target.tenantId],
    );
    await step(
      'employees',
      `insert into employees (tenant_id, membership_id, number, job_title_en, job_title_ar, status, join_date)
       select $1::uuid, mid, ${num('E', 'i + 1')}, 'Auditor', 'مدقق', 'active', current_date - 800 from people`,
      [target.tenantId],
    );
    await step(
      'clients',
      `insert into clients (tenant_id, number, legal_name_en, legal_name_ar, name_key, status, created_by_user_id, city)
       select $1::uuid, ${num('C', 'g')}, format('Client %s Trading Co.', g), format('عميل %s للتجارة', g),
              format('client %s trading co', g), 'active', $2::uuid, 'Kuwait City'
       from generate_series(1, ${V.clients}) g`,
      [target.tenantId, target.ownerUserId],
    );
    await client.query(
      `create temporary table perf_clients as
       select row_number() over (order by number) - 1 as i, id from clients where tenant_id = $1`,
      [target.tenantId],
    );
    await client.query(
      `create temporary table managers as
       select row_number() over (order by i) - 1 as k, mid from people where i % 10 = 0 and i > 0`,
    );
    await step(
      'projects',
      `insert into projects (tenant_id, number, client_id, name_en, name_ar, manager_membership_id, status,
                             start_date, end_date, billing_method, budget_hours, budget_amount, created_by_user_id)
       select $1::uuid, ${num('P', 'g')}, c.id, format('Engagement %s', g), format('مهمة %s', g), m.mid,
              case when g % 5 = 0 then 'completed' else 'active' end,
              current_date - 700 + (g % 600), current_date - 700 + (g % 600) + 180,
              'time_and_materials', 200 + (g % 10) * 100, (200 + (g % 10) * 100) * 25, $2::uuid
       from generate_series(1, ${V.projects}) g
       join perf_clients c on c.i = (g - 1) % ${V.clients}
       join managers m on m.k = (g - 1) % (select count(*) from managers)`,
      [target.tenantId, target.ownerUserId],
    );
    await client.query(
      `create temporary table perf_projects as
       select row_number() over (order by number) - 1 as i, id, client_id, manager_membership_id
         from projects where tenant_id = $1`,
      [target.tenantId],
    );
    await step(
      'project_members',
      `insert into project_members (tenant_id, project_id, membership_id, added_by_user_id)
       select $1::uuid, id, manager_membership_id, $2::uuid from perf_projects
       union
       select $1::uuid, pp.id, pe.mid, $2::uuid from perf_projects pp cross join generate_series(0, 3) k
         join people pe on pe.i = (pp.i * 7 + k * 101) % ${V.employees}`,
      [target.tenantId, target.ownerUserId],
    );
    await step(
      'tasks',
      `insert into tasks (tenant_id, project_id, number, title, status, priority, start_date, due_date,
                          estimated_hours, created_by_user_id, completed_at)
       select $1::uuid, pp.id, ${num('T', `pp.i * ${V.tasksPerProject} + t + 1`)}, format('Work item %s', t + 1),
              (array['ready','in_progress','in_review','completed','backlog'])[1 + (pp.i + t) % 5],
              (array['low','normal','high','urgent'])[1 + t % 4],
              current_date - 600 + (pp.i % 500)::int, current_date - 600 + (pp.i % 500)::int + 30 + t * 10,
              20 + t * 5, $2::uuid, case when (pp.i + t) % 5 = 3 then now() - interval '10 days' end
       from perf_projects pp cross join generate_series(0, ${V.tasksPerProject - 1}) t`,
      [target.tenantId, target.ownerUserId],
    );
    await client.query(
      `create temporary table perf_tasks as
       select id, project_id, row_number() over (partition by project_id order by number) - 1 as t
         from tasks where tenant_id = $1`,
      [target.tenantId],
    );
    // Each project member (not the manager) works on two of the project's tasks.
    await step(
      'task_allocations',
      `insert into task_allocations (tenant_id, task_id, project_id, membership_id, hours, allocated_by_user_id)
       select $1::uuid, tk.id, tk.project_id, pm.membership_id, 20, $2::uuid
       from (select pm.project_id, pm.membership_id,
                    row_number() over (partition by pm.project_id order by pm.membership_id) - 1 as k
               from project_members pm join perf_projects pp on pp.id = pm.project_id
              where pm.tenant_id = $1 and pm.membership_id <> pp.manager_membership_id) pm
       join perf_tasks tk on tk.project_id = pm.project_id
        and tk.t in ((pm.k * 2) % ${V.tasksPerProject}, (pm.k * 2 + 1) % ${V.tasksPerProject})`,
      [target.tenantId, target.ownerUserId],
    );
    // Weeks start on Sunday (Kuwait); the current week is a draft, last week submitted.
    await step(
      'timesheets',
      `insert into timesheets (tenant_id, membership_id, week_start, status, submitted_at)
       select $1::uuid, pe.mid, x.ws,
              case when w = 0 then 'draft' when w = 1 then 'submitted' else 'approved' end,
              case when w >= 1 then x.ws + 5 end
       from people pe cross join generate_series(0, ${V.weeks - 1}) w
       cross join lateral (select (current_date - extract(dow from current_date)::int - 7 * w)::date as ws) x`,
      [target.tenantId],
    );
    await client.query(
      `create temporary table member_allocs as
       select membership_id, array_agg(task_id order by task_id) as tasks,
              array_agg(project_id order by task_id) as projects, count(*)::int as n
         from task_allocations where tenant_id = $1 group by membership_id`,
      [target.tenantId],
    );
    // One hour per entry on an allocated task; approved weeks were approved by the owner.
    await step(
      'time_entries',
      `insert into time_entries (tenant_id, timesheet_id, membership_id, project_id, task_id, work_date, hours,
                                 billable, status, decided_by_user_id, decided_at, description)
       select $1::uuid, ts.id, ts.membership_id, ma.projects[1 + x.k], ma.tasks[1 + x.k], ts.week_start + d, 1,
              (d * ${V.entriesPerDay} + s) % 7 <> 0, ts.status,
              case when ts.status = 'approved' then $2::uuid end,
              case when ts.status = 'approved' then ts.week_start + 7 end, ''
       from timesheets ts
       join member_allocs ma on ma.membership_id = ts.membership_id
       cross join generate_series(0, 4) d
       cross join generate_series(0, ${V.entriesPerDay - 1}) s
       cross join lateral (select (((ts.week_start - date '2000-01-02') / 7) * 40 + d * ${V.entriesPerDay} + s) % ma.n as k) x
       where ts.tenant_id = $1`,
      [target.tenantId, target.ownerUserId],
    );
    await step(
      'invoices',
      `insert into invoices (tenant_id, client_id, project_id, status, subtotal, total, created_by_user_id)
       select $1::uuid, pp.client_id, pp.id, 'draft', 750, 750, $2::uuid
       from perf_projects pp cross join generate_series(1, ${V.invoicesPerProject})`,
      [target.tenantId, target.ownerUserId],
    );
    await step(
      'invoice_lines',
      `insert into invoice_lines (tenant_id, invoice_id, position, description, quantity, unit_price, amount, discount, tax)
       select $1::uuid, i.id, n, format('Professional services, part %s', n), 10, 25, 250, 0, 0
       from invoices i cross join generate_series(1, 3) n where i.tenant_id = $1`,
      [target.tenantId],
    );
    await step(
      'invoices issued',
      `update invoices set status = 'issued', number = ${num('INV', 'x.rn')},
              issue_date = current_date - (x.rn % 700)::int, due_date = current_date - (x.rn % 700)::int + 30,
              issued_by_user_id = $2::uuid
       from (select id, row_number() over (order by id) as rn from invoices where tenant_id = $1) x
       where invoices.id = x.id`,
      [target.tenantId, target.ownerUserId],
    );
    await step(
      'audit_events',
      `insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_membership_id, action, target_type, ip_address)
       select $1::uuid, now() - make_interval(mins => g * 5), pe.uid, pe.mid,
              (array['clients.client.updated','tasks.task.updated','time.timesheet.submitted',
                     'projects.project.updated','billing.invoice.issued'])[1 + g % 5], 'task', '10.0.0.1'
       from generate_series(1, ${V.auditEvents}) g join people pe on pe.i = g % ${V.employees}`,
      [target.tenantId],
    );
    await step(
      'number_sequences',
      `insert into number_sequences (tenant_id, name, next_value) values
         ($1::uuid, 'client', ${V.clients + 1}), ($1::uuid, 'project', ${V.projects + 1}),
         ($1::uuid, 'task', ${V.projects * V.tasksPerProject + 1}), ($1::uuid, 'employee', ${V.employees + 1}),
         ($1::uuid, 'invoice', ${V.projects * V.invoicesPerProject + 1})
       on conflict (tenant_id, name) do update set next_value = excluded.next_value`,
      [target.tenantId],
    );
    const started = Date.now();
    await client.query('analyze');
    log(`  analyze: ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return counts;
  } finally {
    await client.end();
  }
}
