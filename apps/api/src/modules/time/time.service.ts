import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type createTimeEntryRequestSchema,
  hasPermission,
  type TimeEntry,
  type Timesheet,
  type TimesheetStatus,
  type updateTimeEntryRequestSchema,
} from '@ultimate-erp/contracts';
import {
  membershipRoles,
  memberships,
  projectMembers,
  projects,
  taskAllocations,
  tasks,
  timeEntries,
  timesheets,
  timeTimers,
  employees,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { and, asc, eq, gte, inArray, lte, ne, type SQL, sql } from 'drizzle-orm';
import { type Request } from 'express';
import { type z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { formatHours, hundredths } from '../projects/projects.service.js';

type EntryRow = typeof timeEntries.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type SheetRow = typeof timesheets.$inferSelect;

const DAY = 86_400_000;
const CLOSED_PROJECT = ['completed', 'cancelled'];
const EDITABLE: TimesheetStatus[] = ['draft', 'rejected'];

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

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** The Sunday that starts the (Kuwait) work week containing `iso`. */
export const weekStartOf = (iso: string) => addDays(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay());
const sum = (rows: readonly { hours: string }[]) =>
  rows.reduce((t, r) => t + hundredths(r.hours), 0n);

/** Timesheets & time tracking (docs/modules/timesheets.md). */
@Injectable()
export class TimeService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly identity: IdentityService,
  ) {}

  // --- access ------------------------------------------------------------------------------------

  /** Owner/CEO anywhere; a Manager on projects they manage. Never one's own time. */
  private mayApprove(access: AccessContext, project: ProjectRow) {
    if (hasPermission(access.permissions, 'time.timesheet.approve', 'company')) return true;
    return (
      hasPermission(access.permissions, 'time.timesheet.approve', 'project') &&
      project.managerMembershipId === access.membershipId
    );
  }

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

  // --- my week -----------------------------------------------------------------------------------

  async myWeek(access: AccessContext, week?: string): Promise<Timesheet> {
    const weekStart = weekStartOf(week ?? kuwaitToday());
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [sheet] = await tx
        .select()
        .from(timesheets)
        .where(
          and(
            eq(timesheets.membershipId, access.membershipId),
            eq(timesheets.weekStart, weekStart),
          ),
        );
      return this.toTimesheet(tx, access, weekStart, sheet);
    });
  }

  async create(
    req: Request,
    access: AccessContext,
    input: z.output<typeof createTimeEntryRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const { project } = await this.assignedTask(tx, access, input.taskId);
      if (input.workDate > kuwaitToday()) throw invalid('workDate', 'future');
      const sheet = await this.sheetFor(tx, access, weekStartOf(input.workDate));
      if (!EDITABLE.includes(sheet.status)) {
        throw conflict(
          'workDate',
          'week_locked',
          'This week has been submitted; it takes no new entries.',
        );
      }
      await this.assertDayTotal(tx, access, input.workDate, input.hours);
      const description = input.description ?? '';
      if (!input.confirmDuplicate) {
        const [same] = await tx
          .select({ id: timeEntries.id })
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.membershipId, access.membershipId),
              eq(timeEntries.taskId, input.taskId),
              eq(timeEntries.workDate, input.workDate),
              eq(timeEntries.hours, input.hours),
              eq(timeEntries.description, description),
              ne(timeEntries.status, 'rejected'),
            ),
          );
        if (same)
          throw conflict('taskId', 'possible_duplicate', 'An identical entry already exists.');
      }
      const [row] = await tx
        .insert(timeEntries)
        .values({
          tenantId: access.tenantId,
          timesheetId: sheet.id,
          membershipId: access.membershipId,
          projectId: project.id,
          taskId: input.taskId,
          workDate: input.workDate,
          hours: input.hours,
          billable: project.billingMethod !== 'non_billable' && (input.billable ?? true),
          description,
        })
        .returning();
      if (!row) throw new Error('time entry insert returned nothing');
      await this.record(tx, req, access, 'time_entry', row.id, 'time.entry.created', {
        hours: row.hours,
        taskId: row.taskId,
      });
      return this.toEntry(tx, access, row);
    });
  }

  async update(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof updateTimeEntryRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const entry = await this.ownEditable(tx, access, id);
      if (entry.version !== input.version)
        throw conflict('version', 'stale', 'The entry was changed elsewhere.');
      const workDate = input.workDate ?? entry.workDate;
      if (weekStartOf(workDate) !== weekStartOf(entry.workDate))
        throw invalid('workDate', 'other_week');
      if (workDate > kuwaitToday()) throw invalid('workDate', 'future');
      const hours = input.hours ?? entry.hours;
      await this.assertDayTotal(tx, access, workDate, hours, id);
      const [project] = await tx.select().from(projects).where(eq(projects.id, entry.projectId));
      if (!project || CLOSED_PROJECT.includes(project.status))
        throw conflict('projectId', 'project_closed', 'The project is closed.');
      const [row] = await tx
        .update(timeEntries)
        .set({
          workDate,
          hours,
          billable: project.billingMethod !== 'non_billable' && (input.billable ?? entry.billable),
          description: input.description ?? entry.description,
          // A corrected entry goes back to draft until the week is submitted again.
          status: 'draft',
          rejectionReason: null,
          decidedByUserId: null,
          decidedAt: null,
          version: entry.version + 1,
        })
        .where(eq(timeEntries.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, 'time_entry', id, 'time.entry.updated', {
        fields: Object.keys(input).filter((k) => k !== 'version'),
      });
      return this.toEntry(tx, access, row);
    });
  }

  async remove(req: Request, access: AccessContext, id: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.ownEditable(tx, access, id);
      await tx.delete(timeEntries).where(eq(timeEntries.id, id));
      await this.record(tx, req, access, 'time_entry', id, 'time.entry.deleted');
    });
  }

  async submit(req: Request, access: AccessContext, timesheetId: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [sheet] = await tx
        .select()
        .from(timesheets)
        .where(eq(timesheets.id, timesheetId))
        .for('update');
      if (!sheet || sheet.membershipId !== access.membershipId) throw notFound();
      if (!EDITABLE.includes(sheet.status))
        throw conflict('status', 'not_editable', 'This week was already submitted.');
      const sent = await tx
        .update(timeEntries)
        .set({ status: 'submitted', rejectionReason: null, decidedByUserId: null, decidedAt: null })
        .where(and(eq(timeEntries.timesheetId, timesheetId), inArray(timeEntries.status, EDITABLE)))
        .returning({ projectId: timeEntries.projectId });
      if (sent.length === 0) throw conflict('entries', 'empty', 'There is nothing to submit.');
      await this.recompute(tx, timesheetId, new Date());
      await this.record(tx, req, access, 'timesheet', timesheetId, 'time.timesheet.submitted', {
        entries: sent.length,
      });
      const recipients = await this.approversOf(tx, access, [
        ...new Set(sent.map((s) => s.projectId)),
      ]);
      await this.notifier.notify(tx, req, {
        tenantId: access.tenantId,
        type: 'time.submitted',
        recipients,
        params: { name: await this.nameOf(access.userId), week: sheet.weekStart },
        link: '/time/approvals',
        actor: { userId: access.userId, membershipId: access.membershipId },
      });
      const [fresh] = await tx.select().from(timesheets).where(eq(timesheets.id, timesheetId));
      return this.toTimesheet(tx, access, sheet.weekStart, fresh);
    });
  }

  // --- approvals ---------------------------------------------------------------------------------

  async approvals(access: AccessContext) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const conditions: (SQL | undefined)[] = [
        eq(timeEntries.status, 'submitted'),
        ne(timeEntries.membershipId, access.membershipId),
      ];
      if (!hasPermission(access.permissions, 'time.timesheet.approve', 'company')) {
        if (!hasPermission(access.permissions, 'time.timesheet.approve', 'project')) return [];
        conditions.push(eq(projects.managerMembershipId, access.membershipId));
      }
      const rows = await tx
        .select({ entry: timeEntries })
        .from(timeEntries)
        .innerJoin(projects, eq(projects.id, timeEntries.projectId))
        .where(and(...conditions))
        .orderBy(asc(timeEntries.membershipId), asc(timeEntries.workDate))
        .limit(500);
      return this.toEntries(
        tx,
        access,
        rows.map((r) => r.entry),
      );
    });
  }

  async decide(
    req: Request,
    access: AccessContext,
    ids: string[],
    decision: 'approved' | 'rejected',
    reason?: string,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const rows = await tx
        .select({ entry: timeEntries, project: projects })
        .from(timeEntries)
        .innerJoin(projects, eq(projects.id, timeEntries.projectId))
        .where(inArray(timeEntries.id, ids))
        .for('update', { of: timeEntries });
      if (rows.length !== new Set(ids).size) throw notFound();
      for (const { entry, project } of rows) {
        if (entry.membershipId === access.membershipId) throw forbidden();
        if (!this.mayApprove(access, project)) throw forbidden();
        if (entry.status !== 'submitted') {
          throw conflict(
            'ids',
            'not_submitted',
            'Only submitted entries can be approved or rejected.',
          );
        }
      }
      const now = new Date();
      await tx
        .update(timeEntries)
        .set({
          status: decision,
          rejectionReason: decision === 'rejected' ? (reason ?? null) : null,
          decidedByUserId: access.userId,
          decidedAt: now,
        })
        .where(inArray(timeEntries.id, ids));
      for (const { entry } of rows) {
        await this.record(
          tx,
          req,
          access,
          'time_entry',
          entry.id,
          decision === 'approved' ? 'time.entry.approved' : 'time.entry.rejected',
          {
            hours: entry.hours,
            ...(reason ? { reason } : {}),
          },
        );
      }
      await this.afterDecision(tx, req, access, [...new Set(rows.map((r) => r.entry.timesheetId))]);
      return this.toEntries(
        tx,
        access,
        await tx.select().from(timeEntries).where(inArray(timeEntries.id, ids)),
      );
    });
  }

  /** Approved time is locked; an approver can send one entry back for correction (audited). */
  async reopen(req: Request, access: AccessContext, id: string, reason: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .select({ entry: timeEntries, project: projects })
        .from(timeEntries)
        .innerJoin(projects, eq(projects.id, timeEntries.projectId))
        .where(eq(timeEntries.id, id))
        .for('update', { of: timeEntries });
      if (!row) throw notFound();
      if (row.entry.membershipId === access.membershipId || !this.mayApprove(access, row.project))
        throw forbidden();
      if (row.entry.status !== 'approved')
        throw conflict('status', 'not_approved', 'Only approved entries are reopened.');
      const now = new Date();
      const [updated] = await tx
        .update(timeEntries)
        .set({
          status: 'rejected',
          rejectionReason: reason,
          decidedByUserId: access.userId,
          decidedAt: now,
          version: row.entry.version + 1,
        })
        .where(eq(timeEntries.id, id))
        .returning();
      await this.record(tx, req, access, 'time_entry', id, 'time.entry.reopened', {
        reason,
        hours: row.entry.hours,
      });
      await this.afterDecision(tx, req, access, [row.entry.timesheetId]);
      if (!updated) throw notFound();
      return this.toEntry(tx, access, updated);
    });
  }

  /** Recomputes each timesheet and tells its person when it is approved or sent back. */
  private async afterDecision(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    sheetIds: string[],
  ) {
    for (const sheetId of sheetIds) {
      const before = await tx.select().from(timesheets).where(eq(timesheets.id, sheetId));
      const status = await this.recompute(tx, sheetId, null);
      const sheet = before[0];
      if (!sheet || (status !== 'approved' && status !== 'rejected') || status === sheet.status)
        continue;
      const [owner] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.id, sheet.membershipId));
      if (!owner) continue;
      await this.notifier.notify(tx, req, {
        tenantId: access.tenantId,
        type: status === 'approved' ? 'time.approved' : 'time.rejected',
        recipients: [owner.userId],
        params: { week: sheet.weekStart },
        link: `/time?week=${sheet.weekStart}`,
        actor: { userId: access.userId, membershipId: access.membershipId },
      });
    }
  }

  /** Timesheet status from its entries: any rejected → rejected; all approved → approved. */
  private async recompute(tx: TenantTransaction, sheetId: string, submittedAt: Date | null) {
    const entries = await tx
      .select({ status: timeEntries.status })
      .from(timeEntries)
      .where(eq(timeEntries.timesheetId, sheetId));
    const statuses = entries.map((e) => e.status);
    const status: TimesheetStatus = statuses.includes('rejected')
      ? 'rejected'
      : statuses.length > 0 && statuses.every((s) => s === 'approved')
        ? 'approved'
        : statuses.includes('submitted') || statuses.includes('approved')
          ? 'submitted'
          : 'draft';
    await tx
      .update(timesheets)
      .set({
        status,
        ...(submittedAt ? { submittedAt } : {}),
        version: sql`${timesheets.version} + 1`,
      })
      .where(eq(timesheets.id, sheetId));
    return status;
  }

  // --- timer -------------------------------------------------------------------------------------

  async timer(access: AccessContext) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .select({ timer: timeTimers, task: tasks })
        .from(timeTimers)
        .innerJoin(tasks, eq(tasks.id, timeTimers.taskId))
        .where(eq(timeTimers.membershipId, access.membershipId));
      return {
        running: row
          ? {
              task: { id: row.task.id, number: row.task.number, title: row.task.title },
              startedAt: row.timer.startedAt.toISOString(),
            }
          : null,
      };
    });
  }

  async startTimer(req: Request, access: AccessContext, taskId: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      const { project } = await this.assignedTask(tx, access, taskId);
      const [running] = await tx
        .select()
        .from(timeTimers)
        .where(eq(timeTimers.membershipId, access.membershipId));
      if (running) throw conflict('taskId', 'timer_running', 'A timer is already running.');
      await tx.insert(timeTimers).values({
        tenantId: access.tenantId,
        membershipId: access.membershipId,
        projectId: project.id,
        taskId,
      });
      await this.record(tx, req, access, 'task', taskId, 'time.timer.started');
    });
    return this.timer(access);
  }

  /** Stops my timer and records the elapsed time (rounded up to the minute) as a draft entry. */
  async stopTimer(req: Request, access: AccessContext, description?: string, now = new Date()) {
    const stopped = await this.database.withTenant(access.tenantId, async (tx) => {
      const [running] = await tx
        .delete(timeTimers)
        .where(eq(timeTimers.membershipId, access.membershipId))
        .returning();
      if (!running) throw conflict('timer', 'not_running', 'No timer is running.');
      return running;
    });
    const minutes = Math.min(
      24 * 60,
      Math.max(1, Math.ceil((now.getTime() - stopped.startedAt.getTime()) / 60_000)),
    );
    const hundredthsOfHour = BigInt(Math.ceil((minutes * 100) / 60));
    return this.create(req, access, {
      taskId: stopped.taskId,
      workDate: kuwaitToday(now),
      hours: formatHours(hundredthsOfHour),
      ...(description ? { description } : {}),
      confirmDuplicate: true,
    });
  }

  // --- summaries ---------------------------------------------------------------------------------

  async summary(access: AccessContext, from: string, to: string, membershipId?: string) {
    const target = membershipId ?? access.membershipId;
    if (
      target !== access.membershipId &&
      !hasPermission(access.permissions, 'time.entry.read', 'company')
    )
      throw forbidden();
    const { rows, employee } = await this.database.withTenant(access.tenantId, async (tx) => ({
      employee: (await tx.select().from(employees).where(eq(employees.membershipId, target)))[0],
      rows: await tx
        .select({ entry: timeEntries, project: projects })
        .from(timeEntries)
        .innerJoin(projects, eq(projects.id, timeEntries.projectId))
        .where(
          and(
            eq(timeEntries.membershipId, target),
            gte(timeEntries.workDate, from),
            lte(timeEntries.workDate, to),
            ne(timeEntries.status, 'rejected'),
          ),
        ),
    }));
    const names = await this.memberNames(access, [target]);
    if (!names.has(target)) throw notFound();
    const approved = rows.filter((r) => r.entry.status === 'approved');
    const billable = approved.filter((r) => r.entry.billable);
    const approvedTotal = sum(approved.map((r) => r.entry));
    const billableTotal = sum(billable.map((r) => r.entry));
    const days: { date: string; hours: string }[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days.push({
        date: d,
        hours: formatHours(sum(rows.filter((r) => r.entry.workDate === d).map((r) => r.entry))),
      });
    }
    const byProject = new Map<string, typeof rows>();
    for (const r of rows) byProject.set(r.project.id, [...(byProject.get(r.project.id) ?? []), r]);
    return {
      from,
      to,
      person: { membershipId: target, name: names.get(target) ?? '' },
      logged: formatHours(sum(rows.map((r) => r.entry))),
      approved: formatHours(approvedTotal),
      billable: formatHours(billableTotal),
      nonBillable: formatHours(approvedTotal - billableTotal),
      billablePercent: approvedTotal === 0n ? null : Number((billableTotal * 100n) / approvedTotal),
      ...this.capacityOf(employee, from, to, approvedTotal),
      days,
      projects: [...byProject.values()].map((list) => {
        const p = list[0]?.project;
        const ok = list.filter((r) => r.entry.status === 'approved');
        return {
          id: p?.id ?? '',
          number: p?.number ?? '',
          name: { en: p?.nameEn ?? '', ar: p?.nameAr ?? '' },
          logged: formatHours(sum(list.map((r) => r.entry))),
          approved: formatHours(sum(ok.map((r) => r.entry))),
          billable: formatHours(sum(ok.filter((r) => r.entry.billable).map((r) => r.entry))),
        };
      }),
    };
  }

  /**
   * Contracted hours in the period (weekly hours spread over the person's working days) and
   * approved hours as a share of it (docs/modules/people.md §1).
   */
  private capacityOf(
    employee: typeof employees.$inferSelect | undefined,
    from: string,
    to: string,
    approved: bigint,
  ) {
    if (!employee || employee.workDays.length === 0) {
      return { capacity: null, utilisationPercent: null };
    }
    let days = 0n;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (employee.workDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) days += 1n;
    }
    const capacity = (hundredths(employee.weeklyHours) * days) / BigInt(employee.workDays.length);
    return {
      capacity: formatHours(capacity),
      utilisationPercent: capacity === 0n ? null : Number((approved * 100n) / capacity),
    };
  }

  /** Planned (allocated) vs actual per person on one task. */
  async taskTime(access: AccessContext, taskId: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .select({ task: tasks, project: projects })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(eq(tasks.id, taskId));
      if (!row) throw notFound();
      const visible =
        hasPermission(access.permissions, 'tasks.task.read', 'company') ||
        (hasPermission(access.permissions, 'tasks.task.read', 'project') &&
          (await this.onProject(tx, access, row.project))) ||
        (
          await tx
            .select()
            .from(taskAllocations)
            .where(
              and(
                eq(taskAllocations.taskId, taskId),
                eq(taskAllocations.membershipId, access.membershipId),
              ),
            )
        ).length > 0;
      if (!visible) throw notFound();
      const allocations = await tx
        .select()
        .from(taskAllocations)
        .where(eq(taskAllocations.taskId, taskId));
      const entries = await tx
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.taskId, taskId), ne(timeEntries.status, 'rejected')));
      return allocations.map((a) => {
        const mine = entries.filter((e) => e.membershipId === a.membershipId);
        return {
          membershipId: a.membershipId,
          allocated: formatHours(hundredths(a.hours)),
          logged: formatHours(sum(mine)),
          approved: formatHours(sum(mine.filter((e) => e.status === 'approved'))),
        };
      });
    });
    const names = await this.memberNames(
      access,
      rows.map((r) => r.membershipId),
    );
    return {
      items: rows
        .map((r) => ({ ...r, name: names.get(r.membershipId) ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // --- helpers -----------------------------------------------------------------------------------

  /** A task I'm assigned to, on an open project, that is not cancelled. */
  private async assignedTask(tx: TenantTransaction, access: AccessContext, taskId: string) {
    const [row] = await tx
      .select({ task: tasks, project: projects })
      .from(taskAllocations)
      .innerJoin(tasks, eq(tasks.id, taskAllocations.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(taskAllocations.taskId, taskId),
          eq(taskAllocations.membershipId, access.membershipId),
        ),
      );
    if (!row) throw invalid('taskId', 'not_assigned');
    if (CLOSED_PROJECT.includes(row.project.status))
      throw conflict('taskId', 'project_closed', 'The project is closed.');
    if (row.task.status === 'cancelled')
      throw conflict('taskId', 'task_cancelled', 'The task was cancelled.');
    return row;
  }

  private async sheetFor(
    tx: TenantTransaction,
    access: AccessContext,
    weekStart: string,
  ): Promise<SheetRow> {
    await tx
      .insert(timesheets)
      .values({ tenantId: access.tenantId, membershipId: access.membershipId, weekStart })
      .onConflictDoNothing();
    const [sheet] = await tx
      .select()
      .from(timesheets)
      .where(
        and(eq(timesheets.membershipId, access.membershipId), eq(timesheets.weekStart, weekStart)),
      )
      .for('update');
    if (!sheet) throw new Error('timesheet missing after insert');
    return sheet;
  }

  private async assertDayTotal(
    tx: TenantTransaction,
    access: AccessContext,
    date: string,
    hours: string,
    exceptId?: string,
  ) {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${timeEntries.hours}), 0)::text` })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.membershipId, access.membershipId),
          eq(timeEntries.workDate, date),
          ne(timeEntries.status, 'rejected'),
          exceptId ? ne(timeEntries.id, exceptId) : undefined,
        ),
      );
    if (hundredths(row?.total ?? '0') + hundredths(hours) > 2400n)
      throw invalid('hours', 'day_over_24');
  }

  private async ownEditable(tx: TenantTransaction, access: AccessContext, id: string) {
    const [row] = await tx
      .select({ entry: timeEntries, sheet: timesheets })
      .from(timeEntries)
      .innerJoin(timesheets, eq(timesheets.id, timeEntries.timesheetId))
      .where(eq(timeEntries.id, id))
      .for('update', { of: timeEntries });
    if (!row || row.entry.membershipId !== access.membershipId) throw notFound();
    if (!EDITABLE.includes(row.entry.status) || !EDITABLE.includes(row.sheet.status)) {
      throw conflict('status', 'locked', 'Submitted or approved time cannot be changed.');
    }
    return row.entry;
  }

  /** Who is told about a submitted week: each project's manager; Owner/CEO when that is me. */
  private async approversOf(tx: TenantTransaction, access: AccessContext, projectIds: string[]) {
    const managers = await tx
      .select({ membershipId: projects.managerMembershipId, userId: memberships.userId })
      .from(projects)
      .innerJoin(memberships, eq(memberships.id, projects.managerMembershipId))
      .where(inArray(projects.id, projectIds));
    const users = managers
      .filter((m) => m.membershipId !== access.membershipId)
      .map((m) => m.userId);
    if (managers.some((m) => m.membershipId === access.membershipId)) {
      const leaders = await tx
        .selectDistinct({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
        .where(
          and(eq(memberships.status, 'active'), inArray(membershipRoles.role, ['owner', 'ceo'])),
        );
      users.push(...leaders.map((l) => l.userId));
    }
    return [...new Set(users)].filter((u) => u !== access.userId);
  }

  private async toTimesheet(
    tx: TenantTransaction,
    access: AccessContext,
    weekStart: string,
    sheet?: SheetRow,
  ): Promise<Timesheet> {
    const rows = sheet
      ? await tx
          .select()
          .from(timeEntries)
          .where(eq(timeEntries.timesheetId, sheet.id))
          .orderBy(asc(timeEntries.workDate), asc(timeEntries.id))
      : [];
    const counted = rows.filter((r) => r.status !== 'rejected');
    const status = sheet?.status ?? 'draft';
    return {
      id: sheet?.id ?? null,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      status,
      submittedAt: sheet?.submittedAt?.toISOString() ?? null,
      entries: await this.toEntries(tx, access, rows),
      days: Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        return { date, hours: formatHours(sum(counted.filter((r) => r.workDate === date))) };
      }),
      totalHours: formatHours(sum(counted)),
      billableHours: formatHours(sum(counted.filter((r) => r.billable))),
      canSubmit: EDITABLE.includes(status) && rows.some((r) => EDITABLE.includes(r.status)),
    };
  }

  private async toEntry(
    tx: TenantTransaction,
    access: AccessContext,
    row: EntryRow,
  ): Promise<TimeEntry> {
    const [entry] = await this.toEntries(tx, access, [row]);
    if (!entry) throw notFound();
    return entry;
  }

  private async toEntries(
    tx: TenantTransaction,
    access: AccessContext,
    rows: EntryRow[],
  ): Promise<TimeEntry[]> {
    if (rows.length === 0) return [];
    const taskRows = await tx
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(inArray(tasks.id, [...new Set(rows.map((r) => r.taskId))]));
    const byTask = new Map(taskRows.map((r) => [r.task.id, r]));
    const people = await this.memberNames(
      access,
      rows.map((r) => r.membershipId),
      tx,
    );
    const deciders = await this.userNames(
      rows.flatMap((r) => (r.decidedByUserId ? [r.decidedByUserId] : [])),
    );
    const sheets = new Map(
      (
        await tx
          .select()
          .from(timesheets)
          .where(inArray(timesheets.id, [...new Set(rows.map((r) => r.timesheetId))]))
      ).map((s) => [s.id, s]),
    );
    return rows.flatMap((r) => {
      const ref = byTask.get(r.taskId);
      if (!ref) return [];
      const mine = r.membershipId === access.membershipId;
      const editable =
        mine &&
        EDITABLE.includes(r.status) &&
        EDITABLE.includes(sheets.get(r.timesheetId)?.status ?? 'draft');
      const approver = !mine && this.mayApprove(access, ref.project);
      return [
        {
          id: r.id,
          workDate: r.workDate,
          hours: formatHours(hundredths(r.hours)),
          billable: r.billable,
          description: r.description,
          status: r.status,
          rejectionReason: r.rejectionReason,
          person: { membershipId: r.membershipId, name: people.get(r.membershipId) ?? '' },
          task: { id: ref.task.id, number: ref.task.number, title: ref.task.title },
          project: {
            id: ref.project.id,
            number: ref.project.number,
            name: { en: ref.project.nameEn, ar: ref.project.nameAr },
          },
          decidedByName: r.decidedByUserId ? (deciders.get(r.decidedByUserId) ?? null) : null,
          actions: [
            ...(editable ? (['edit', 'delete'] as const) : []),
            ...(approver && r.status === 'submitted' ? (['approve', 'reject'] as const) : []),
            ...(approver && r.status === 'approved' ? (['reopen'] as const) : []),
          ],
          version: r.version,
        },
      ];
    });
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

  private async nameOf(userId: string) {
    return (await this.userNames([userId])).get(userId) ?? '';
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    type: string,
    id: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target: { type, id },
      ...(details ? { details } : {}),
    });
  }
}
