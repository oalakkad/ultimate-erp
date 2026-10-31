import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type ExpenseClaim,
  type ExpenseSettings,
  expenseSettingsSchema,
  type ExpenseSummary,
  hasPermission,
  type Permission,
} from '@ultimate-erp/contracts';
import {
  companySettings,
  employees,
  expenseClaims,
  expenseLines,
  files,
  invoiceExpenseLines,
  invoices,
  membershipRoles,
  memberships,
  projectMembers,
  projects,
  teamMembers,
  teams,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { and, asc, desc, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import { type Request } from 'express';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { nextDocumentNumber } from '../../platform/database/numbering.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { DOWNLOAD_URL_SECONDS, ObjectStorage } from '../../platform/files/object-storage.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { IdentityService } from '../identity/identity.service.js';
import { filsToKwd, kwdToFils } from '../payroll/engine.js';
import { teamScopeOf } from '../people/people.service.js';

type ClaimRow = typeof expenseClaims.$inferSelect;
type LineInput = {
  spentOn: string;
  category: string;
  description: string;
  amount: string;
  projectId?: string | null | undefined;
  billable?: boolean | undefined;
  receiptFileId?: string | null | undefined;
};

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
const MAX_LINE_FILS = 100_000_000n;

/** Starting categories: company settings, not legal rules (docs/modules/expenses.md §10). */
const DEFAULT_SETTINGS: ExpenseSettings = {
  categories: [
    { code: 'travel', nameEn: 'Travel', nameAr: 'سفر', active: true },
    { code: 'transport', nameEn: 'Local transport', nameAr: 'مواصلات', active: true },
    { code: 'meals', nameEn: 'Meals', nameAr: 'وجبات', active: true },
    { code: 'accommodation', nameEn: 'Accommodation', nameAr: 'إقامة', active: true },
    { code: 'subcontractor', nameEn: 'Subcontractor', nameAr: 'مقاول من الباطن', active: true },
    { code: 'government_fees', nameEn: 'Government fees', nameAr: 'رسوم حكومية', active: true },
    { code: 'office', nameEn: 'Office supplies', nameAr: 'لوازم مكتبية', active: true },
    { code: 'other', nameEn: 'Other', nameAr: 'أخرى', active: true },
  ],
  receiptRequiredAbove: '5.000',
};

/** Expense claims (docs/modules/expenses.md). */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly identity: IdentityService,
    private readonly storage: ObjectStorage,
  ) {}

  // --- settings ------------------------------------------------------------------------------

  private async settingsOf(tx: TenantTransaction): Promise<ExpenseSettings> {
    const [row] = await tx
      .select()
      .from(companySettings)
      .where(eq(companySettings.key, 'expenses'));
    const parsed = expenseSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...(row?.value as object | undefined),
    });
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async settings(access: AccessContext) {
    return this.database.withTenant(access.tenantId, (tx) => this.settingsOf(tx));
  }

  async updateSettings(
    req: Request,
    access: AccessContext,
    input: { [K in keyof ExpenseSettings]?: ExpenseSettings[K] | undefined },
  ) {
    if (!this.has(access, 'expenses.settings.manage', 'company')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.settingsOf(tx);
      const value: ExpenseSettings = {
        categories: input.categories ?? current.categories,
        receiptRequiredAbove: input.receiptRequiredAbove ?? current.receiptRequiredAbove,
      };
      if (new Set(value.categories.map((c) => c.code)).size !== value.categories.length)
        throw invalid('categories', 'duplicate');
      if (!value.categories.some((c) => c.active)) throw invalid('categories', 'none_active');
      await tx
        .insert(companySettings)
        .values({
          tenantId: access.tenantId,
          key: 'expenses',
          value,
          updatedByUserId: access.userId,
        })
        .onConflictDoUpdate({
          target: [companySettings.tenantId, companySettings.key],
          set: { value, updatedByUserId: access.userId },
        });
      await this.record(tx, req, access, 'settings', access.tenantId, 'expenses.settings.updated', {
        fields: Object.keys(input),
      });
      return value;
    });
  }

  // --- access --------------------------------------------------------------------------------

  private has(access: AccessContext, permission: Permission, scope: 'own' | 'team' | 'company') {
    return hasPermission(access.permissions, permission, scope);
  }

  /** Whose claims I may see: null = everyone. */
  private async visible(tx: TenantTransaction, access: AccessContext): Promise<Set<string> | null> {
    if (this.has(access, 'expenses.claim.read', 'company')) return null;
    const set = this.has(access, 'expenses.claim.read', 'team')
      ? await teamScopeOf(tx, access.membershipId)
      : new Set<string>();
    set.add(access.membershipId);
    return set;
  }

  private async mayDecide(tx: TenantTransaction, access: AccessContext, membershipId: string) {
    if (membershipId === access.membershipId) return false;
    if (this.has(access, 'expenses.claim.approve', 'company')) return true;
    return (
      this.has(access, 'expenses.claim.approve', 'team') &&
      (await teamScopeOf(tx, access.membershipId)).has(membershipId)
    );
  }

  private mayReimburse(access: AccessContext, claim: ClaimRow) {
    return (
      claim.membershipId !== access.membershipId &&
      this.has(access, 'expenses.claim.reimburse', 'company')
    );
  }

  /** The claim, if I may see it (404 otherwise — its existence is not revealed). */
  private async load(tx: TenantTransaction, access: AccessContext, id: string, lock = false) {
    const query = tx.select().from(expenseClaims).where(eq(expenseClaims.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    const visible = await this.visible(tx, access);
    if (visible && !visible.has(row.membershipId)) throw notFound();
    return row;
  }

  // --- claims --------------------------------------------------------------------------------

  async list(
    access: AccessContext,
    query: { view: 'mine' | 'approvals' | 'reimburse' | 'all'; status?: string | undefined },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const conditions: (SQL | undefined)[] = [
        query.status ? eq(expenseClaims.status, query.status as 'draft') : undefined,
      ];
      if (query.view === 'mine')
        conditions.push(eq(expenseClaims.membershipId, access.membershipId));
      if (query.view === 'approvals') {
        conditions.push(
          eq(expenseClaims.status, 'submitted'),
          ne(expenseClaims.membershipId, access.membershipId),
        );
        if (!this.has(access, 'expenses.claim.approve', 'company')) {
          if (!this.has(access, 'expenses.claim.approve', 'team')) return { items: [] };
          const scope = [...(await teamScopeOf(tx, access.membershipId))];
          if (scope.length === 0) return { items: [] };
          conditions.push(inArray(expenseClaims.membershipId, scope));
        }
      }
      if (query.view === 'reimburse') {
        if (!this.has(access, 'expenses.claim.reimburse', 'company')) return { items: [] };
        conditions.push(
          eq(expenseClaims.status, 'approved'),
          ne(expenseClaims.membershipId, access.membershipId),
        );
      }
      if (query.view === 'all') {
        const visible = await this.visible(tx, access);
        if (visible) conditions.push(inArray(expenseClaims.membershipId, [...visible]));
      }
      const rows = await tx
        .select()
        .from(expenseClaims)
        .where(and(...conditions))
        .orderBy(desc(expenseClaims.updatedAt))
        .limit(300);
      const counts = await this.lineCounts(
        tx,
        rows.map((r) => r.id),
      );
      const names = await this.namesOf(
        tx,
        rows.map((r) => r.membershipId),
      );
      return { items: rows.map((r) => this.toSummary(r, names, counts.get(r.id) ?? 0)) };
    });
  }

  async get(access: AccessContext, id: string): Promise<ExpenseClaim> {
    return this.database.withTenant(access.tenantId, async (tx) =>
      this.toClaim(tx, access, await this.load(tx, access, id)),
    );
  }

  async create(
    req: Request,
    access: AccessContext,
    input: { title: string; lines?: LineInput[] | undefined },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .insert(expenseClaims)
        .values({
          tenantId: access.tenantId,
          membershipId: access.membershipId,
          title: input.title,
        })
        .returning();
      if (!row) throw new Error('expense claim insert returned nothing');
      const saved = await this.writeLines(tx, access, row, input.lines ?? []);
      await this.record(tx, req, access, 'expense_claim', row.id, 'expenses.claim.created', {
        lines: input.lines?.length ?? 0,
      });
      return this.toClaim(tx, access, saved);
    });
  }

  async update(
    req: Request,
    access: AccessContext,
    id: string,
    input: { title?: string | undefined; lines?: LineInput[] | undefined; version: number },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.ownDraft(tx, access, id);
      if (current.version !== input.version)
        throw conflict('version', 'stale', 'Someone changed this claim; reload it.');
      const [row] = await tx
        .update(expenseClaims)
        .set({ title: input.title ?? current.title, version: current.version + 1 })
        .where(eq(expenseClaims.id, id))
        .returning();
      if (!row) throw notFound();
      const saved = input.lines ? await this.writeLines(tx, access, row, input.lines) : row;
      await this.record(tx, req, access, 'expense_claim', id, 'expenses.claim.updated');
      return this.toClaim(tx, access, saved);
    });
  }

  async remove(req: Request, access: AccessContext, id: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.ownDraft(tx, access, id);
      await tx.delete(expenseClaims).where(eq(expenseClaims.id, id));
      await this.record(tx, req, access, 'expense_claim', id, 'expenses.claim.deleted');
    });
  }

  async submit(req: Request, access: AccessContext, id: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.ownDraft(tx, access, id);
      const lines = await tx
        .select({ line: expenseLines, file: files })
        .from(expenseLines)
        .leftJoin(files, eq(files.id, expenseLines.receiptFileId))
        .where(eq(expenseLines.claimId, id));
      if (lines.length === 0) throw invalid('lines', 'empty');
      const settings = await this.settingsOf(tx);
      const threshold = kwdToFils(settings.receiptRequiredAbove);
      for (const { line, file } of lines) {
        if (kwdToFils(line.amount) > threshold && !file) throw invalid('lines', 'receipt_required');
        if (file?.status === 'infected') throw invalid('lines', 'receipt_infected');
      }
      const number =
        current.number ?? (await nextDocumentNumber(tx, access.tenantId, 'expense', 'EX'));
      const [row] = await tx
        .update(expenseClaims)
        .set({
          status: 'submitted',
          number,
          submittedAt: new Date(),
          decidedByMembershipId: null,
          decidedAt: null,
          decisionNote: null,
          version: current.version + 1,
        })
        .where(eq(expenseClaims.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, 'expense_claim', id, 'expenses.claim.submitted', {
        number,
        total: row.total,
      });
      await this.notifier.notify(tx, req, {
        tenantId: access.tenantId,
        type: 'expenses.submitted',
        recipients: await this.approversOf(tx, access),
        params: {
          name: (await this.namesOf(tx, [access.membershipId])).get(access.membershipId) ?? '',
          number,
          total: row.total,
        },
        link: `/expenses/${id}`,
        actor: { userId: access.userId, membershipId: access.membershipId },
      });
      return this.toClaim(tx, access, row);
    });
  }

  async decide(
    req: Request,
    access: AccessContext,
    id: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (!(await this.mayDecide(tx, access, current.membershipId))) throw forbidden();
      if (current.status !== 'submitted')
        throw conflict('status', 'not_submitted', 'Only submitted claims can be decided.');
      const [row] = await tx
        .update(expenseClaims)
        .set({
          status: decision,
          decidedByMembershipId: access.membershipId,
          decidedAt: new Date(),
          decisionNote: note ?? null,
          version: current.version + 1,
        })
        .where(eq(expenseClaims.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(
        tx,
        req,
        access,
        'expense_claim',
        id,
        decision === 'approved' ? 'expenses.claim.approved' : 'expenses.claim.rejected',
        { total: row.total },
      );
      await this.tellClaimant(tx, req, access, row, 'expenses.decided', { status: decision });
      return this.toClaim(tx, access, row);
    });
  }

  /** A rejected claim goes back to draft so the claimant can fix it (it keeps its number). */
  async reopen(req: Request, access: AccessContext, id: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (current.membershipId !== access.membershipId) throw forbidden();
      if (current.status !== 'rejected')
        throw conflict('status', 'not_rejected', 'Only rejected claims can be reopened.');
      const [row] = await tx
        .update(expenseClaims)
        .set({ status: 'draft', version: current.version + 1 })
        .where(eq(expenseClaims.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, 'expense_claim', id, 'expenses.claim.reopened');
      return this.toClaim(tx, access, row);
    });
  }

  async reimburse(
    req: Request,
    access: AccessContext,
    id: string,
    input: {
      reimbursedOn: string;
      method: 'bank_transfer' | 'cash' | 'cheque' | 'other';
      reference?: string | undefined;
    },
  ) {
    if (!this.has(access, 'expenses.claim.reimburse', 'company')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (!this.mayReimburse(access, current)) throw forbidden();
      if (current.status !== 'approved')
        throw conflict('status', 'not_approved', 'Only approved claims can be reimbursed.');
      if (current.decidedAt && input.reimbursedOn < current.decidedAt.toISOString().slice(0, 10))
        throw invalid('reimbursedOn', 'before_approval');
      const [row] = await tx
        .update(expenseClaims)
        .set({
          status: 'reimbursed',
          reimbursedByMembershipId: access.membershipId,
          reimbursedOn: input.reimbursedOn,
          reimbursementMethod: input.method,
          reimbursementReference: input.reference ?? '',
          version: current.version + 1,
        })
        .where(eq(expenseClaims.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, 'expense_claim', id, 'expenses.claim.reimbursed', {
        total: row.total,
        method: input.method,
      });
      await this.tellClaimant(tx, req, access, row, 'expenses.reimbursed', {});
      return this.toClaim(tx, access, row);
    });
  }

  async receiptDownload(req: Request, access: AccessContext, id: string, lineId: string) {
    const file = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, id);
      const [row] = await tx
        .select({ file: files })
        .from(expenseLines)
        .innerJoin(files, eq(files.id, expenseLines.receiptFileId))
        .where(and(eq(expenseLines.claimId, id), eq(expenseLines.id, lineId)));
      if (!row) throw notFound();
      if (row.file.status !== 'clean')
        throw new AppError('FILE_NOT_READY', HttpStatus.CONFLICT, messageFor('FILE_NOT_READY'));
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'files.file.downloaded',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'file', id: row.file.id },
        details: { expenseClaimId: id },
      });
      return row.file;
    });
    const url = await this.storage.downloadUrl(file.storageKey, file.displayName, file.contentType);
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  /** A project's expense cost: company expense readers, or the project's manager. */
  async forProject(access: AccessContext, projectId: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
      if (!project) throw notFound();
      if (
        !this.has(access, 'expenses.claim.read', 'company') &&
        project.managerMembershipId !== access.membershipId
      )
        throw forbidden();
      const rows = await tx
        .select({ line: expenseLines, claim: expenseClaims })
        .from(expenseLines)
        .innerJoin(expenseClaims, eq(expenseClaims.id, expenseLines.claimId))
        .where(
          and(
            eq(expenseLines.projectId, projectId),
            inArray(expenseClaims.status, ['submitted', 'approved', 'reimbursed']),
          ),
        )
        .orderBy(desc(expenseLines.spentOn));
      const billed = await this.billedLines(
        tx,
        rows.map((r) => r.line.id),
      );
      const settings = await this.settingsOf(tx);
      const names = await this.namesOf(
        tx,
        rows.map((r) => r.claim.membershipId),
      );
      let approved = 0n;
      let billable = 0n;
      let invoiced = 0n;
      let pending = 0n;
      for (const { line, claim } of rows) {
        const fils = kwdToFils(line.amount);
        if (claim.status === 'submitted') {
          pending += fils;
          continue;
        }
        approved += fils;
        if (line.billable) billable += fils;
        if (billed.has(line.id)) invoiced += fils;
      }
      return {
        approved: filsToKwd(approved),
        billable: filsToKwd(billable),
        invoiced: filsToKwd(invoiced),
        pending: filsToKwd(pending),
        lines: rows.map(({ line, claim }) => ({
          id: line.id,
          claimId: claim.id,
          claimNumber: claim.number,
          spentOn: line.spentOn,
          person: names.get(claim.membershipId) ?? '',
          category: this.categoryName(settings, line.category),
          description: line.description,
          amount: line.amount,
          billable: line.billable,
          invoiced: billed.has(line.id),
          status: claim.status,
        })),
      };
    });
  }

  /** Dashboard numbers (anyone who can claim). */
  async dashboard(tx: TenantTransaction, access: AccessContext) {
    const mine = await tx
      .select({ id: expenseClaims.id })
      .from(expenseClaims)
      .where(
        and(
          eq(expenseClaims.membershipId, access.membershipId),
          inArray(expenseClaims.status, ['draft', 'submitted', 'approved', 'rejected']),
        ),
      );
    let waitingForMe: number | null = null;
    const company = this.has(access, 'expenses.claim.approve', 'company');
    if (company || this.has(access, 'expenses.claim.approve', 'team')) {
      const pending = await tx
        .select({ id: expenseClaims.membershipId })
        .from(expenseClaims)
        .where(
          and(
            eq(expenseClaims.status, 'submitted'),
            ne(expenseClaims.membershipId, access.membershipId),
          ),
        );
      const scope = company ? null : await teamScopeOf(tx, access.membershipId);
      waitingForMe = pending.filter((p) => !scope || scope.has(p.id)).length;
    }
    let toReimburse: { count: number; amount: string } | null = null;
    if (this.has(access, 'expenses.claim.reimburse', 'company')) {
      const approved = await tx
        .select({ total: expenseClaims.total })
        .from(expenseClaims)
        .where(eq(expenseClaims.status, 'approved'));
      toReimburse = {
        count: approved.length,
        amount: filsToKwd(approved.reduce((t, r) => t + kwdToFils(r.total), 0n)),
      };
    }
    return { mineOpen: mine.length, waitingForMe, toReimburse };
  }

  // --- helpers -------------------------------------------------------------------------------

  private async ownDraft(tx: TenantTransaction, access: AccessContext, id: string) {
    const current = await this.load(tx, access, id, true);
    if (current.membershipId !== access.membershipId) throw forbidden();
    if (current.status !== 'draft')
      throw conflict('status', 'not_draft', 'Only drafts can be changed.');
    return current;
  }

  /** Replaces the lines of a draft and recomputes its total exactly. */
  private async writeLines(
    tx: TenantTransaction,
    access: AccessContext,
    claim: ClaimRow,
    lines: LineInput[],
  ) {
    const settings = await this.settingsOf(tx);
    const active = new Set(settings.categories.filter((c) => c.active).map((c) => c.code));
    const existing = await tx
      .select({ receiptFileId: expenseLines.receiptFileId })
      .from(expenseLines)
      .where(eq(expenseLines.claimId, claim.id));
    const kept = new Set(existing.map((e) => e.receiptFileId).filter(Boolean));
    const projectIds = [...new Set(lines.map((l) => l.projectId).filter((p): p is string => !!p))];
    const allowed = await this.projectsOpenTo(tx, access, projectIds);
    const receiptIds = [
      ...new Set(lines.map((l) => l.receiptFileId).filter((f): f is string => !!f)),
    ];
    const receipts =
      receiptIds.length === 0
        ? []
        : await tx
            .select({ id: files.id, uploadedBy: files.uploadedByUserId, status: files.status })
            .from(files)
            .where(inArray(files.id, receiptIds));
    let total = 0n;
    for (const [i, line] of lines.entries()) {
      if (!active.has(line.category)) throw invalid(`lines.${i}.category`, 'unknown');
      const fils = kwdToFils(line.amount);
      if (fils <= 0n || fils > MAX_LINE_FILS) throw invalid(`lines.${i}.amount`, 'out_of_range');
      if (line.billable && !line.projectId) throw invalid(`lines.${i}.projectId`, 'required');
      if (line.projectId && !allowed.has(line.projectId))
        throw invalid(`lines.${i}.projectId`, 'not_found');
      if (line.receiptFileId) {
        const file = receipts.find((r) => r.id === line.receiptFileId);
        // A receipt is a file I uploaded (or one already on this claim).
        if (!file || (file.uploadedBy !== access.userId && !kept.has(file.id)))
          throw invalid(`lines.${i}.receiptFileId`, 'not_found');
        if (file.status === 'infected') throw invalid(`lines.${i}.receiptFileId`, 'infected');
      }
      total += fils;
    }
    await tx.delete(expenseLines).where(eq(expenseLines.claimId, claim.id));
    if (lines.length > 0) {
      await tx.insert(expenseLines).values(
        lines.map((l, position) => ({
          tenantId: access.tenantId,
          claimId: claim.id,
          position,
          spentOn: l.spentOn,
          category: l.category,
          description: l.description,
          amount: l.amount,
          projectId: l.projectId ?? null,
          billable: l.billable ?? false,
          receiptFileId: l.receiptFileId ?? null,
        })),
      );
    }
    const [row] = await tx
      .update(expenseClaims)
      .set({ total: filsToKwd(total) })
      .where(eq(expenseClaims.id, claim.id))
      .returning();
    if (!row) throw notFound();
    return row;
  }

  /** Projects a claimant may charge: all for company project readers, else theirs. */
  private async projectsOpenTo(tx: TenantTransaction, access: AccessContext, ids: string[]) {
    if (ids.length === 0) return new Set<string>();
    const found = await tx
      .select({ id: projects.id, manager: projects.managerMembershipId })
      .from(projects)
      .where(inArray(projects.id, ids));
    if (hasPermission(access.permissions, 'projects.project.read', 'company'))
      return new Set(found.map((p) => p.id));
    const memberOf = await tx
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(
        and(
          inArray(projectMembers.projectId, ids),
          eq(projectMembers.membershipId, access.membershipId),
        ),
      );
    return new Set([
      ...found.filter((p) => p.manager === access.membershipId).map((p) => p.id),
      ...memberOf.map((m) => m.id),
    ]);
  }

  /** Direct manager and team leads of the claimant; Owner/CEO/Finance when there is none. */
  private async approversOf(tx: TenantTransaction, access: AccessContext) {
    const [employee] = await tx
      .select({ manager: employees.managerMembershipId })
      .from(employees)
      .where(eq(employees.membershipId, access.membershipId));
    const leads = await tx
      .select({ id: teams.leadMembershipId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.membershipId, access.membershipId), isNull(teams.archivedAt)));
    let ids = [
      ...new Set(
        [employee?.manager, ...leads.map((l) => l.id)].filter(
          (x): x is string => Boolean(x) && x !== access.membershipId,
        ),
      ),
    ];
    if (ids.length === 0) {
      ids = (
        await tx
          .selectDistinct({ id: memberships.id })
          .from(memberships)
          .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
          .where(
            and(
              eq(memberships.status, 'active'),
              inArray(membershipRoles.role, ['owner', 'ceo', 'finance']),
            ),
          )
      )
        .map((r) => r.id)
        .filter((id) => id !== access.membershipId);
    }
    if (ids.length === 0) return [];
    const users = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(inArray(memberships.id, ids), eq(memberships.status, 'active')));
    return users.map((u) => u.userId);
  }

  private async tellClaimant(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    row: ClaimRow,
    type: 'expenses.decided' | 'expenses.reimbursed',
    params: Record<string, string>,
  ) {
    const [owner] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.id, row.membershipId));
    if (!owner) return;
    await this.notifier.notify(tx, req, {
      tenantId: access.tenantId,
      type,
      recipients: [owner.userId],
      params: { number: row.number ?? '', total: row.total, ...params },
      link: `/expenses/${row.id}`,
      actor: { userId: access.userId, membershipId: access.membershipId },
    });
  }

  /** Lines re-billed on an invoice that is not void (void releases them). */
  private async billedLines(tx: TenantTransaction, lineIds: string[]) {
    if (lineIds.length === 0) return new Map<string, string | null>();
    const rows = await tx
      .select({ lineId: invoiceExpenseLines.expenseLineId, number: invoices.number })
      .from(invoiceExpenseLines)
      .innerJoin(invoices, eq(invoices.id, invoiceExpenseLines.invoiceId))
      .where(inArray(invoiceExpenseLines.expenseLineId, lineIds));
    return new Map(rows.map((r) => [r.lineId, r.number]));
  }

  private async lineCounts(tx: TenantTransaction, claimIds: string[]) {
    if (claimIds.length === 0) return new Map<string, number>();
    const rows = await tx
      .select({ claimId: expenseLines.claimId })
      .from(expenseLines)
      .where(inArray(expenseLines.claimId, claimIds));
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.claimId, (out.get(r.claimId) ?? 0) + 1);
    return out;
  }

  private categoryName(settings: ExpenseSettings, code: string) {
    const c = settings.categories.find((x) => x.code === code);
    return { en: c?.nameEn ?? code, ar: c?.nameAr ?? code };
  }

  private toSummary(r: ClaimRow, names: Map<string, string>, lineCount: number): ExpenseSummary {
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      person: { membershipId: r.membershipId, name: names.get(r.membershipId) ?? '' },
      status: r.status,
      currency: r.currency,
      total: r.total,
      lineCount,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async toClaim(
    tx: TenantTransaction,
    access: AccessContext,
    r: ClaimRow,
  ): Promise<ExpenseClaim> {
    const lines = await tx
      .select({ line: expenseLines, file: files, project: projects })
      .from(expenseLines)
      .leftJoin(files, eq(files.id, expenseLines.receiptFileId))
      .leftJoin(projects, eq(projects.id, expenseLines.projectId))
      .where(eq(expenseLines.claimId, r.id))
      .orderBy(asc(expenseLines.position));
    const settings = await this.settingsOf(tx);
    const billed = await this.billedLines(
      tx,
      lines.map((l) => l.line.id),
    );
    const names = await this.namesOf(
      tx,
      [r.membershipId, r.decidedByMembershipId, r.reimbursedByMembershipId].filter(
        (x): x is string => !!x,
      ),
    );
    const own = r.membershipId === access.membershipId;
    const decide = await this.mayDecide(tx, access, r.membershipId);
    return {
      ...this.toSummary(r, names, lines.length),
      lines: lines.map(({ line, file, project }) => ({
        id: line.id,
        spentOn: line.spentOn,
        category: { code: line.category, name: this.categoryName(settings, line.category) },
        description: line.description,
        amount: line.amount,
        project: project
          ? {
              id: project.id,
              number: project.number,
              name: { en: project.nameEn, ar: project.nameAr },
            }
          : null,
        billable: line.billable,
        receipt: file ? { id: file.id, name: file.displayName, status: file.status } : null,
        invoiceNumber: billed.get(line.id) ?? null,
        invoiced: billed.has(line.id),
      })),
      decidedByName: r.decidedByMembershipId ? (names.get(r.decidedByMembershipId) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      reimbursement:
        r.status === 'reimbursed' && r.reimbursedOn && r.reimbursementMethod
          ? {
              reimbursedOn: r.reimbursedOn,
              method: r.reimbursementMethod,
              reference: r.reimbursementReference,
              byName: r.reimbursedByMembershipId
                ? (names.get(r.reimbursedByMembershipId) ?? null)
                : null,
            }
          : null,
      actions: [
        ...(own && r.status === 'draft' ? (['edit', 'delete', 'submit'] as const) : []),
        ...(decide && r.status === 'submitted' ? (['approve', 'reject'] as const) : []),
        ...(own && r.status === 'rejected' ? (['reopen'] as const) : []),
        ...(this.mayReimburse(access, r) && r.status === 'approved'
          ? (['reimburse'] as const)
          : []),
      ],
      version: r.version,
    };
  }

  private async namesOf(tx: TenantTransaction, membershipIds: string[]) {
    const unique = [...new Set(membershipIds)];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await tx
      .select({ id: memberships.id, userId: memberships.userId })
      .from(memberships)
      .where(inArray(memberships.id, unique));
    const users = new Map(
      (await this.identity.userSummaries(rows.map((r) => r.userId))).map((u) => [u.id, u.name]),
    );
    return new Map(rows.map((r) => [r.id, users.get(r.userId) ?? ''] as const));
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
