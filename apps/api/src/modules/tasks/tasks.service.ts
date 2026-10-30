import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type allocationPreviewRequestSchema,
  type createTaskRequestSchema,
  hasPermission,
  OPEN_TASK_STATUSES,
  type Permission,
  type Task,
  TASK_ACTIVITY_ACTIONS,
  TASK_TRANSITIONS,
  type taskListQuerySchema,
  type TaskStatus,
  type TaskSummary,
  type updateTaskRequestSchema,
} from '@ultimate-erp/contracts';
import {
  auditEvents,
  clients,
  files,
  memberships,
  projectMembers,
  projects,
  taskAllocations,
  taskComments,
  taskDependencies,
  taskDocuments,
  tasks,
  timeEntries,
  type TenantTransaction,
} from '@ultimate-erp/db';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { type Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Job } from 'pg-boss';
import { type z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { nextDocumentNumber } from '../../platform/database/numbering.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { DOWNLOAD_URL_SECONDS, ObjectStorage } from '../../platform/files/object-storage.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { formatHours, hundredths } from '../projects/projects.service.js';

type TaskRow = typeof tasks.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type Allocation = { membershipId: string; hours: string };
type Override = { override?: boolean | undefined; overrideReason?: string | undefined };

const OPEN = [...OPEN_TASK_STATUSES];
const CLOSED_PROJECT = ['completed', 'cancelled'];

const notFound = () => new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
const forbidden = () => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, messageFor('FORBIDDEN'));
const invalid = (path: string, code: string) =>
  new AppError(
    'VALIDATION_FAILED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    messageFor('VALIDATION_FAILED'),
    [{ path, code }],
  );
const conflict = (path: string, code: string, message: string) =>
  new AppError('CONFLICT', HttpStatus.CONFLICT, message, [{ path, code }]);
const sumHours = (list: readonly { hours: string }[]) =>
  list.reduce((total, a) => total + hundredths(a.hours), 0n);

/** Tasks & hour allocation (docs/modules/tasks.md). */
@Injectable()
export class TasksService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly identity: IdentityService,
    private readonly storage: ObjectStorage,
  ) {}

  // --- access ----------------------------------------------------------------------------------

  private async onProject(tx: TenantTransaction, access: AccessContext, project: ProjectRow) {
    if (project.managerMembershipId === access.membershipId) return true;
    const [row] = await tx
      .select({ id: projectMembers.membershipId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.membershipId, access.membershipId),
        ),
      );
    return row !== undefined;
  }

  private async assignedTo(tx: TenantTransaction, access: AccessContext, taskId: string) {
    const [row] = await tx
      .select({ id: taskAllocations.membershipId })
      .from(taskAllocations)
      .where(
        and(
          eq(taskAllocations.taskId, taskId),
          eq(taskAllocations.membershipId, access.membershipId),
        ),
      );
    return row !== undefined;
  }

  /** Company scope; project scope on a project I work on; own scope on a task I'm assigned to. */
  private async may(
    tx: TenantTransaction,
    access: AccessContext,
    permission: Permission,
    project: ProjectRow,
    taskId?: string,
  ) {
    const has = (scope: 'company' | 'project' | 'own') =>
      hasPermission(access.permissions, permission, scope);
    if (has('company')) return true;
    if (has('project') && (await this.onProject(tx, access, project))) return true;
    return taskId !== undefined && has('own') && (await this.assignedTo(tx, access, taskId));
  }

  private async load(tx: TenantTransaction, access: AccessContext, id: string, lock = false) {
    const query = tx
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, id));
    const [row] = lock ? await query.for('update', { of: tasks }) : await query;
    if (!row || !(await this.may(tx, access, 'tasks.task.read', row.project, row.task.id)))
      throw notFound();
    return row;
  }

  private async require(
    tx: TenantTransaction,
    access: AccessContext,
    permission: Permission,
    project: ProjectRow,
    taskId?: string,
  ) {
    if (!(await this.may(tx, access, permission, project, taskId))) throw forbidden();
  }

  private assertProjectOpen(project: ProjectRow) {
    if (CLOSED_PROJECT.includes(project.status)) {
      throw conflict(
        'projectId',
        'project_closed',
        'Tasks of a completed or cancelled project cannot change.',
      );
    }
  }

  // --- list / read -------------------------------------------------------------------------------

  async list(access: AccessContext, query: z.output<typeof taskListQuerySchema>) {
    const today = kuwaitToday();
    const me = access.membershipId;
    const assignedTo = (membershipId: string) =>
      sql`exists (select 1 from task_allocations ta where ta.tenant_id = ${tasks.tenantId} and ta.task_id = ${tasks.id} and ta.membership_id = ${membershipId})`;
    const conditions: (SQL | undefined)[] = [
      query.projectId ? eq(tasks.projectId, query.projectId) : undefined,
      query.clientId ? eq(projects.clientId, query.clientId) : undefined,
      query.status ? eq(tasks.status, query.status) : undefined,
      query.state === 'open' ? inArray(tasks.status, OPEN) : undefined,
      query.state === 'closed' ? notInArray(tasks.status, OPEN) : undefined,
      query.priority ? eq(tasks.priority, query.priority) : undefined,
      query.assignee ? assignedTo(query.assignee === 'me' ? me : query.assignee) : undefined,
      query.overdue === 'true'
        ? and(inArray(tasks.status, OPEN), lt(tasks.dueDate, today))
        : undefined,
      query.cursor ? lt(tasks.id, query.cursor) : undefined,
    ];
    const has = (scope: 'company' | 'project' | 'own') =>
      hasPermission(access.permissions, 'tasks.task.read', scope);
    if (!has('company')) {
      const visible: SQL[] = [];
      if (has('project')) {
        visible.push(
          eq(projects.managerMembershipId, me),
          sql`exists (select 1 from project_members pm where pm.tenant_id = ${projects.tenantId} and pm.project_id = ${projects.id} and pm.membership_id = ${me})`,
        );
      }
      if (has('own')) visible.push(assignedTo(me));
      conditions.push(visible.length > 0 ? or(...visible) : sql`false`);
    }
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        or(
          ilike(tasks.number, pattern),
          ilike(tasks.title, pattern),
          ilike(projects.nameEn, pattern),
          ilike(projects.nameAr, pattern),
        ),
      );
    }
    const { rows, allocations } = await this.database.withTenant(access.tenantId, async (tx) => {
      const found = await tx
        .select({ task: tasks, project: projects, client: clients })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .where(and(...conditions))
        .orderBy(desc(tasks.id))
        .limit(query.limit + 1);
      const ids = found.slice(0, query.limit).map((r) => r.task.id);
      return { rows: found, allocations: await this.allocationsOf(tx, ids) };
    });
    const page = rows.slice(0, query.limit);
    const names = await this.memberNames(access, [
      ...new Set([...allocations.values()].flat().map((a) => a.membershipId)),
    ]);
    return {
      items: page.map((r) =>
        this.toSummary(r.task, r.project, r.client, allocations.get(r.task.id) ?? [], names, today),
      ),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.task.id ?? null) : null,
    };
  }

  async get(access: AccessContext, id: string): Promise<Task> {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const { task, project } = await this.load(tx, access, id);
      return this.toTask(tx, access, task, project);
    });
  }

  // --- create / update / status ------------------------------------------------------------------

  /** Workflow steps 9–11: validate, save task + allocations atomically, notify (docs/modules/tasks.md §2). */
  async create(
    req: Request,
    access: AccessContext,
    input: z.output<typeof createTaskRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      // The project row lock serialises allocations on one project (concurrency-safe budget check).
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .for('update');
      if (!project || !(await this.may(tx, access, 'tasks.task.read', project)))
        throw invalid('projectId', 'not_found');
      await this.require(tx, access, 'tasks.task.manage', project);
      this.assertProjectOpen(project);
      const allocations = input.allocations ?? [];
      if (allocations.length > 0)
        await this.require(tx, access, 'tasks.allocation.manage', project);
      const number = await nextDocumentNumber(tx, access.tenantId, 'task', 'T');
      const [task] = await tx
        .insert(tasks)
        .values({
          tenantId: access.tenantId,
          projectId: project.id,
          number,
          title: input.title,
          description: input.description ?? null,
          status: input.status ?? 'backlog',
          priority: input.priority ?? 'normal',
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimatedHours: input.estimatedHours ?? null,
          createdByUserId: access.userId,
        })
        .returning();
      if (!task) throw new Error('task insert returned nothing');
      await this.record(tx, req, access, task.id, 'tasks.task.created', {
        number,
        projectId: project.id,
      });
      if (allocations.length > 0)
        await this.writeAllocations(tx, req, access, project, task, allocations, input);
      return this.toTask(tx, access, task, project);
    });
  }

  async update(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof updateTaskRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const { task, project } = await this.load(tx, access, id, true);
      await this.require(tx, access, 'tasks.task.manage', project, id);
      this.assertProjectOpen(project);
      if (task.status === 'cancelled')
        throw conflict('status', 'closed', 'A cancelled task cannot be changed.');
      if (task.version !== input.version)
        throw conflict('version', 'stale', 'The task was changed by someone else.');
      const changes = Object.fromEntries(
        Object.entries(input).filter(([k, v]) => k !== 'version' && v !== undefined),
      );
      const merged = { ...task, ...changes };
      if (merged.startDate && merged.dueDate && merged.dueDate < merged.startDate)
        throw invalid('dueDate', 'before_start');
      const [row] = await tx
        .update(tasks)
        .set({
          ...changes,
          // A new due date re-arms the overdue alert.
          ...(input.dueDate !== undefined && input.dueDate !== task.dueDate
            ? { overdueNotifiedOn: null }
            : {}),
          version: task.version + 1,
        })
        .where(eq(tasks.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, id, 'tasks.task.updated', {
        fields: Object.keys(changes),
      });
      return this.toTask(tx, access, row, project);
    });
  }

  async setStatus(req: Request, access: AccessContext, id: string, status: TaskStatus) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const { task, project } = await this.load(tx, access, id, true);
      this.assertProjectOpen(project);
      const allowed = await this.nextStatuses(tx, access, task, project);
      if (!allowed.includes(status)) {
        if (!TASK_TRANSITIONS[task.status].includes(status)) {
          throw conflict(
            'status',
            'invalid_transition',
            `A ${task.status} task cannot become ${status}.`,
          );
        }
        if (status === 'in_progress' && (await this.openBlockers(tx, id)).length > 0) {
          throw conflict('status', 'blocked', 'A task it depends on is not finished yet.');
        }
        throw forbidden();
      }
      const [row] = await tx
        .update(tasks)
        .set({
          status,
          completedAt: status === 'completed' ? new Date() : null,
          version: task.version + 1,
        })
        .where(eq(tasks.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, id, 'tasks.task.status_changed', {
        from: task.status,
        to: status,
      });
      return this.toTask(tx, access, row, project);
    });
  }

  /** What this person may move the task to now (blocked tasks cannot start). */
  private async nextStatuses(
    tx: TenantTransaction,
    access: AccessContext,
    task: TaskRow,
    project: ProjectRow,
  ) {
    if (CLOSED_PROJECT.includes(project.status)) return [];
    const manage = await this.may(tx, access, 'tasks.task.manage', project, task.id);
    const work = manage || (await this.may(tx, access, 'tasks.task.work', project, task.id));
    if (!work) return [];
    const blocked = (await this.openBlockers(tx, task.id)).length > 0;
    return TASK_TRANSITIONS[task.status].filter((s) => {
      if (s === 'in_progress' && blocked && task.status !== 'completed') return false;
      // Cancelling and reopening are decisions for whoever manages the task.
      if (s === 'cancelled' || task.status === 'completed') return manage;
      return true;
    });
  }

  private async openBlockers(tx: TenantTransaction, taskId: string) {
    return tx
      .select({ id: tasks.id })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
      .where(and(eq(taskDependencies.taskId, taskId), inArray(tasks.status, OPEN)));
  }

  // --- allocations -------------------------------------------------------------------------------

  async setAllocations(
    req: Request,
    access: AccessContext,
    id: string,
    input: { allocations: Allocation[] } & Override,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const { task } = await this.load(tx, access, id);
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .for('update');
      if (!project) throw notFound();
      await this.require(tx, access, 'tasks.allocation.manage', project, id);
      this.assertProjectOpen(project);
      if (!OPEN.includes(task.status)) {
        throw conflict('status', 'closed', 'Hours can only be allocated on open tasks.');
      }
      await this.writeAllocations(tx, req, access, project, task, input.allocations, input);
      return this.toTask(tx, access, task, project);
    });
  }

  /**
   * Replaces a task's allocations inside the caller's transaction, after the project row was
   * locked. Refuses people who are not on the team and totals above the budget unless an
   * authorised override with a reason is given (docs/modules/tasks.md §8).
   */
  private async writeAllocations(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    project: ProjectRow,
    task: TaskRow,
    wanted: Allocation[],
    override: Override,
  ) {
    const team = await this.teamOf(tx, project.id);
    const outsider = wanted.find((a) => !team.has(a.membershipId));
    if (outsider) throw invalid('allocations', 'not_on_team');
    const elsewhere = await this.allocatedOnProject(tx, project.id, task.id);
    const total = elsewhere + sumHours(wanted);
    const budget = hundredths(project.budgetHours);
    const over = total > budget;
    if (over) {
      if (!override.override) {
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'This allocation is more than the hours left in the budget.',
          [{ path: 'allocations', code: 'over_budget' }],
        );
      }
      if (!(await this.may(tx, access, 'projects.budget.override', project))) throw forbidden();
      if (!override.overrideReason) throw invalid('overrideReason', 'required');
    }

    const current = await tx
      .select()
      .from(taskAllocations)
      .where(eq(taskAllocations.taskId, task.id));
    const before = new Map(current.map((a) => [a.membershipId, a.hours]));
    const removed = current
      .filter((a) => !wanted.some((w) => w.membershipId === a.membershipId))
      .map((a) => a.membershipId);
    if (removed.length > 0) {
      // Someone who logged time on the task stays on it (their time refers to the allocation).
      const [logged] = await tx
        .select({ id: timeEntries.id })
        .from(timeEntries)
        .where(and(eq(timeEntries.taskId, task.id), inArray(timeEntries.membershipId, removed)))
        .limit(1);
      if (logged) {
        throw conflict(
          'allocations',
          'has_time',
          'Someone you removed has already logged time on this task.',
        );
      }
      await tx
        .delete(taskAllocations)
        .where(
          and(eq(taskAllocations.taskId, task.id), inArray(taskAllocations.membershipId, removed)),
        );
    }
    for (const a of wanted) {
      if (!before.has(a.membershipId)) {
        await tx.insert(taskAllocations).values({
          tenantId: task.tenantId,
          taskId: task.id,
          projectId: project.id,
          membershipId: a.membershipId,
          hours: a.hours,
          allocatedByUserId: access.userId,
        });
      } else if (hundredths(before.get(a.membershipId) ?? '0') !== hundredths(a.hours)) {
        await tx
          .update(taskAllocations)
          .set({ hours: a.hours, allocatedByUserId: access.userId })
          .where(
            and(
              eq(taskAllocations.taskId, task.id),
              eq(taskAllocations.membershipId, a.membershipId),
            ),
          );
      }
    }
    const added = wanted.filter((a) => !before.has(a.membershipId)).map((a) => a.membershipId);
    await this.record(tx, req, access, task.id, 'tasks.allocation.changed', {
      from: formatHours(sumHours(current)),
      to: formatHours(sumHours(wanted)),
      people: wanted.length,
    });
    if (over) {
      await this.record(tx, req, access, task.id, 'tasks.allocation.override', {
        reason: override.overrideReason,
        budget: formatHours(budget),
        allocated: formatHours(total),
      });
    }
    if (added.length > 0) {
      const people = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(inArray(memberships.id, added));
      await this.notifier.notify(tx, req, {
        tenantId: task.tenantId,
        type: 'tasks.assigned',
        recipients: people.map((p) => p.userId).filter((u) => u !== access.userId),
        params: { number: task.number, title: task.title },
        link: `/tasks/${task.id}`,
        actor: { userId: access.userId, membershipId: access.membershipId },
      });
    }
  }

  /** Workflow steps 7–8: effect on the project's remaining hours and on each person's workload. */
  async preview(access: AccessContext, input: z.output<typeof allocationPreviewRequestSchema>) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId));
      if (!project || !(await this.may(tx, access, 'tasks.task.read', project)))
        throw invalid('projectId', 'not_found');
      await this.require(tx, access, 'tasks.allocation.manage', project);
      if (input.taskId) {
        const [own] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, project.id)));
        if (!own) throw invalid('taskId', 'not_found');
      }
      const budgeted = hundredths(project.budgetHours);
      const elsewhere = await this.allocatedOnProject(tx, project.id, input.taskId);
      const thisTask = sumHours(input.allocations);
      const team = await this.teamOf(tx, project.id);
      const workload = await this.openWorkload(
        tx,
        input.allocations.map((a) => a.membershipId),
        input.taskId,
      );
      const names = await this.memberNames(
        access,
        input.allocations.map((a) => a.membershipId),
        tx,
      );
      return {
        budgeted: formatHours(budgeted),
        allocatedElsewhere: formatHours(elsewhere),
        thisTask: formatHours(thisTask),
        remainingAfter: formatHours(budgeted - elsewhere - thisTask),
        overBudget: elsewhere + thisTask > budgeted,
        canOverride: await this.may(tx, access, 'projects.budget.override', project),
        people: input.allocations.map((a) => ({
          membershipId: a.membershipId,
          name: names.get(a.membershipId) ?? '',
          hours: formatHours(hundredths(a.hours)),
          openWorkload: formatHours(workload.get(a.membershipId) ?? 0n),
          onTeam: team.has(a.membershipId),
        })),
      };
    });
  }

  /** Per person: open tasks, allocated hours on them and overdue ones (all projects). */
  async workload(access: AccessContext, projectId?: string) {
    const today = kuwaitToday();
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      let people: string[];
      if (projectId) {
        const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
        if (!project || !(await this.may(tx, access, 'tasks.task.read', project))) throw notFound();
        await this.require(tx, access, 'tasks.allocation.manage', project);
        people = [...(await this.teamOf(tx, projectId))];
      } else {
        if (!hasPermission(access.permissions, 'tasks.task.read', 'company')) throw forbidden();
        people = (
          await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(eq(memberships.status, 'active'))
        ).map((m) => m.id);
      }
      if (people.length === 0) return [];
      return tx
        .select({
          membershipId: taskAllocations.membershipId,
          openTasks: sql<number>`count(*)::int`,
          openHours: sql<string>`coalesce(sum(${taskAllocations.hours}), 0)::text`,
          overdueTasks: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today})::int`,
        })
        .from(taskAllocations)
        .innerJoin(tasks, eq(tasks.id, taskAllocations.taskId))
        .where(and(inArray(taskAllocations.membershipId, people), inArray(tasks.status, OPEN)))
        .groupBy(taskAllocations.membershipId)
        .then((found) =>
          people.map(
            (id) =>
              found.find((f) => f.membershipId === id) ?? {
                membershipId: id,
                openTasks: 0,
                openHours: '0',
                overdueTasks: 0,
              },
          ),
        );
    });
    const names = await this.memberNames(
      access,
      rows.map((r) => r.membershipId),
    );
    return {
      items: rows
        .filter((r) => names.has(r.membershipId))
        .map((r) => ({
          membershipId: r.membershipId,
          name: names.get(r.membershipId) ?? '',
          openTasks: r.openTasks,
          openHours: formatHours(hundredths(r.openHours)),
          overdueTasks: r.overdueTasks,
        }))
        .sort(
          (a, b) =>
            Number(hundredths(b.openHours) - hundredths(a.openHours)) ||
            a.name.localeCompare(b.name),
        ),
    };
  }

  /** Allocated hours on the project's tasks that are not cancelled (optionally excluding one task). */
  private async allocatedOnProject(
    tx: TenantTransaction,
    projectId: string,
    exceptTaskId?: string,
  ) {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${taskAllocations.hours}), 0)::text` })
      .from(taskAllocations)
      .innerJoin(tasks, eq(tasks.id, taskAllocations.taskId))
      .where(
        and(
          eq(taskAllocations.projectId, projectId),
          ne(tasks.status, 'cancelled'),
          exceptTaskId ? ne(tasks.id, exceptTaskId) : undefined,
        ),
      );
    return hundredths(row?.total ?? '0');
  }

  private async openWorkload(
    tx: TenantTransaction,
    membershipIds: string[],
    exceptTaskId?: string,
  ) {
    if (membershipIds.length === 0) return new Map<string, bigint>();
    const rows = await tx
      .select({
        membershipId: taskAllocations.membershipId,
        total: sql<string>`sum(${taskAllocations.hours})::text`,
      })
      .from(taskAllocations)
      .innerJoin(tasks, eq(tasks.id, taskAllocations.taskId))
      .where(
        and(
          inArray(taskAllocations.membershipId, membershipIds),
          inArray(tasks.status, OPEN),
          exceptTaskId ? ne(tasks.id, exceptTaskId) : undefined,
        ),
      )
      .groupBy(taskAllocations.membershipId);
    return new Map(rows.map((r) => [r.membershipId, hundredths(r.total)]));
  }

  private async teamOf(tx: TenantTransaction, projectId: string) {
    const rows = await tx
      .select({ id: projectMembers.membershipId })
      .from(projectMembers)
      .innerJoin(memberships, eq(memberships.id, projectMembers.membershipId))
      .where(and(eq(projectMembers.projectId, projectId), eq(memberships.status, 'active')));
    return new Set(rows.map((r) => r.id));
  }

  // --- dependencies --------------------------------------------------------------------------------

  async setDependencies(req: Request, access: AccessContext, id: string, blockedBy: string[]) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const { task, project } = await this.load(tx, access, id, true);
      await this.require(tx, access, 'tasks.task.manage', project, id);
      this.assertProjectOpen(project);
      const wanted = [...new Set(blockedBy)];
      if (wanted.includes(id)) throw invalid('blockedBy', 'self');
      if (wanted.length > 0) {
        const same = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(inArray(tasks.id, wanted), eq(tasks.projectId, project.id)));
        if (same.length !== wanted.length) throw invalid('blockedBy', 'other_project');
        if (await this.wouldCycle(tx, id, wanted))
          throw conflict('blockedBy', 'cycle', 'These dependencies would form a loop.');
      }
      await tx.delete(taskDependencies).where(eq(taskDependencies.taskId, id));
      if (wanted.length > 0) {
        await tx.insert(taskDependencies).values(
          wanted.map((blockedByTaskId) => ({
            tenantId: access.tenantId,
            projectId: project.id,
            taskId: id,
            blockedByTaskId,
          })),
        );
      }
      await this.record(tx, req, access, id, 'tasks.dependency.changed', { count: wanted.length });
      return this.toTask(tx, access, task, project);
    });
  }

  /** Would "id is blocked by `blockers`" close a loop? (walks what the blockers depend on) */
  private async wouldCycle(tx: TenantTransaction, id: string, blockers: string[]) {
    const seen = new Set<string>();
    let frontier = blockers;
    while (frontier.length > 0) {
      if (frontier.includes(id)) return true;
      frontier.forEach((f) => seen.add(f));
      const next = await tx
        .select({ id: taskDependencies.blockedByTaskId })
        .from(taskDependencies)
        .where(inArray(taskDependencies.taskId, frontier));
      frontier = [...new Set(next.map((n) => n.id))].filter((n) => !seen.has(n));
    }
    return false;
  }

  // --- comments, documents, activity -------------------------------------------------------------

  async comments(access: AccessContext, id: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, id);
      return tx
        .select()
        .from(taskComments)
        .where(eq(taskComments.taskId, id))
        .orderBy(asc(taskComments.id));
    });
    const names = await this.userNames(rows.map((r) => r.authorUserId));
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      authorName: names.get(r.authorUserId) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addComment(req: Request, access: AccessContext, id: string, body: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      const { project } = await this.load(tx, access, id);
      await this.require(tx, access, 'tasks.task.work', project, id);
      const [row] = await tx
        .insert(taskComments)
        .values({ tenantId: access.tenantId, taskId: id, authorUserId: access.userId, body })
        .returning({ id: taskComments.id });
      await this.record(tx, req, access, id, 'tasks.comment.added', { commentId: row?.id });
    });
    return this.comments(access, id);
  }

  async documents(access: AccessContext, id: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, id);
      return tx
        .select({ link: taskDocuments, file: files })
        .from(taskDocuments)
        .innerJoin(files, eq(files.id, taskDocuments.fileId))
        .where(eq(taskDocuments.taskId, id))
        .orderBy(desc(taskDocuments.createdAt));
    });
    const names = await this.userNames(rows.map((r) => r.link.addedByUserId));
    return rows.map(({ link, file }) => ({
      file: {
        id: file.id,
        name: file.displayName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        status: file.status,
        createdAt: file.createdAt.toISOString(),
      },
      addedAt: link.createdAt.toISOString(),
      addedByName: names.get(link.addedByUserId) ?? null,
    }));
  }

  async attachDocument(req: Request, access: AccessContext, id: string, fileId: string) {
    try {
      await this.database.withTenant(access.tenantId, async (tx) => {
        const { project } = await this.load(tx, access, id);
        await this.require(tx, access, 'tasks.task.work', project, id);
        const [file] = await tx
          .select({ status: files.status })
          .from(files)
          .where(and(eq(files.id, fileId), eq(files.uploadedByUserId, access.userId)));
        if (!file) throw invalid('fileId', 'not_found');
        if (file.status === 'infected') throw invalid('fileId', 'infected');
        await tx
          .insert(taskDocuments)
          .values({ tenantId: access.tenantId, taskId: id, fileId, addedByUserId: access.userId });
        await this.record(tx, req, access, id, 'tasks.document.attached', { fileId });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('fileId', 'already_attached', 'This file is already attached.');
      throw err;
    }
    return this.documents(access, id);
  }

  async detachDocument(req: Request, access: AccessContext, id: string, fileId: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      const { project } = await this.load(tx, access, id);
      await this.require(tx, access, 'tasks.task.work', project, id);
      const removed = await tx
        .delete(taskDocuments)
        .where(and(eq(taskDocuments.taskId, id), eq(taskDocuments.fileId, fileId)))
        .returning({ fileId: taskDocuments.fileId });
      if (removed.length === 0) throw notFound();
      await this.record(tx, req, access, id, 'tasks.document.detached', { fileId });
    });
  }

  async documentDownload(req: Request, access: AccessContext, id: string, fileId: string) {
    const file = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, id);
      const [row] = await tx
        .select({ file: files })
        .from(taskDocuments)
        .innerJoin(files, eq(files.id, taskDocuments.fileId))
        .where(and(eq(taskDocuments.taskId, id), eq(taskDocuments.fileId, fileId)));
      if (!row) throw notFound();
      if (row.file.status !== 'clean')
        throw new AppError('FILE_NOT_READY', HttpStatus.CONFLICT, messageFor('FILE_NOT_READY'));
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'files.file.downloaded',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'file', id: fileId },
        details: { taskId: id },
      });
      return row.file;
    });
    const url = await this.storage.downloadUrl(file.storageKey, file.displayName, file.contentType);
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  async activity(access: AccessContext, id: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, id);
      return tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetType, 'task'),
            eq(auditEvents.targetId, id),
            inArray(auditEvents.action, [...TASK_ACTIVITY_ACTIONS]),
          ),
        )
        .orderBy(desc(auditEvents.id))
        .limit(50);
    });
    const names = await this.userNames(rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])));
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      items: rows.map((r) => {
        const details = r.details as { fields?: unknown; from?: unknown; to?: unknown };
        return {
          id: r.id,
          action: r.action as (typeof TASK_ACTIVITY_ACTIONS)[number],
          occurredAt: r.occurredAt.toISOString(),
          actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
          fields: Array.isArray(details.fields)
            ? details.fields.filter((f): f is string => typeof f === 'string')
            : [],
          from: text(details.from),
          to: text(details.to),
        };
      }),
    };
  }

  // --- mapping -----------------------------------------------------------------------------------

  private async allocationsOf(tx: TenantTransaction, taskIds: string[]) {
    const out = new Map<string, Allocation[]>();
    if (taskIds.length === 0) return out;
    const rows = await tx
      .select({
        taskId: taskAllocations.taskId,
        membershipId: taskAllocations.membershipId,
        hours: taskAllocations.hours,
      })
      .from(taskAllocations)
      .where(inArray(taskAllocations.taskId, taskIds));
    for (const r of rows)
      out.set(r.taskId, [
        ...(out.get(r.taskId) ?? []),
        { membershipId: r.membershipId, hours: r.hours },
      ]);
    return out;
  }

  private toSummary(
    task: TaskRow,
    project: ProjectRow,
    client: typeof clients.$inferSelect,
    allocations: Allocation[],
    names: Map<string, string>,
    today: string,
  ): TaskSummary {
    return {
      id: task.id,
      number: task.number,
      title: task.title,
      status: task.status,
      priority: task.priority,
      project: {
        id: project.id,
        number: project.number,
        name: { en: project.nameEn, ar: project.nameAr },
      },
      client: { id: client.id, name: { en: client.legalNameEn, ar: client.legalNameAr } },
      startDate: task.startDate,
      dueDate: task.dueDate,
      overdue: OPEN.includes(task.status) && task.dueDate !== null && task.dueDate < today,
      allocations: allocations
        .map((a) => ({
          membershipId: a.membershipId,
          name: names.get(a.membershipId) ?? '',
          hours: formatHours(hundredths(a.hours)),
        }))
        .filter((a) => a.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
      allocatedHours: formatHours(sumHours(allocations)),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private async toTask(
    tx: TenantTransaction,
    access: AccessContext,
    task: TaskRow,
    project: ProjectRow,
  ): Promise<Task> {
    const [fresh] = await tx.select().from(tasks).where(eq(tasks.id, task.id));
    const row = fresh ?? task;
    const [client] = await tx.select().from(clients).where(eq(clients.id, project.clientId));
    if (!client) throw notFound();
    const allocations = (await this.allocationsOf(tx, [row.id])).get(row.id) ?? [];
    const names = await this.memberNames(
      access,
      allocations.map((a) => a.membershipId),
      tx,
    );
    const blockers = await tx
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
      .where(eq(taskDependencies.taskId, row.id))
      .orderBy(asc(tasks.number));
    const projectOpen = !CLOSED_PROJECT.includes(project.status);
    const taskOpen = OPEN.includes(row.status);
    const manage =
      projectOpen &&
      row.status !== 'cancelled' &&
      (await this.may(tx, access, 'tasks.task.manage', project, row.id));
    const allocate =
      projectOpen &&
      taskOpen &&
      (await this.may(tx, access, 'tasks.allocation.manage', project, row.id));
    const work = projectOpen && (await this.may(tx, access, 'tasks.task.work', project, row.id));
    return {
      ...this.toSummary(row, project, client, allocations, names, kuwaitToday()),
      description: row.description,
      estimatedHours:
        row.estimatedHours === null ? null : formatHours(hundredths(row.estimatedHours)),
      completedAt: row.completedAt?.toISOString() ?? null,
      blockedBy: blockers,
      nextStatuses: await this.nextStatuses(tx, access, row, project),
      actions: [
        ...(manage ? (['edit', 'dependencies'] as const) : []),
        ...(allocate ? (['allocate'] as const) : []),
        ...(work ? (['comment', 'documents'] as const) : []),
      ],
      version: row.version,
    };
  }

  private async memberNames(
    access: AccessContext,
    membershipIds: string[],
    tx?: TenantTransaction,
  ) {
    const unique = [...new Set(membershipIds)];
    if (unique.length === 0) return new Map<string, string>();
    const load = (t: TenantTransaction) =>
      t
        .select({ id: memberships.id, userId: memberships.userId })
        .from(memberships)
        .where(inArray(memberships.id, unique));
    const rows = tx ? await load(tx) : await this.database.withTenant(access.tenantId, load);
    const users = await this.userNames(rows.map((r) => r.userId));
    return new Map(
      rows.flatMap((r) =>
        users.has(r.userId) ? [[r.id, users.get(r.userId) ?? ''] as const] : [],
      ),
    );
  }

  private async userNames(userIds: string[]) {
    return new Map(
      (await this.identity.userSummaries([...new Set(userIds)])).map((u) => [u.id, u.name]),
    );
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    taskId: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target: { type: 'task', id: taskId },
      ...(details ? { details } : {}),
    });
  }
}

/** Daily 08:00 Kuwait: alerts the assignees of tasks that have just become overdue (once each). */
@Injectable()
export class TasksDailyHandler {
  constructor(
    private readonly database: TenantDatabase,
    private readonly notifier: Notifier,
    @InjectPinoLogger(TasksDailyHandler.name) private readonly logger: PinoLogger,
  ) {}

  async handle(job: Pick<Job, 'id'>, now = new Date()): Promise<{ alerted: number }> {
    const today = kuwaitToday(now);
    let alerted = 0;
    for (const tenantId of await this.database.activeTenantIds()) {
      alerted += await this.database.withTenant(tenantId, async (tx) => {
        const due = await tx
          .update(tasks)
          .set({ overdueNotifiedOn: today })
          .where(
            and(
              inArray(tasks.status, OPEN),
              lt(tasks.dueDate, today),
              isNull(tasks.overdueNotifiedOn),
              // Tasks of completed or cancelled projects are frozen: no alerts.
              sql`exists (select 1 from projects p where p.tenant_id = ${tasks.tenantId} and p.id = ${tasks.projectId} and p.status in ('planned', 'active', 'on_hold'))`,
            ),
          )
          .returning();
        for (const task of due) {
          const people = await tx
            .select({ userId: memberships.userId })
            .from(taskAllocations)
            .innerJoin(memberships, eq(memberships.id, taskAllocations.membershipId))
            .where(and(eq(taskAllocations.taskId, task.id), eq(memberships.status, 'active')));
          await this.notifier.notifySystem(tx, job.id, {
            tenantId,
            type: 'tasks.overdue',
            recipients: people.map((p) => p.userId),
            params: { number: task.number, title: task.title, dueDate: task.dueDate ?? '' },
            link: `/tasks/${task.id}`,
          });
        }
        return due.length;
      });
    }
    this.logger.info({ alerted }, 'Daily task check done');
    return { alerted };
  }
}
