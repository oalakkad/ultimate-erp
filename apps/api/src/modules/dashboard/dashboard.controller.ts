import { Controller, Get, Injectable, Module, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ACTIVITY_ACTIONS,
  type ActivityItem,
  type DashboardSummary,
  dashboardSummarySchema,
  hasPermission,
  OPEN_TASK_STATUSES,
  type Permission,
} from '@ultimate-erp/contracts';
import {
  auditEvents,
  clients,
  contracts,
  employees,
  invitations,
  memberships,
  projects,
  taskAllocations,
  tasks,
  timeEntries,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { AttendanceModule } from '../attendance/attendance.controller.js';
import { BillingModule } from '../billing/billing.controller.js';
import { BillingService } from '../billing/billing.service.js';
import { ExpensesModule } from '../expenses/expenses.controller.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { LeaveModule } from '../leave/leave.controller.js';
import { LeaveService } from '../leave/leave.service.js';
import { formatHours, hundredths, onProjectTeam } from '../projects/projects.service.js';
import { weekStartOf } from '../time/time.service.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { type AccessContext, CurrentAccess } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IdentityService } from '../identity/identity.service.js';

const ACTIVITY_LIMIT = 8;
const MY_TASKS_LIMIT = 5;
const PROJECT_HEALTH_LIMIT = 6;
const AWAY_LIMIT = 8;
const AWAY_DAYS_AHEAD = 7;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Midnight on the 1st of this month in Kuwait (UTC+3, no daylight saving), as a UTC instant. */
export function startOfMonthInKuwait(now: Date): Date {
  const kuwait = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(kuwait.getUTCFullYear(), kuwait.getUTCMonth(), 1) - 3 * 60 * 60 * 1000);
}

/**
 * The executive dashboard's numbers (docs/modules/shell-dashboard.md §4). Each section is
 * computed only if the caller holds its permission, inside the company's own transaction.
 * Modules add their sections here as they are delivered.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly identity: IdentityService,
    private readonly leave: LeaveService,
    private readonly attendance: AttendanceService,
    private readonly billing: BillingService,
    private readonly expenses: ExpensesService,
  ) {}

  async summary(access: AccessContext): Promise<DashboardSummary> {
    const may = (permission: Permission) =>
      hasPermission(access.permissions, permission, 'company');
    const now = new Date();
    const result = await this.database.withTenant(access.tenantId, async (tx) => {
      const out: DashboardSummary = {};
      const activeMembers = async () => {
        const [row] = await tx
          .select({ n: count() })
          .from(memberships)
          .where(eq(memberships.status, 'active'));
        return row?.n ?? 0;
      };
      const pendingInvitations = async () => {
        const [row] = await tx
          .select({ n: count() })
          .from(invitations)
          .where(and(eq(invitations.status, 'pending'), gt(invitations.expiresAt, now)));
        return row?.n ?? 0;
      };
      if (may('access.members.invite')) {
        const [sent] = await tx.select({ n: count() }).from(invitations);
        out.setup = {
          invitationSent: (sent?.n ?? 0) > 0,
          colleagueJoined: (await activeMembers()) > 1,
        };
      }
      if (may('access.members.read')) {
        out.team = {
          activeMembers: await activeMembers(),
          pendingInvitations: may('access.members.invite') ? await pendingInvitations() : null,
        };
      }
      if (may('clients.client.read')) {
        const [active] = await tx
          .select({ n: count() })
          .from(clients)
          .where(and(eq(clients.status, 'active'), isNull(clients.archivedAt)));
        const [fresh] = await tx
          .select({ n: count() })
          .from(clients)
          .where(
            and(gte(clients.createdAt, startOfMonthInKuwait(now)), isNull(clients.archivedAt)),
          );
        out.clients = { active: active?.n ?? 0, newThisMonth: fresh?.n ?? 0 };
      }
      if (may('contracts.contract.read')) {
        const active = await tx
          .select({ endDate: contracts.endDate })
          .from(contracts)
          .where(eq(contracts.status, 'active'));
        const today = kuwaitToday(now);
        const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        out.contracts = {
          active: active.length,
          expiringSoon: active.filter(
            (c) => c.endDate !== null && c.endDate >= today && c.endDate <= limit,
          ).length,
        };
      }
      if (may('projects.project.read')) {
        const active = await tx
          .select({ endDate: projects.endDate })
          .from(projects)
          .where(and(eq(projects.status, 'active'), isNull(projects.archivedAt)));
        const today = kuwaitToday(now);
        const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        // Open projects whose allocations on non-cancelled tasks exceed the budget.
        const over = await tx
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(taskAllocations, eq(taskAllocations.projectId, projects.id))
          .innerJoin(tasks, eq(tasks.id, taskAllocations.taskId))
          .where(
            and(
              inArray(projects.status, ['planned', 'active', 'on_hold']),
              isNull(projects.archivedAt),
              ne(tasks.status, 'cancelled'),
            ),
          )
          .groupBy(projects.id, projects.budgetHours)
          .having(sql`sum(${taskAllocations.hours}) > ${projects.budgetHours}`);
        out.projects = {
          overBudget: over.length,
          active: active.length,
          endingSoon: active.filter(
            (p) => p.endDate !== null && p.endDate >= today && p.endDate <= limit,
          ).length,
        };
      }
      if (hasPermission(access.permissions, 'tasks.task.read', 'own')) {
        const today = kuwaitToday(now);
        const open = inArray(tasks.status, ['backlog', 'ready', 'in_progress', 'in_review']);
        const overdue = and(open, lt(tasks.dueDate, today));
        const mine = sql`exists (select 1 from task_allocations ta where ta.tenant_id = ${tasks.tenantId} and ta.task_id = ${tasks.id} and ta.membership_id = ${access.membershipId})`;
        const [mineOpen] = await tx.select({ n: count() }).from(tasks).where(and(open, mine));
        const [mineOverdue] = await tx.select({ n: count() }).from(tasks).where(and(overdue, mine));
        const [companyOverdue] = may('tasks.task.read')
          ? await tx.select({ n: count() }).from(tasks).where(overdue)
          : [];
        out.tasks = {
          mineOpen: mineOpen?.n ?? 0,
          mineOverdue: mineOverdue?.n ?? 0,
          companyOverdue: companyOverdue ? companyOverdue.n : null,
        };
        // My next open tasks: overdue first, then soonest due (no due date last).
        const next = await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            dueDate: tasks.dueDate,
            projectId: projects.id,
            projectNameEn: projects.nameEn,
            projectNameAr: projects.nameAr,
          })
          .from(tasks)
          .innerJoin(projects, eq(projects.id, tasks.projectId))
          .where(and(inArray(tasks.status, [...OPEN_TASK_STATUSES]), mine))
          .orderBy(
            sql`case when ${tasks.dueDate} < ${today} then 0 else 1 end`,
            sql`${tasks.dueDate} asc nulls last`,
            asc(tasks.id),
          )
          .limit(MY_TASKS_LIMIT);
        out.myTasks = {
          items: next.map((t) => ({ ...t, overdue: t.dueDate !== null && t.dueDate < today })),
        };
      }
      if (hasPermission(access.permissions, 'time.entry.create', 'own')) {
        const weekStart = weekStartOf(kuwaitToday(now));
        const [week] = await tx
          .select({ total: sql<string>`coalesce(sum(${timeEntries.hours}), 0)::text` })
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.membershipId, access.membershipId),
              gte(timeEntries.workDate, weekStart),
              ne(timeEntries.status, 'rejected'),
            ),
          );
        let waitingForMe: number | null = null;
        const approveAll = may('time.timesheet.approve');
        if (approveAll || hasPermission(access.permissions, 'time.timesheet.approve', 'project')) {
          const [waiting] = await tx
            .select({ n: count() })
            .from(timeEntries)
            .innerJoin(projects, eq(projects.id, timeEntries.projectId))
            .where(
              and(
                // Literal, so the partial index time_entries_submitted_idx applies (a parameter would not).
                sql`${timeEntries.status} = 'submitted'`,
                ne(timeEntries.membershipId, access.membershipId),
                approveAll ? undefined : eq(projects.managerMembershipId, access.membershipId),
              ),
            );
          waitingForMe = waiting?.n ?? 0;
        }
        out.time = { thisWeekHours: formatHours(hundredths(week?.total ?? '0')), waitingForMe };
        // My week day by day. Draft, submitted and approved hours count (what I have logged);
        // rejected entries do not — the same rule as thisWeekHours above.
        const weekEnd = addDays(weekStart, 6);
        const perDay = await tx
          .select({
            date: timeEntries.workDate,
            total: sql<string>`coalesce(sum(${timeEntries.hours}), 0)::text`,
          })
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.membershipId, access.membershipId),
              gte(timeEntries.workDate, weekStart),
              lte(timeEntries.workDate, weekEnd),
              ne(timeEntries.status, 'rejected'),
            ),
          )
          .groupBy(timeEntries.workDate);
        const byDate = new Map(perDay.map((d) => [d.date, d.total]));
        const [me] = await tx
          .select({ weeklyHours: employees.weeklyHours })
          .from(employees)
          .where(eq(employees.membershipId, access.membershipId));
        out.myWeek = {
          weekStart,
          days: Array.from({ length: 7 }, (_, i) => {
            const date = addDays(weekStart, i);
            return { date, hours: formatHours(hundredths(byDate.get(date) ?? '0')) };
          }),
          weeklyTarget: me ? formatHours(hundredths(me.weeklyHours)) : null,
        };
      }
      if (hasPermission(access.permissions, 'leave.request.create', 'own')) {
        out.leave = await this.leave.dashboard(tx, access);
      }
      // Project health: Owner/CEO (company-wide manage) and Finance (company-wide read without
      // manage) see every open project; project managers see the projects they lead or are on
      // (their dashboard is about their own work, although they may read all projects); team
      // leads and employees get no section (their tasks and week cover their work).
      const projectManager = hasPermission(
        access.permissions,
        'projects.project.manage',
        'project',
      );
      const allProjects =
        may('projects.project.manage') || (may('projects.project.read') && !projectManager);
      if (allProjects || projectManager) {
        out.projectHealth = { items: await this.projectHealth(tx, access, !allProjects) };
      }
      const awayFrom = kuwaitToday(now);
      const away = await this.leave.upcomingAway(
        tx,
        access,
        awayFrom,
        addDays(awayFrom, AWAY_DAYS_AHEAD),
        AWAY_LIMIT,
      );
      if (may('billing.invoice.read')) {
        out.billing = await this.billing.dashboard(tx);
      }
      if (hasPermission(access.permissions, 'expenses.claim.create', 'own')) {
        out.expenses = await this.expenses.dashboard(tx, access);
      }
      if (hasPermission(access.permissions, 'attendance.read', 'team')) {
        out.attendance = await this.attendance.dashboard(tx, access);
      }
      let activity: (typeof auditEvents.$inferSelect)[] | undefined;
      if (may('audit.event.read')) {
        activity = await tx
          .select()
          .from(auditEvents)
          .where(inArray(auditEvents.action, [...ACTIVITY_ACTIONS]))
          .orderBy(desc(auditEvents.id))
          .limit(ACTIVITY_LIMIT);
      }
      return { out, activity, away };
    });

    if (result.away) {
      const userIds = [...new Set(result.away.map((a) => a.userId))];
      const names = new Map(
        (await this.identity.userSummaries(userIds)).map((u) => [u.id, u.name]),
      );
      result.out.away = {
        items: result.away.map((a) => ({
          membershipId: a.membershipId,
          name: names.get(a.userId) ?? '',
          startDate: a.startDate,
          endDate: a.endDate,
          leaveTypeEn: a.leaveTypeEn,
          leaveTypeAr: a.leaveTypeAr,
        })),
      };
    }

    if (result.activity) {
      const actorIds = [
        ...new Set(result.activity.flatMap((e) => (e.actorUserId ? [e.actorUserId] : []))),
      ];
      const names = new Map(
        (await this.identity.userSummaries(actorIds)).map((u) => [u.id, u.name]),
      );
      result.out.activity = {
        items: result.activity.map((e): ActivityItem => ({
          id: e.id,
          action: e.action as ActivityItem['action'],
          occurredAt: e.occurredAt.toISOString(),
          actorName: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
        })),
      };
    }
    return result.out;
  }

  /**
   * Open projects with their hours: logged = approved time, allocated = allocations on tasks
   * that are not cancelled. Most of the budget used first; projects without a budget last.
   */
  private async projectHealth(tx: TenantTransaction, access: AccessContext, ownOnly: boolean) {
    const logged = tx
      .select({
        projectId: timeEntries.projectId,
        hours: sql<string>`sum(${timeEntries.hours})`.as('logged_hours'),
      })
      .from(timeEntries)
      .where(eq(timeEntries.status, 'approved'))
      .groupBy(timeEntries.projectId)
      .as('logged');
    const allocated = tx
      .select({
        projectId: taskAllocations.projectId,
        hours: sql<string>`sum(${taskAllocations.hours})`.as('allocated_hours'),
      })
      .from(taskAllocations)
      .innerJoin(tasks, eq(tasks.id, taskAllocations.taskId))
      .where(ne(tasks.status, 'cancelled'))
      .groupBy(taskAllocations.projectId)
      .as('allocated');
    const loggedHours = sql`coalesce(${logged.hours}, 0)`;
    const rows = await tx
      .select({
        id: projects.id,
        nameEn: projects.nameEn,
        nameAr: projects.nameAr,
        clientNameEn: clients.legalNameEn,
        clientNameAr: clients.legalNameAr,
        budgetHours: projects.budgetHours,
        loggedHours: sql<string>`(${loggedHours})::text`,
        allocatedHours: sql<string>`coalesce(${allocated.hours}, 0)::text`,
        endDate: projects.endDate,
      })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(logged, eq(logged.projectId, projects.id))
      .leftJoin(allocated, eq(allocated.projectId, projects.id))
      .where(
        and(
          inArray(projects.status, ['planned', 'active', 'on_hold']),
          isNull(projects.archivedAt),
          ownOnly ? onProjectTeam(access.membershipId) : undefined,
        ),
      )
      .orderBy(
        sql`case when ${projects.budgetHours} > 0 then (${loggedHours}) / ${projects.budgetHours} end desc nulls last`,
        asc(projects.nameEn),
        asc(projects.id),
      )
      .limit(PROJECT_HEALTH_LIMIT);
    return rows.map((r) => ({
      ...r,
      budgetHours: hundredths(r.budgetHours) > 0n ? formatHours(hundredths(r.budgetHours)) : null,
      loggedHours: formatHours(hundredths(r.loggedHours)),
      allocatedHours: formatHours(hundredths(r.allocatedHours)),
    }));
  }
}

@Controller('dashboard')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiContract({
    summary: 'Dashboard numbers I may see (sections depend on my permissions)',
    auth: 'member',
    companyHost: true,
    response: dashboardSummarySchema,
  })
  summary(@CurrentAccess() access: AccessContext) {
    return this.dashboard.summary(access);
  }
}

@Module({
  imports: [
    AccessModule,
    IdentityModule,
    LeaveModule,
    AttendanceModule,
    BillingModule,
    ExpensesModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
