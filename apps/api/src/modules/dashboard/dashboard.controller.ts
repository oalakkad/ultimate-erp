import { Controller, Get, Injectable, Module, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ACTIVITY_ACTIONS,
  type ActivityItem,
  type DashboardSummary,
  dashboardSummarySchema,
  hasPermission,
  type Permission,
} from '@ultimate-erp/contracts';
import {
  auditEvents,
  clients,
  contracts,
  invitations,
  memberships,
  projects,
  taskAllocations,
  tasks,
  timeEntries,
} from '@ultimate-erp/db';
import { and, count, desc, eq, gt, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { formatHours, hundredths } from '../projects/projects.service.js';
import { weekStartOf } from '../time/time.service.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { type AccessContext, CurrentAccess } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IdentityService } from '../identity/identity.service.js';

const ACTIVITY_LIMIT = 8;

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
                eq(timeEntries.status, 'submitted'),
                ne(timeEntries.membershipId, access.membershipId),
                approveAll ? undefined : eq(projects.managerMembershipId, access.membershipId),
              ),
            );
          waitingForMe = waiting?.n ?? 0;
        }
        out.time = { thisWeekHours: formatHours(hundredths(week?.total ?? '0')), waitingForMe };
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
      return { out, activity };
    });

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
  imports: [AccessModule, IdentityModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
