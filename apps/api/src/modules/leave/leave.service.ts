import { HttpStatus, Injectable } from '@nestjs/common';
import {
  hasPermission,
  type LeaveRequest,
  type leaveApplicationSchema,
  type leaveTypeRequestSchema,
  type leaveTypeUpdateSchema,
} from '@ultimate-erp/contracts';
import {
  employees,
  files,
  leaveLedger,
  leaveRequests,
  leaveTypes,
  membershipRoles,
  memberships,
  publicHolidays,
  teamMembers,
  teams,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, type SQL } from 'drizzle-orm';
import { type Request } from 'express';
import { type z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { teamScopeOf } from '../people/people.service.js';
import { formatHours, hundredths } from '../projects/projects.service.js';

type TypeRow = typeof leaveTypes.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;
type RequestRow = typeof leaveRequests.$inferSelect;

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
const DAY = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Days as exact hundredths, like hours ("2.5" → 250n). */
const days = (s: string) => (s.startsWith('-') ? -hundredths(s.slice(1)) : hundredths(s));

/**
 * Starting policies for a new company. Values are our best understanding of Kuwaiti practice and
 * are flagged "to be verified by a Kuwaiti lawyer/accountant" until someone confirms them.
 */
const DEFAULT_TYPES = [
  {
    code: 'annual',
    nameEn: 'Annual leave',
    nameAr: 'إجازة سنوية',
    paid: true,
    deductsBalance: true,
    annualDays: '30',
    accrual: 'monthly',
    allowHalfDay: true,
    requiresDocument: false,
  },
  {
    code: 'sick',
    nameEn: 'Sick leave',
    nameAr: 'إجازة مرضية',
    paid: true,
    deductsBalance: true,
    annualDays: '15',
    accrual: 'none',
    allowHalfDay: true,
    requiresDocument: true,
  },
  {
    code: 'unpaid',
    nameEn: 'Unpaid leave',
    nameAr: 'إجازة بدون راتب',
    paid: false,
    deductsBalance: false,
    annualDays: '0',
    accrual: 'none',
    allowHalfDay: true,
    requiresDocument: false,
  },
  {
    code: 'maternity',
    nameEn: 'Maternity leave',
    nameAr: 'إجازة أمومة',
    paid: true,
    deductsBalance: true,
    annualDays: '70',
    accrual: 'none',
    allowHalfDay: false,
    requiresDocument: true,
  },
] as const;

/** Leave management (docs/modules/leave.md). */
@Injectable()
export class LeaveService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly identity: IdentityService,
  ) {}

  // --- policies ------------------------------------------------------------------------------

  private async ensureDefaults(tx: TenantTransaction, tenantId: string) {
    const [any] = await tx.select({ id: leaveTypes.id }).from(leaveTypes).limit(1);
    if (any) return;
    await tx
      .insert(leaveTypes)
      .values(DEFAULT_TYPES.map((t) => ({ tenantId, ...t })))
      .onConflictDoNothing();
  }

  async types(access: AccessContext) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.ensureDefaults(tx, access.tenantId);
      const rows = await tx
        .select()
        .from(leaveTypes)
        .orderBy(asc(leaveTypes.createdAt), asc(leaveTypes.code));
      return { items: rows.map((r) => this.toType(r)) };
    });
  }

  async createType(
    req: Request,
    access: AccessContext,
    input: z.output<typeof leaveTypeRequestSchema>,
  ) {
    this.assertPolicy(access);
    try {
      await this.database.withTenant(access.tenantId, async (tx) => {
        await this.ensureDefaults(tx, access.tenantId);
        const [row] = await tx
          .insert(leaveTypes)
          .values({ tenantId: access.tenantId, ...input, toVerify: false })
          .returning();
        await this.record(tx, req, access, 'leave_type', row?.id ?? '', 'leave.type.created', {
          code: input.code,
        });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('code', 'exists', 'A leave type with this code exists.');
      throw err;
    }
    return this.types(access);
  }

  async updateType(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof leaveTypeUpdateSchema>,
  ) {
    this.assertPolicy(access);
    await this.database.withTenant(access.tenantId, async (tx) => {
      const { archived, confirmVerified, ...fields } = input;
      const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const updated = await tx
        .update(leaveTypes)
        .set({
          ...changes,
          ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
          // Confirming that a professional checked the values removes the "to be verified" flag.
          ...(confirmVerified !== undefined ? { toVerify: !confirmVerified } : {}),
        })
        .where(eq(leaveTypes.id, id))
        .returning();
      if (updated.length === 0) throw notFound();
      await this.record(tx, req, access, 'leave_type', id, 'leave.type.updated', {
        fields: Object.keys(input),
        ...(confirmVerified ? { verified: true } : {}),
      });
    });
    return this.types(access);
  }

  async holidays(access: AccessContext, year: number) {
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select()
        .from(publicHolidays)
        .where(
          and(gte(publicHolidays.date, `${year}-01-01`), lte(publicHolidays.date, `${year}-12-31`)),
        )
        .orderBy(asc(publicHolidays.date)),
    );
    return { items: rows.map((h) => ({ date: h.date, nameEn: h.nameEn, nameAr: h.nameAr })) };
  }

  async setHolidays(
    req: Request,
    access: AccessContext,
    year: number,
    list: { date: string; nameEn: string; nameAr: string }[],
  ) {
    this.assertPolicy(access);
    if (list.some((h) => !h.date.startsWith(`${year}-`))) throw invalid('holidays', 'other_year');
    if (new Set(list.map((h) => h.date)).size !== list.length)
      throw invalid('holidays', 'duplicate');
    await this.database.withTenant(access.tenantId, async (tx) => {
      await tx
        .delete(publicHolidays)
        .where(
          and(gte(publicHolidays.date, `${year}-01-01`), lte(publicHolidays.date, `${year}-12-31`)),
        );
      if (list.length > 0)
        await tx
          .insert(publicHolidays)
          .values(list.map((h) => ({ tenantId: access.tenantId, ...h })));
      await this.record(tx, req, access, 'holidays', access.tenantId, 'leave.holidays.updated', {
        year,
        count: list.length,
      });
    });
    return this.holidays(access, year);
  }

  private assertPolicy(access: AccessContext) {
    if (!hasPermission(access.permissions, 'leave.policy.manage', 'company')) throw forbidden();
  }

  // --- counting ------------------------------------------------------------------------------

  /** Working days (in hundredths) between two dates for this person, minus public holidays. */
  private async workingDays(
    tx: TenantTransaction,
    employee: EmployeeRow,
    start: string,
    end: string,
    halfDay: string,
  ) {
    const holidays = new Set(
      (
        await tx
          .select({ date: publicHolidays.date })
          .from(publicHolidays)
          .where(and(gte(publicHolidays.date, start), lte(publicHolidays.date, end)))
      ).map((h) => h.date),
    );
    const perYear = new Map<number, bigint>();
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!employee.workDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) || holidays.has(d))
        continue;
      const y = Number(d.slice(0, 4));
      perYear.set(y, (perYear.get(y) ?? 0n) + (halfDay === 'none' ? 100n : 50n));
    }
    return perYear;
  }

  /** Entitlement accrued in `year` up to today (docs/modules/leave.md §4). */
  private accrued(type: TypeRow, employee: EmployeeRow, year: number) {
    if (!type.deductsBalance) return 0n;
    const annual = hundredths(type.annualDays);
    const join = employee.joinDate;
    const joinYear = join ? Number(join.slice(0, 4)) : 0;
    if (joinYear > year) return 0n;
    const startMonth = joinYear === year && join ? Number(join.slice(5, 7)) - 1 : 0;
    if (type.accrual === 'none') return annual;
    if (type.accrual === 'yearly') return (annual * BigInt(12 - startMonth)) / 12n;
    const today = kuwaitToday();
    const thisYear = Number(today.slice(0, 4));
    const completed = year < thisYear ? 12 : year === thisYear ? Number(today.slice(5, 7)) - 1 : 0;
    return (annual * BigInt(Math.max(0, completed - startMonth))) / 12n;
  }

  private async balanceOf(
    tx: TenantTransaction,
    type: TypeRow,
    employee: EmployeeRow,
    year: number,
  ) {
    const ledger = await tx
      .select()
      .from(leaveLedger)
      .where(
        and(
          eq(leaveLedger.membershipId, employee.membershipId),
          eq(leaveLedger.leaveTypeId, type.id),
          eq(leaveLedger.year, year),
        ),
      );
    const sumOf = (kinds: string[]) =>
      ledger.filter((l) => kinds.includes(l.kind)).reduce((t, l) => t + days(l.days), 0n);
    const pendingRows = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.membershipId, employee.membershipId),
          eq(leaveRequests.leaveTypeId, type.id),
          eq(leaveRequests.status, 'pending'),
        ),
      );
    let pending = 0n;
    for (const p of pendingRows)
      pending +=
        (await this.workingDays(tx, employee, p.startDate, p.endDate, p.halfDay)).get(year) ?? 0n;
    const accrued = this.accrued(type, employee, year);
    const adjustments = sumOf(['adjustment']);
    const taken = -sumOf(['taken', 'restored']);
    return { accrued, adjustments, taken, pending, balance: accrued + adjustments - taken };
  }

  // --- access --------------------------------------------------------------------------------

  private async mayApprove(tx: TenantTransaction, access: AccessContext, membershipId: string) {
    if (membershipId === access.membershipId) return false;
    if (hasPermission(access.permissions, 'leave.request.approve', 'company')) return true;
    return (
      hasPermission(access.permissions, 'leave.request.approve', 'team') &&
      (await teamScopeOf(tx, access.membershipId)).has(membershipId)
    );
  }

  /** Whose leave I may see: null = everyone. */
  private async visible(tx: TenantTransaction, access: AccessContext): Promise<Set<string> | null> {
    if (hasPermission(access.permissions, 'leave.request.read', 'company')) return null;
    const set = hasPermission(access.permissions, 'leave.request.read', 'team')
      ? await teamScopeOf(tx, access.membershipId)
      : new Set<string>();
    set.add(access.membershipId);
    return set;
  }

  private async employeeOf(tx: TenantTransaction, membershipId: string, lock = false) {
    const query = tx.select().from(employees).where(eq(employees.membershipId, membershipId));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw invalid('membershipId', 'no_employee_record');
    return row;
  }

  // --- applications --------------------------------------------------------------------------

  async apply(req: Request, access: AccessContext, input: z.output<typeof leaveApplicationSchema>) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.ensureDefaults(tx, access.tenantId);
      // Locking the person serialises their applications and approvals (no double booking).
      const employee = await this.employeeOf(tx, access.membershipId, true);
      if (employee.status === 'left') throw forbidden();
      const [type] = await tx
        .select()
        .from(leaveTypes)
        .where(and(eq(leaveTypes.id, input.leaveTypeId), isNull(leaveTypes.archivedAt)));
      if (!type) throw invalid('leaveTypeId', 'not_found');
      const halfDay = input.halfDay ?? 'none';
      const perYear = await this.workingDays(tx, employee, input.startDate, input.endDate, halfDay);
      const total = [...perYear.values()].reduce((t, d) => t + d, 0n);
      const problems: (
        | 'insufficient_balance'
        | 'overlap'
        | 'no_working_days'
        | 'document_required'
        | 'half_day_not_allowed'
      )[] = [];
      if (total === 0n) problems.push('no_working_days');
      if (halfDay !== 'none' && !type.allowHalfDay) problems.push('half_day_not_allowed');
      if (type.requiresDocument && !input.fileId) problems.push('document_required');
      const [overlap] = await tx
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.membershipId, access.membershipId),
            inArray(leaveRequests.status, ['pending', 'approved']),
            lte(leaveRequests.startDate, input.endDate),
            gte(leaveRequests.endDate, input.startDate),
          ),
        );
      if (overlap) problems.push('overlap');
      let before: bigint | null = null;
      let after: bigint | null = null;
      if (type.deductsBalance) {
        const year = Number(input.startDate.slice(0, 4));
        const b = await this.balanceOf(tx, type, employee, year);
        before = b.balance - b.pending;
        after = before - total;
        if (after < 0n && !type.allowNegative) problems.push('insufficient_balance');
      }
      const preview = {
        days: formatHours(total),
        balanceBefore: before === null ? null : this.signed(before),
        balanceAfter: after === null ? null : this.signed(after),
        problems,
      };
      if (input.preview) return { preview };
      if (problems.length > 0) {
        const first = problems[0] ?? 'invalid';
        if (first === 'overlap')
          throw conflict('startDate', 'overlap', 'You already have leave on these dates.');
        throw invalid(
          first === 'document_required'
            ? 'fileId'
            : first === 'half_day_not_allowed'
              ? 'halfDay'
              : 'days',
          first,
        );
      }
      if (input.fileId) {
        const [file] = await tx
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.id, input.fileId),
              eq(files.uploadedByUserId, access.userId),
              ne(files.status, 'infected'),
            ),
          );
        if (!file) throw invalid('fileId', 'not_found');
      }
      const [row] = await tx
        .insert(leaveRequests)
        .values({
          tenantId: access.tenantId,
          membershipId: access.membershipId,
          leaveTypeId: type.id,
          startDate: input.startDate,
          endDate: input.endDate,
          halfDay,
          days: formatHours(total),
          reason: input.reason ?? '',
          fileId: input.fileId ?? null,
        })
        .returning();
      if (!row) throw new Error('leave insert returned nothing');
      await this.record(tx, req, access, 'leave_request', row.id, 'leave.request.created', {
        days: row.days,
        type: type.code,
      });
      await this.notifier.notify(tx, req, {
        tenantId: access.tenantId,
        type: 'leave.requested',
        recipients: await this.approversOf(tx, access, employee),
        params: {
          name: await this.nameOfUser(access.userId),
          from: row.startDate,
          to: row.endDate,
          type: type.nameEn,
          typeAr: type.nameAr,
        },
        link: '/leave?view=approvals',
        actor: { userId: access.userId, membershipId: access.membershipId },
      });
      return { request: await this.toRequest(tx, access, row) };
    });
  }

  async decide(
    req: Request,
    access: AccessContext,
    id: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) {
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const current = await this.requestFor(tx, id);
        const employee = await this.employeeOf(tx, current.membershipId, true);
        const [row] = await tx
          .select()
          .from(leaveRequests)
          .where(eq(leaveRequests.id, id))
          .for('update');
        if (!row) throw notFound();
        if (!(await this.mayApprove(tx, access, row.membershipId))) {
          if (row.membershipId === access.membershipId) throw forbidden();
          if (!(await this.canSee(tx, access, row.membershipId))) throw notFound();
          throw forbidden();
        }
        if (row.status !== 'pending')
          throw conflict('status', 'not_pending', 'Only pending requests can be decided.');
        const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, row.leaveTypeId));
        if (!type) throw notFound();
        if (decision === 'approved' && type.deductsBalance) {
          const perYear = await this.workingDays(
            tx,
            employee,
            row.startDate,
            row.endDate,
            row.halfDay,
          );
          for (const [year, d] of perYear) {
            const b = await this.balanceOf(tx, type, employee, year);
            if (b.balance - d < 0n && !type.allowNegative)
              throw invalid('days', 'insufficient_balance');
            await tx.insert(leaveLedger).values({
              tenantId: access.tenantId,
              membershipId: row.membershipId,
              leaveTypeId: type.id,
              year,
              kind: 'taken',
              days: `-${formatHours(d)}`,
              requestId: id,
              createdByUserId: access.userId,
            });
          }
        }
        const [updated] = await tx
          .update(leaveRequests)
          .set({
            status: decision,
            decidedByUserId: access.userId,
            decidedAt: new Date(),
            decisionNote: note ?? null,
            version: row.version + 1,
          })
          .where(eq(leaveRequests.id, id))
          .returning();
        if (!updated) throw notFound();
        await this.record(
          tx,
          req,
          access,
          'leave_request',
          id,
          decision === 'approved' ? 'leave.request.approved' : 'leave.request.rejected',
          { days: row.days },
        );
        await this.tellApplicant(
          tx,
          req,
          access,
          updated,
          decision === 'approved' ? 'leave.approved' : 'leave.rejected',
        );
        return this.toRequest(tx, access, updated);
      });
    } catch (err) {
      // A second approval racing the first would deduct twice — the ledger's unique key stops it.
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('status', 'not_pending', 'Only pending requests can be decided.');
      throw err;
    }
  }

  async withdraw(req: Request, access: AccessContext, id: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, id))
        .for('update');
      if (!row || row.membershipId !== access.membershipId) throw notFound();
      if (row.status !== 'pending')
        throw conflict('status', 'not_pending', 'Only pending requests can be withdrawn.');
      const [updated] = await tx
        .update(leaveRequests)
        .set({ status: 'withdrawn', version: row.version + 1 })
        .where(eq(leaveRequests.id, id))
        .returning();
      if (!updated) throw notFound();
      await this.record(tx, req, access, 'leave_request', id, 'leave.request.withdrawn');
      return this.toRequest(tx, access, updated);
    });
  }

  /** Cancels approved leave (applicant before it starts, or an approver) and restores the balance once. */
  async cancel(req: Request, access: AccessContext, id: string, note?: string) {
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const current = await this.requestFor(tx, id);
        await this.employeeOf(tx, current.membershipId, true);
        const [row] = await tx
          .select()
          .from(leaveRequests)
          .where(eq(leaveRequests.id, id))
          .for('update');
        if (!row) throw notFound();
        const own = row.membershipId === access.membershipId;
        const approver = await this.mayApprove(tx, access, row.membershipId);
        if (!own && !approver) {
          if (!(await this.canSee(tx, access, row.membershipId))) throw notFound();
          throw forbidden();
        }
        if (row.status !== 'approved')
          throw conflict('status', 'not_approved', 'Only approved leave can be cancelled.');
        if (!approver && row.startDate <= kuwaitToday())
          throw conflict(
            'startDate',
            'started',
            'Leave that has started can only be cancelled by an approver.',
          );
        if (approver && !own && !note) throw invalid('note', 'required');
        const taken = await tx
          .select()
          .from(leaveLedger)
          .where(and(eq(leaveLedger.requestId, id), eq(leaveLedger.kind, 'taken')));
        for (const t of taken) {
          await tx.insert(leaveLedger).values({
            tenantId: access.tenantId,
            membershipId: t.membershipId,
            leaveTypeId: t.leaveTypeId,
            year: t.year,
            kind: 'restored',
            days: t.days.replace(/^-/, ''),
            requestId: id,
            note: note ?? '',
            createdByUserId: access.userId,
          });
        }
        const [updated] = await tx
          .update(leaveRequests)
          .set({
            status: 'cancelled',
            decisionNote: note ?? row.decisionNote,
            version: row.version + 1,
          })
          .where(eq(leaveRequests.id, id))
          .returning();
        if (!updated) throw notFound();
        await this.record(tx, req, access, 'leave_request', id, 'leave.request.cancelled', {
          restored: taken.length > 0,
        });
        if (!own) await this.tellApplicant(tx, req, access, updated, 'leave.cancelled');
        return this.toRequest(tx, access, updated);
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('status', 'not_approved', 'Only approved leave can be cancelled.');
      throw err;
    }
  }

  async list(
    access: AccessContext,
    query: {
      view: 'mine' | 'approvals' | 'person';
      membershipId?: string | undefined;
      status?: string | undefined;
    },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const conditions: (SQL | undefined)[] = [
        query.status ? eq(leaveRequests.status, query.status as 'pending') : undefined,
      ];
      if (query.view === 'mine')
        conditions.push(eq(leaveRequests.membershipId, access.membershipId));
      if (query.view === 'person') {
        if (!query.membershipId || !(await this.canSee(tx, access, query.membershipId)))
          throw notFound();
        conditions.push(eq(leaveRequests.membershipId, query.membershipId));
      }
      if (query.view === 'approvals') {
        conditions.push(
          eq(leaveRequests.status, 'pending'),
          ne(leaveRequests.membershipId, access.membershipId),
        );
        if (!hasPermission(access.permissions, 'leave.request.approve', 'company')) {
          if (!hasPermission(access.permissions, 'leave.request.approve', 'team'))
            return { items: [] };
          const scope = [...(await teamScopeOf(tx, access.membershipId))];
          if (scope.length === 0) return { items: [] };
          conditions.push(inArray(leaveRequests.membershipId, scope));
        }
      }
      const rows = await tx
        .select()
        .from(leaveRequests)
        .where(and(...conditions))
        .orderBy(desc(leaveRequests.startDate))
        .limit(300);
      return { items: await Promise.all(rows.map((r) => this.toRequest(tx, access, r))) };
    });
  }

  async balances(access: AccessContext, membershipId?: string, year?: number) {
    const target = membershipId ?? access.membershipId;
    const y = year ?? Number(kuwaitToday().slice(0, 4));
    const out = await this.database.withTenant(access.tenantId, async (tx) => {
      if (!(await this.canSee(tx, access, target))) throw notFound();
      await this.ensureDefaults(tx, access.tenantId);
      const employee = await this.employeeOf(tx, target);
      const types = await tx
        .select()
        .from(leaveTypes)
        .where(isNull(leaveTypes.archivedAt))
        .orderBy(asc(leaveTypes.createdAt), asc(leaveTypes.code));
      const items = [];
      for (const type of types) {
        const b = await this.balanceOf(tx, type, employee, y);
        items.push({
          type: {
            id: type.id,
            code: type.code,
            name: { en: type.nameEn, ar: type.nameAr },
            toVerify: type.toVerify,
          },
          deductsBalance: type.deductsBalance,
          accrued: formatHours(b.accrued),
          adjustments: this.signed(b.adjustments),
          taken: formatHours(b.taken),
          pending: formatHours(b.pending),
          balance: this.signed(b.balance),
        });
      }
      return items;
    });
    const names = await this.namesOf(access, [target]);
    return { year: y, person: { membershipId: target, name: names.get(target) ?? '' }, items: out };
  }

  async adjust(
    req: Request,
    access: AccessContext,
    input: { membershipId: string; leaveTypeId: string; year: number; days: string; note: string },
  ) {
    this.assertPolicy(access);
    if (days(input.days) === 0n) throw invalid('days', 'zero');
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.employeeOf(tx, input.membershipId);
      await tx.insert(leaveLedger).values({
        tenantId: access.tenantId,
        membershipId: input.membershipId,
        leaveTypeId: input.leaveTypeId,
        year: input.year,
        kind: 'adjustment',
        days: input.days,
        note: input.note,
        createdByUserId: access.userId,
      });
      await this.record(tx, req, access, 'employee', input.membershipId, 'leave.balance.adjusted', {
        days: input.days,
        year: input.year,
      });
    });
    return this.balances(access, input.membershipId, input.year);
  }

  async calendar(access: AccessContext, from: string, to: string) {
    const { rows, holidays } = await this.database.withTenant(access.tenantId, async (tx) => {
      const visible = await this.visible(tx, access);
      const found = await tx
        .select({ request: leaveRequests, type: leaveTypes })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(
          and(
            inArray(leaveRequests.status, ['pending', 'approved']),
            lte(leaveRequests.startDate, to),
            gte(leaveRequests.endDate, from),
          ),
        )
        .orderBy(asc(leaveRequests.startDate));
      return {
        rows: visible ? found.filter((r) => visible.has(r.request.membershipId)) : found,
        holidays: await tx
          .select()
          .from(publicHolidays)
          .where(and(gte(publicHolidays.date, from), lte(publicHolidays.date, to)))
          .orderBy(asc(publicHolidays.date)),
      };
    });
    const names = await this.namesOf(
      access,
      rows.map((r) => r.request.membershipId),
    );
    return {
      leave: rows.map(({ request, type }) => ({
        id: request.id,
        person: { membershipId: request.membershipId, name: names.get(request.membershipId) ?? '' },
        type: { en: type.nameEn, ar: type.nameAr },
        startDate: request.startDate,
        endDate: request.endDate,
        halfDay: request.halfDay,
        status: request.status as 'pending' | 'approved',
      })),
      holidays: holidays.map((h) => ({ date: h.date, nameEn: h.nameEn, nameAr: h.nameAr })),
    };
  }

  /** Dashboard numbers: who I may see is away today; how many requests wait for me. */
  async dashboard(tx: TenantTransaction, access: AccessContext) {
    const today = kuwaitToday();
    const visible = await this.visible(tx, access);
    const away = await tx
      .select({ id: leaveRequests.membershipId })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.status, 'approved'),
          lte(leaveRequests.startDate, today),
          gte(leaveRequests.endDate, today),
        ),
      );
    const onLeaveToday = new Set(away.map((a) => a.id).filter((id) => !visible || visible.has(id)))
      .size;
    let waitingForMe: number | null = null;
    const company = hasPermission(access.permissions, 'leave.request.approve', 'company');
    if (company || hasPermission(access.permissions, 'leave.request.approve', 'team')) {
      const pending = await tx
        .select({ id: leaveRequests.membershipId })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.status, 'pending'),
            ne(leaveRequests.membershipId, access.membershipId),
          ),
        );
      const scope = company ? null : await teamScopeOf(tx, access.membershipId);
      waitingForMe = pending.filter((p) => !scope || scope.has(p.id)).length;
    }
    return { onLeaveToday, waitingForMe };
  }

  // --- helpers -------------------------------------------------------------------------------

  private async canSee(tx: TenantTransaction, access: AccessContext, membershipId: string) {
    const visible = await this.visible(tx, access);
    return !visible || visible.has(membershipId);
  }

  private async requestFor(tx: TenantTransaction, id: string) {
    const [row] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    if (!row) throw notFound();
    return row;
  }

  /** Direct manager and team leads of the person; Owner/CEO/HR when there is none. */
  private async approversOf(tx: TenantTransaction, access: AccessContext, employee: EmployeeRow) {
    const leads = await tx
      .select({ id: teams.leadMembershipId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.membershipId, employee.membershipId), isNull(teams.archivedAt)));
    let ids = [
      ...new Set(
        [employee.managerMembershipId, ...leads.map((l) => l.id)].filter(
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
              inArray(membershipRoles.role, ['owner', 'ceo', 'hr_payroll']),
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

  private async tellApplicant(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    row: RequestRow,
    type: 'leave.approved' | 'leave.rejected' | 'leave.cancelled',
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
      params: { from: row.startDate, to: row.endDate },
      link: '/leave',
      actor: { userId: access.userId, membershipId: access.membershipId },
    });
  }

  private signed(h: bigint) {
    return h < 0n ? `-${formatHours(-h)}` : formatHours(h);
  }

  private toType(r: TypeRow) {
    return {
      id: r.id,
      code: r.code,
      name: { en: r.nameEn, ar: r.nameAr },
      paid: r.paid,
      deductsBalance: r.deductsBalance,
      annualDays: formatHours(hundredths(r.annualDays)),
      accrual: r.accrual,
      allowHalfDay: r.allowHalfDay,
      requiresDocument: r.requiresDocument,
      allowNegative: r.allowNegative,
      toVerify: r.toVerify,
      archived: r.archivedAt !== null,
    };
  }

  private async toRequest(
    tx: TenantTransaction,
    access: AccessContext,
    r: RequestRow,
  ): Promise<LeaveRequest> {
    const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, r.leaveTypeId));
    const names = await this.namesOf(access, [r.membershipId], tx);
    const decider = r.decidedByUserId
      ? ((await this.identity.userSummaries([r.decidedByUserId]))[0]?.name ?? null)
      : null;
    const own = r.membershipId === access.membershipId;
    const approver = await this.mayApprove(tx, access, r.membershipId);
    return {
      id: r.id,
      person: { membershipId: r.membershipId, name: names.get(r.membershipId) ?? '' },
      type: {
        id: r.leaveTypeId,
        code: type?.code ?? '',
        name: { en: type?.nameEn ?? '', ar: type?.nameAr ?? '' },
      },
      startDate: r.startDate,
      endDate: r.endDate,
      halfDay: r.halfDay,
      days: formatHours(hundredths(r.days)),
      reason: r.reason,
      hasDocument: r.fileId !== null,
      status: r.status,
      decidedByName: decider,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      actions: [
        ...(approver && r.status === 'pending' ? (['approve', 'reject'] as const) : []),
        ...(own && r.status === 'pending' ? (['withdraw'] as const) : []),
        ...(r.status === 'approved' && (approver || (own && r.startDate > kuwaitToday()))
          ? (['cancel'] as const)
          : []),
      ],
    };
  }

  private async namesOf(access: AccessContext, membershipIds: string[], tx?: TenantTransaction) {
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

  private async nameOfUser(userId: string) {
    return (await this.identity.userSummaries([userId]))[0]?.name ?? '';
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
