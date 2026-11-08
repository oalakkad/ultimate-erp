import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type budgetRevisionRequestSchema,
  type createProjectRequestSchema,
  hasPermission,
  type Permission,
  type Project,
  PROJECT_ACTIVITY_ACTIONS,
  PROJECT_TRANSITIONS,
  type projectListQuerySchema,
  type ProjectStatus,
  type ProjectSummary,
  type updateProjectRequestSchema,
} from '@ultimate-erp/contracts';
import {
  auditEvents,
  clients,
  contracts,
  files,
  memberships,
  projectBudgetRevisions,
  projectDocuments,
  projectMembers,
  projects,
  taskAllocations,
  tasks,
  timeEntries,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { and, desc, eq, ilike, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { type Request } from 'express';
import { type z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { nextDocumentNumber } from '../../platform/database/numbering.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { DOWNLOAD_URL_SECONDS, ObjectStorage } from '../../platform/files/object-storage.js';
import { type AccessContext } from '../access/access-context.js';
import { IdentityService } from '../identity/identity.service.js';

type ProjectRow = typeof projects.$inferSelect;
const FOREIGN_KEY_VIOLATION = '23503';
const CLOSED: ProjectStatus[] = ['completed', 'cancelled'];

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

/** Hours as exact hundredths ("37.5" → 3750n) — never compared as floats. */
export const hundredths = (hours: string): bigint => {
  const [whole = '0', frac = ''] = hours.split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
};
export const formatHours = (h: bigint): string => {
  const sign = h < 0n ? '-' : '';
  const abs = h < 0n ? -h : h;
  const frac = abs % 100n;
  return `${sign}${abs / 100n}${frac === 0n ? '' : `.${String(frac).padStart(2, '0').replace(/0$/, '')}`}`;
};

/** Projects a person manages or is on the team of ("my projects" for project-scoped people). */
export const onProjectTeam = (membershipId: string) =>
  or(
    eq(projects.managerMembershipId, membershipId),
    sql`exists (select 1 from project_members pm where pm.tenant_id = ${projects.tenantId} and pm.project_id = ${projects.id} and pm.membership_id = ${membershipId})`,
  );

/** Projects / engagements & budgeting (docs/modules/projects.md). */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly identity: IdentityService,
    private readonly storage: ObjectStorage,
  ) {}

  // --- access helpers --------------------------------------------------------------------------

  private companyWide(access: AccessContext, permission: Permission) {
    return hasPermission(access.permissions, permission, 'company');
  }

  /** Is the person this project's manager or on its team? */
  private async onTeam(tx: TenantTransaction, access: AccessContext, project: ProjectRow) {
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

  /** Company scope, or project scope on a project the person works on. */
  private async may(
    tx: TenantTransaction,
    access: AccessContext,
    permission: Permission,
    project: ProjectRow,
  ) {
    if (this.companyWide(access, permission)) return true;
    return (
      hasPermission(access.permissions, permission, 'project') &&
      (await this.onTeam(tx, access, project))
    );
  }

  /** Loads a project the person may read; anyone else gets 404 (no hint it exists). */
  private async readable(tx: TenantTransaction, access: AccessContext, id: string, lock = false) {
    const query = tx.select().from(projects).where(eq(projects.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row || !(await this.may(tx, access, 'projects.project.read', row))) throw notFound();
    return row;
  }

  private async require(
    tx: TenantTransaction,
    access: AccessContext,
    permission: Permission,
    project: ProjectRow,
  ) {
    if (!(await this.may(tx, access, permission, project))) throw forbidden();
  }

  private assertOpen(project: ProjectRow) {
    if (CLOSED.includes(project.status)) {
      throw conflict('status', 'closed', 'A completed or cancelled project cannot be changed.');
    }
  }

  // --- projects ------------------------------------------------------------------------------

  async list(access: AccessContext, query: z.output<typeof projectListQuerySchema>) {
    const conditions: (SQL | undefined)[] = [
      isNull(projects.archivedAt),
      query.status ? eq(projects.status, query.status) : undefined,
      query.clientId ? eq(projects.clientId, query.clientId) : undefined,
      query.cursor ? lt(projects.id, query.cursor) : undefined,
    ];
    const mineOnly = query.mine === 'true' || !this.companyWide(access, 'projects.project.read');
    if (mineOnly) {
      conditions.push(onProjectTeam(access.membershipId));
    }
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        or(
          ilike(projects.number, pattern),
          ilike(projects.nameEn, pattern),
          ilike(projects.nameAr, pattern),
          ilike(clients.legalNameEn, pattern),
          ilike(clients.legalNameAr, pattern),
        ),
      );
    }
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select({ project: projects, client: clients })
        .from(projects)
        .innerJoin(clients, eq(clients.id, projects.clientId))
        .where(and(...conditions))
        .orderBy(desc(projects.id))
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit);
    const managers = await this.managerNames(
      access,
      page.map((r) => r.project.managerMembershipId),
    );
    return {
      items: page.map(({ project, client }) => this.toSummary(project, client, managers)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.project.id ?? null) : null,
    };
  }

  async get(access: AccessContext, id: string): Promise<Project> {
    return this.database.withTenant(access.tenantId, async (tx) =>
      this.toProject(tx, access, await this.readable(tx, access, id)),
    );
  }

  async create(
    req: Request,
    access: AccessContext,
    input: z.output<typeof createProjectRequestSchema>,
  ) {
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const [client] = await tx.select().from(clients).where(eq(clients.id, input.clientId));
        if (!client || client.archivedAt) throw invalid('clientId', 'not_found');
        const team = [...new Set([input.managerMembershipId, ...(input.memberIds ?? [])])];
        await this.assertActiveMembers(tx, team, 'memberIds');
        const number = await nextDocumentNumber(tx, access.tenantId, 'project', 'P');
        const [row] = await tx
          .insert(projects)
          .values({
            tenantId: access.tenantId,
            number,
            clientId: input.clientId,
            contractId: input.contractId ?? null,
            nameEn: input.nameEn,
            nameAr: input.nameAr,
            description: input.description ?? null,
            managerMembershipId: input.managerMembershipId,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            billingMethod: input.billingMethod ?? 'time_and_materials',
            budgetHours: input.budgetHours,
            budgetAmount: input.budgetAmount ?? null,
            currency: input.currency ?? 'KWD',
            createdByUserId: access.userId,
          })
          .returning();
        if (!row) throw new Error('project insert returned nothing');
        await tx.insert(projectBudgetRevisions).values({
          tenantId: access.tenantId,
          projectId: row.id,
          revisionNo: 1,
          budgetHours: row.budgetHours,
          budgetAmount: row.budgetAmount,
          reason: 'Initial budget',
          changedByUserId: access.userId,
        });
        await tx.insert(projectMembers).values(
          team.map((membershipId) => ({
            tenantId: access.tenantId,
            projectId: row.id,
            membershipId,
            addedByUserId: access.userId,
          })),
        );
        await this.record(tx, req, access, row.id, 'projects.project.created', {
          number,
          budgetHours: row.budgetHours,
        });
        return this.toProject(tx, access, row);
      });
    } catch (err) {
      throw this.contractMismatch(err);
    }
  }

  async update(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof updateProjectRequestSchema>,
  ) {
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const current = await this.readable(tx, access, id, true);
        await this.require(tx, access, 'projects.project.manage', current);
        this.assertOpen(current);
        if (current.version !== input.version)
          throw conflict('version', 'stale', 'The project was changed by someone else.');
        const changes = Object.fromEntries(
          Object.entries(input).filter(([k, v]) => k !== 'version' && v !== undefined),
        );
        if (
          input.managerMembershipId &&
          input.managerMembershipId !== current.managerMembershipId
        ) {
          await this.assertActiveMembers(tx, [input.managerMembershipId], 'managerMembershipId');
          await tx
            .insert(projectMembers)
            .values({
              tenantId: access.tenantId,
              projectId: id,
              membershipId: input.managerMembershipId,
              addedByUserId: access.userId,
            })
            .onConflictDoNothing();
        }
        const merged = { ...current, ...changes };
        if (merged.startDate && merged.endDate && merged.endDate < merged.startDate)
          throw invalid('endDate', 'before_start');
        const [row] = await tx
          .update(projects)
          .set({ ...changes, version: current.version + 1 })
          .where(eq(projects.id, id))
          .returning();
        if (!row) throw notFound();
        await this.record(tx, req, access, id, 'projects.project.updated', {
          fields: Object.keys(changes),
        });
        return this.toProject(tx, access, row);
      });
    } catch (err) {
      throw this.contractMismatch(err);
    }
  }

  async setStatus(req: Request, access: AccessContext, id: string, status: ProjectStatus) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.readable(tx, access, id, true);
      await this.require(tx, access, 'projects.project.manage', current);
      if (!PROJECT_TRANSITIONS[current.status].includes(status)) {
        throw conflict(
          'status',
          'invalid_transition',
          `A ${current.status} project cannot become ${status}.`,
        );
      }
      const [row] = await tx
        .update(projects)
        .set({ status, version: current.version + 1 })
        .where(eq(projects.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, id, 'projects.project.status_changed', {
        from: current.status,
        to: status,
      });
      return this.toProject(tx, access, row);
    });
  }

  // --- budget --------------------------------------------------------------------------------

  async revisions(access: AccessContext, id: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.readable(tx, access, id);
      return tx
        .select()
        .from(projectBudgetRevisions)
        .where(eq(projectBudgetRevisions.projectId, id))
        .orderBy(desc(projectBudgetRevisions.revisionNo));
    });
    const names = await this.userNames(rows.map((r) => r.changedByUserId));
    return rows.map((r) => ({
      revisionNo: r.revisionNo,
      budgetHours: formatHours(hundredths(r.budgetHours)),
      budgetAmount: r.budgetAmount,
      reason: r.reason,
      changedByName: names.get(r.changedByUserId) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** A new budget is a new revision (with a reason); it may not drop below allocated hours unless overridden. */
  async revise(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof budgetRevisionRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.readable(tx, access, id, true);
      await this.require(tx, access, 'projects.budget.update', current);
      this.assertOpen(current);
      const allocated = await this.allocatedHundredths(tx, id);
      if (hundredths(input.budgetHours) < allocated) {
        const mayOverride =
          input.override && (await this.may(tx, access, 'projects.budget.override', current));
        if (!mayOverride) {
          throw conflict(
            'budgetHours',
            'below_allocated',
            'The new budget is lower than the hours already allocated.',
          );
        }
      }
      const revisionNo = current.budgetRevision + 1;
      await tx.insert(projectBudgetRevisions).values({
        tenantId: access.tenantId,
        projectId: id,
        revisionNo,
        budgetHours: input.budgetHours,
        budgetAmount: input.budgetAmount ?? null,
        reason: input.reason,
        changedByUserId: access.userId,
      });
      const [row] = await tx
        .update(projects)
        .set({
          budgetHours: input.budgetHours,
          budgetAmount: input.budgetAmount ?? null,
          budgetRevision: revisionNo,
          version: current.version + 1,
        })
        .where(eq(projects.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, id, 'projects.budget.revised', {
        revisionNo,
        from: current.budgetHours,
        to: input.budgetHours,
        ...(input.override ? { override: true } : {}),
      });
      return this.toProject(tx, access, row);
    });
  }

  /**
   * The hour measures (docs/modules/projects.md §3). Allocated comes from tasks (Phase 6);
   * logged / approved / billable arrive with timesheets (Phase 7) and are 0 until then.
   */
  async hours(access: AccessContext, id: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const project = await this.readable(tx, access, id);
      const budgeted = hundredths(project.budgetHours);
      const allocated = await this.allocatedHundredths(tx, id);
      const time = await this.timeTotals(tx, id);
      const approved = time.approved;
      const used = allocated > approved ? allocated : approved;
      const warning =
        budgeted === 0n
          ? used > 0n
            ? 'exceeded'
            : 'none'
          : used > budgeted
            ? 'exceeded'
            : used * 100n >= budgeted * 80n
              ? 'approaching'
              : 'none';
      return {
        budgeted: formatHours(budgeted),
        allocated: formatHours(allocated),
        remaining: formatHours(budgeted - allocated),
        logged: formatHours(time.logged),
        approved: formatHours(approved),
        billable: formatHours(time.billable),
        warning,
      };
    });
  }

  /** Logged (not rejected), approved and approved-billable time on the project (timesheets.md §3). */
  private async timeTotals(tx: TenantTransaction, projectId: string) {
    const [row] = await tx
      .select({
        logged: sql<string>`coalesce(sum(${timeEntries.hours}) filter (where ${timeEntries.status} <> 'rejected'), 0)::text`,
        approved: sql<string>`coalesce(sum(${timeEntries.hours}) filter (where ${timeEntries.status} = 'approved'), 0)::text`,
        billable: sql<string>`coalesce(sum(${timeEntries.hours}) filter (where ${timeEntries.status} = 'approved' and ${timeEntries.billable}), 0)::text`,
      })
      .from(timeEntries)
      .where(eq(timeEntries.projectId, projectId));
    return {
      logged: hundredths(row?.logged ?? '0'),
      approved: hundredths(row?.approved ?? '0'),
      billable: hundredths(row?.billable ?? '0'),
    };
  }

  /** Hours allocated on the project's tasks that are not cancelled (docs/modules/tasks.md §3). */
  private async allocatedHundredths(tx: TenantTransaction, projectId: string): Promise<bigint> {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${taskAllocations.hours}), 0)::text` })
      .from(taskAllocations)
      .innerJoin(tasks, eq(tasks.id, taskAllocations.taskId))
      .where(and(eq(taskAllocations.projectId, projectId), ne(tasks.status, 'cancelled')));
    return hundredths(row?.total ?? '0');
  }

  // --- team ----------------------------------------------------------------------------------

  async setMembers(req: Request, access: AccessContext, id: string, memberIds: string[]) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.readable(tx, access, id, true);
      await this.require(tx, access, 'projects.project.manage', current);
      this.assertOpen(current);
      const wanted = [...new Set([current.managerMembershipId, ...memberIds])];
      await this.assertActiveMembers(tx, wanted, 'memberIds');
      const existing = (
        await tx
          .select({ id: projectMembers.membershipId })
          .from(projectMembers)
          .where(eq(projectMembers.projectId, id))
      ).map((r) => r.id);
      const add = wanted.filter((m) => !existing.includes(m));
      const remove = existing.filter((m) => !wanted.includes(m));
      if (add.length > 0) {
        await tx.insert(projectMembers).values(
          add.map((membershipId) => ({
            tenantId: access.tenantId,
            projectId: id,
            membershipId,
            addedByUserId: access.userId,
          })),
        );
      }
      if (remove.length > 0) {
        // People with hours on this project's tasks stay on the team (their work is recorded there).
        const [busy] = await tx
          .select({ id: taskAllocations.membershipId })
          .from(taskAllocations)
          .where(
            and(eq(taskAllocations.projectId, id), inArray(taskAllocations.membershipId, remove)),
          )
          .limit(1);
        if (busy) {
          throw conflict(
            'memberIds',
            'has_allocations',
            'Someone you removed still has hours on tasks of this project.',
          );
        }
        await tx
          .delete(projectMembers)
          .where(
            and(eq(projectMembers.projectId, id), inArray(projectMembers.membershipId, remove)),
          );
      }
      if (add.length > 0 || remove.length > 0) {
        await this.record(tx, req, access, id, 'projects.project.team_changed', {
          added: add.length,
          removed: remove.length,
        });
      }
      return this.toProject(tx, access, current);
    });
  }

  // --- documents -----------------------------------------------------------------------------

  async documents(access: AccessContext, id: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.readable(tx, access, id);
      return tx
        .select({ link: projectDocuments, file: files })
        .from(projectDocuments)
        .innerJoin(files, eq(files.id, projectDocuments.fileId))
        .where(eq(projectDocuments.projectId, id))
        .orderBy(desc(projectDocuments.createdAt));
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
        const project = await this.readable(tx, access, id);
        await this.require(tx, access, 'projects.project.manage', project);
        const [file] = await tx
          .select({ status: files.status })
          .from(files)
          .where(and(eq(files.id, fileId), eq(files.uploadedByUserId, access.userId)));
        if (!file) throw invalid('fileId', 'not_found');
        if (file.status === 'infected') throw invalid('fileId', 'infected');
        await tx.insert(projectDocuments).values({
          tenantId: access.tenantId,
          projectId: id,
          fileId,
          addedByUserId: access.userId,
        });
        await this.record(tx, req, access, id, 'projects.document.attached', { fileId });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('fileId', 'already_attached', 'This file is already attached.');
      throw err;
    }
    return this.documents(access, id);
  }

  async documentDownload(req: Request, access: AccessContext, id: string, fileId: string) {
    const file = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.readable(tx, access, id);
      const [row] = await tx
        .select({ file: files })
        .from(projectDocuments)
        .innerJoin(files, eq(files.id, projectDocuments.fileId))
        .where(and(eq(projectDocuments.projectId, id), eq(projectDocuments.fileId, fileId)));
      if (!row) throw notFound();
      if (row.file.status !== 'clean')
        throw new AppError('FILE_NOT_READY', HttpStatus.CONFLICT, messageFor('FILE_NOT_READY'));
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'files.file.downloaded',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'file', id: fileId },
        details: { projectId: id },
      });
      return row.file;
    });
    const url = await this.storage.downloadUrl(file.storageKey, file.displayName, file.contentType);
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  async detachDocument(req: Request, access: AccessContext, id: string, fileId: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      const project = await this.readable(tx, access, id);
      await this.require(tx, access, 'projects.project.manage', project);
      const removed = await tx
        .delete(projectDocuments)
        .where(and(eq(projectDocuments.projectId, id), eq(projectDocuments.fileId, fileId)))
        .returning({ fileId: projectDocuments.fileId });
      if (removed.length === 0) throw notFound();
      await this.record(tx, req, access, id, 'projects.document.detached', { fileId });
    });
  }

  // --- activity ------------------------------------------------------------------------------

  async activity(access: AccessContext, id: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.readable(tx, access, id);
      return tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetType, 'project'),
            eq(auditEvents.targetId, id),
            inArray(auditEvents.action, [...PROJECT_ACTIVITY_ACTIONS]),
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
          action: r.action as (typeof PROJECT_ACTIVITY_ACTIONS)[number],
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

  // --- mapping -------------------------------------------------------------------------------

  private toSummary(
    row: ProjectRow,
    client: typeof clients.$inferSelect,
    managers: Map<string, string>,
  ): ProjectSummary {
    const manager = managers.get(row.managerMembershipId);
    return {
      id: row.id,
      number: row.number,
      name: { en: row.nameEn, ar: row.nameAr },
      client: {
        id: client.id,
        number: client.number,
        name: { en: client.legalNameEn, ar: client.legalNameAr },
      },
      status: row.status,
      manager: manager ? { membershipId: row.managerMembershipId, name: manager } : null,
      startDate: row.startDate,
      endDate: row.endDate,
      budgetHours: formatHours(hundredths(row.budgetHours)),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async toProject(
    tx: TenantTransaction,
    access: AccessContext,
    row: ProjectRow,
  ): Promise<Project> {
    const [client] = await tx.select().from(clients).where(eq(clients.id, row.clientId));
    if (!client) throw notFound();
    const [contract] = row.contractId
      ? await tx.select().from(contracts).where(eq(contracts.id, row.contractId))
      : [];
    const team = await tx
      .select({ membershipId: projectMembers.membershipId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, row.id));
    const names = await this.managerNames(
      access,
      [row.managerMembershipId, ...team.map((m) => m.membershipId)],
      tx,
    );
    const open = !CLOSED.includes(row.status);
    const manage = open && (await this.may(tx, access, 'projects.project.manage', row));
    const budget = open && (await this.may(tx, access, 'projects.budget.update', row));
    const actions = [
      ...(manage ? (['edit', 'team'] as const) : []),
      ...(budget ? (['budget'] as const) : []),
      ...((await this.may(tx, access, 'projects.project.manage', row)) &&
      PROJECT_TRANSITIONS[row.status].length > 0
        ? (['status'] as const)
        : []),
    ];
    return {
      ...this.toSummary(row, client, names),
      description: row.description,
      contract: contract
        ? {
            id: contract.id,
            number: contract.number,
            title: { en: contract.titleEn, ar: contract.titleAr },
          }
        : null,
      billingMethod: row.billingMethod,
      budgetAmount: row.budgetAmount,
      currency: row.currency,
      budgetRevision: row.budgetRevision,
      members: team
        .map((m) => ({ membershipId: m.membershipId, name: names.get(m.membershipId) ?? '' }))
        .filter((m) => m.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
      nextStatuses: actions.includes('status') ? [...PROJECT_TRANSITIONS[row.status]] : [],
      actions,
      version: row.version,
    };
  }

  /** Membership ID → person's name. */
  private async managerNames(
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
    const users = new Map(
      (await this.identity.userSummaries(rows.map((r) => r.userId))).map((u) => [u.id, u.name]),
    );
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

  private async assertActiveMembers(tx: TenantTransaction, membershipIds: string[], path: string) {
    if (membershipIds.length === 0) return;
    const rows = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(inArray(memberships.id, membershipIds), eq(memberships.status, 'active')));
    if (rows.length !== new Set(membershipIds).size) throw invalid(path, 'not_found');
  }

  private contractMismatch(err: unknown): unknown {
    if (pgErrorCode(err) === FOREIGN_KEY_VIOLATION) return invalid('contractId', 'not_of_client');
    return err;
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    projectId: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target: { type: 'project', id: projectId },
      ...(details ? { details } : {}),
    });
  }
}
