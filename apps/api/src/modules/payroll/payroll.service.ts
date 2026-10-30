import { HttpStatus, Injectable } from '@nestjs/common';
import {
  hasPermission,
  type PayrollRulesInput,
  payrollRulesSchema,
  type PayrollRun,
  type Payslip,
} from '@ultimate-erp/contracts';
import {
  employees,
  leaveRequests,
  leaveTypes,
  membershipRoles,
  memberships,
  payrollInputs,
  payrollRuleSets,
  payrollRuns,
  payslips,
  publicHolidays,
  salaryRecords,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { type Request } from 'express';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { calculatePayslip, filsToKwd, kwdToFils, type MonthInputs } from './engine.js';

type RunRow = typeof payrollRuns.$inferSelect;

const notFound = () => new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
const forbidden = () => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, messageFor('FORBIDDEN'));
const conflict = (path: string, code: string, message: string) =>
  new AppError('CONFLICT', HttpStatus.CONFLICT, message, [{ path, code }]);
const invalid = (path: string, code: string) =>
  new AppError(
    'VALIDATION_FAILED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    messageFor('VALIDATION_FAILED'),
    [{ path, code }],
  );
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthBounds = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
};

/**
 * Starting rules. Values that depend on Kuwaiti law start disabled or at 0; the planning
 * defaults are flagged "to be verified" with the whole rule set (docs/modules/payroll.md §2).
 */
const DEFAULT_RULES: PayrollRulesInput = {
  workingDaysDivisor: '26',
  monthlyHours: '208',
  overtime: { enabled: false, multiplier: '1.25' },
  unpaidLeave: { enabled: true },
  lateDeduction: { enabled: false },
  socialInsurance: { enabled: false, employeePercent: '0' },
};

/** Payroll (docs/modules/payroll.md). */
@Injectable()
export class PayrollService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly identity: IdentityService,
    private readonly attendance: AttendanceService,
  ) {}

  // --- access --------------------------------------------------------------------------------

  private may(
    access: AccessContext,
    permission:
      | 'payroll.run.prepare'
      | 'payroll.run.approve'
      | 'payroll.payslip.read'
      | 'exports.confidential',
  ) {
    return hasPermission(access.permissions, permission, 'company');
  }
  /** Who may open runs and salary data: preparers, approvers and company payslip readers. */
  private assertPayrollStaff(access: AccessContext) {
    if (
      !this.may(access, 'payroll.run.prepare') &&
      !this.may(access, 'payroll.run.approve') &&
      !this.may(access, 'payroll.payslip.read')
    )
      throw forbidden();
  }

  // --- rules ---------------------------------------------------------------------------------

  private async ensureRules(tx: TenantTransaction, access: AccessContext) {
    const [any] = await tx.select({ id: payrollRuleSets.id }).from(payrollRuleSets).limit(1);
    if (any) return;
    await tx
      .insert(payrollRuleSets)
      .values({
        tenantId: access.tenantId,
        version: 1,
        effectiveFrom: '2000-01-01',
        rules: DEFAULT_RULES,
        note: 'Starting values — to be verified by a Kuwaiti lawyer/accountant',
        createdByUserId: access.userId,
      })
      .onConflictDoNothing();
  }

  async ruleSets(access: AccessContext) {
    this.assertPayrollStaff(access);
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.ensureRules(tx, access);
      const rows = await tx.select().from(payrollRuleSets).orderBy(desc(payrollRuleSets.version));
      return {
        items: rows.map((r) => ({
          id: r.id,
          version: r.version,
          effectiveFrom: r.effectiveFrom,
          rules: payrollRulesSchema.parse(r.rules),
          toVerify: r.toVerify,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });
  }

  /** A change is always a new version; existing runs keep theirs. */
  async newRuleSet(
    req: Request,
    access: AccessContext,
    input: { effectiveFrom: string; rules: PayrollRulesInput; note: string },
  ) {
    if (!this.may(access, 'payroll.run.prepare')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.ensureRules(tx, access);
      const [latest] = await tx
        .select({ version: payrollRuleSets.version })
        .from(payrollRuleSets)
        .orderBy(desc(payrollRuleSets.version))
        .limit(1);
      const version = (latest?.version ?? 0) + 1;
      const [row] = await tx
        .insert(payrollRuleSets)
        .values({
          tenantId: access.tenantId,
          version,
          effectiveFrom: input.effectiveFrom,
          rules: input.rules,
          note: input.note,
          createdByUserId: access.userId,
        })
        .returning();
      await this.record(
        tx,
        req,
        access,
        'payroll_rule_set',
        row?.id ?? '',
        'payroll.rules.versioned',
        { version },
      );
    });
    return this.ruleSets(access);
  }

  /** Confirms a professional verified this version; only then can runs that use it be paid. */
  async verifyRuleSet(req: Request, access: AccessContext, id: string, note: string) {
    if (!this.may(access, 'payroll.run.approve')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      const updated = await tx
        .update(payrollRuleSets)
        .set({ toVerify: false })
        .where(eq(payrollRuleSets.id, id))
        .returning();
      if (updated.length === 0) throw notFound();
      await this.record(tx, req, access, 'payroll_rule_set', id, 'payroll.rules.verified', {
        note,
      });
    });
    return this.ruleSets(access);
  }

  private async ruleSetFor(tx: TenantTransaction, date: string) {
    const [row] = await tx
      .select()
      .from(payrollRuleSets)
      .where(lte(payrollRuleSets.effectiveFrom, date))
      .orderBy(desc(payrollRuleSets.effectiveFrom), desc(payrollRuleSets.version))
      .limit(1);
    if (!row) throw new Error('no payroll rule set');
    return row;
  }

  // --- salaries ------------------------------------------------------------------------------

  async salaries(req: Request, access: AccessContext, membershipId?: string) {
    if (!this.may(access, 'payroll.run.prepare') && !this.may(access, 'payroll.payslip.read'))
      throw forbidden();
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const found = await tx
        .select()
        .from(salaryRecords)
        .where(membershipId ? eq(salaryRecords.membershipId, membershipId) : undefined)
        .orderBy(asc(salaryRecords.membershipId), desc(salaryRecords.effectiveFrom));
      await this.record(
        tx,
        req,
        access,
        'salary_records',
        membershipId ?? access.tenantId,
        'payroll.salaries.read',
        { count: found.length },
      );
      return found;
    });
    const names = await this.namesOf(
      access,
      rows.map((r) => r.membershipId),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        person: { membershipId: r.membershipId, name: names.get(r.membershipId) ?? '' },
        effectiveFrom: r.effectiveFrom,
        basic: r.basic,
        currency: r.currency,
        allowances: r.allowances,
        socialInsurance: r.socialInsurance,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async addSalary(
    req: Request,
    access: AccessContext,
    input: {
      membershipId: string;
      effectiveFrom: string;
      basic: string;
      allowances: { code: string; label: string; amount: string }[];
      socialInsurance: boolean;
      note?: string | undefined;
    },
  ) {
    if (!this.may(access, 'payroll.run.prepare')) throw forbidden();
    try {
      await this.database.withTenant(access.tenantId, async (tx) => {
        const [employee] = await tx
          .select()
          .from(employees)
          .where(eq(employees.membershipId, input.membershipId));
        if (!employee) throw invalid('membershipId', 'no_employee_record');
        const [row] = await tx
          .insert(salaryRecords)
          .values({
            tenantId: access.tenantId,
            membershipId: input.membershipId,
            effectiveFrom: input.effectiveFrom,
            basic: input.basic,
            allowances: input.allowances,
            socialInsurance: input.socialInsurance,
            note: input.note ?? '',
            createdByUserId: access.userId,
          })
          .returning();
        // Amounts are never written to the audit log.
        await this.record(
          tx,
          req,
          access,
          'employee',
          input.membershipId,
          'payroll.salary.recorded',
          { salaryRecordId: row?.id, effectiveFrom: input.effectiveFrom },
        );
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('effectiveFrom', 'exists', 'A salary record with this date already exists.');
      throw err;
    }
    return this.salaries(req, access, input.membershipId);
  }

  // --- runs ----------------------------------------------------------------------------------

  async runs(access: AccessContext) {
    this.assertPayrollStaff(access);
    return this.database.withTenant(access.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(payrollRuns)
        .orderBy(desc(payrollRuns.period), desc(payrollRuns.createdAt));
      const items = [];
      for (const r of rows) {
        const slips = await tx.select().from(payslips).where(eq(payslips.runId, r.id));
        items.push({
          id: r.id,
          period: r.period,
          status: r.status,
          testRun: await this.isTest(tx, r),
          totals: this.totals(slips),
        });
      }
      return { items };
    });
  }

  async createRun(req: Request, access: AccessContext, period: string) {
    if (!this.may(access, 'payroll.run.prepare')) throw forbidden();
    try {
      const id = await this.database.withTenant(access.tenantId, async (tx) => {
        await this.ensureRules(tx, access);
        const [row] = await tx
          .insert(payrollRuns)
          .values({ tenantId: access.tenantId, period, preparedByUserId: access.userId })
          .returning();
        if (!row) throw new Error('run insert returned nothing');
        await this.record(tx, req, access, 'payroll_run', row.id, 'payroll.run.created', {
          period,
        });
        return row.id;
      });
      return await this.run(req, access, id);
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('period', 'exists', 'A payroll run for this month already exists.');
      throw err;
    }
  }

  async run(req: Request, access: AccessContext, id: string): Promise<PayrollRun> {
    this.assertPayrollStaff(access);
    return this.database.withTenant(access.tenantId, async (tx) => {
      const run = await this.runOf(tx, id);
      await this.record(tx, req, access, 'payroll_run', id, 'payroll.run.viewed');
      return this.toRun(tx, access, run);
    });
  }

  async setInputs(
    req: Request,
    access: AccessContext,
    id: string,
    inputs: {
      membershipId: string;
      kind: 'overtime_hours' | 'bonus' | 'advance' | 'addition' | 'deduction';
      value: string;
      note?: string | undefined;
    }[],
  ) {
    if (!this.may(access, 'payroll.run.prepare')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      const run = await this.runOf(tx, id, true);
      if (!['draft', 'calculated'].includes(run.status))
        throw conflict('status', 'locked', 'Inputs can only change before submission.');
      await tx.delete(payrollInputs).where(eq(payrollInputs.runId, id));
      if (inputs.length > 0) {
        await tx.insert(payrollInputs).values(
          inputs.map((i) => ({
            tenantId: access.tenantId,
            runId: id,
            membershipId: i.membershipId,
            kind: i.kind,
            value: i.value,
            note: i.note ?? '',
            createdByUserId: access.userId,
          })),
        );
      }
      // Changed inputs make the last calculation stale.
      await tx.delete(payslips).where(eq(payslips.runId, id));
      await tx
        .update(payrollRuns)
        .set({ status: 'draft', version: run.version + 1 })
        .where(eq(payrollRuns.id, id));
      await this.record(tx, req, access, 'payroll_run', id, 'payroll.run.inputs_changed', {
        count: inputs.length,
      });
    });
    return this.run(req, access, id);
  }

  /** Calculates every eligible person's payslip with the rule set in force for the month. */
  async calculate(req: Request, access: AccessContext, id: string) {
    if (!this.may(access, 'payroll.run.prepare')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      const run = await this.runOf(tx, id, true);
      if (!['draft', 'calculated'].includes(run.status))
        throw conflict('status', 'locked', 'Only a run being prepared can be calculated.');
      const { from, to } = monthBounds(run.period);
      const ruleSet = await this.ruleSetFor(tx, to);
      const rules = payrollRulesSchema.parse(ruleSet.rules);
      const staff = (await tx.select().from(employees)).filter(
        (e) => e.status !== 'left' || (e.leaveDate !== null && e.leaveDate >= from),
      );
      const inputs = await tx.select().from(payrollInputs).where(eq(payrollInputs.runId, id));
      const holidays = new Set(
        (
          await tx
            .select({ date: publicHolidays.date })
            .from(publicHolidays)
            .where(and(gte(publicHolidays.date, from), lte(publicHolidays.date, to)))
        ).map((h) => h.date),
      );
      const unpaidTypes = (
        await tx.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.paid, false))
      ).map((t) => t.id);
      await tx.delete(payslips).where(eq(payslips.runId, id));
      for (const employee of staff) {
        const [salary] = await tx
          .select()
          .from(salaryRecords)
          .where(
            and(
              eq(salaryRecords.membershipId, employee.membershipId),
              lte(salaryRecords.effectiveFrom, to),
            ),
          )
          .orderBy(desc(salaryRecords.effectiveFrom))
          .limit(1);
        if (!salary) continue;
        const mine = inputs.filter((i) => i.membershipId === employee.membershipId);
        const sumOf = (kind: string) => mine.filter((i) => i.kind === kind);
        // Unpaid-leave working days inside the month (from approved leave of unpaid types).
        let unpaid100 = 0;
        if (unpaidTypes.length > 0) {
          const leave = await tx
            .select()
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.membershipId, employee.membershipId),
                eq(leaveRequests.status, 'approved'),
                inArray(leaveRequests.leaveTypeId, unpaidTypes),
                lte(leaveRequests.startDate, to),
                gte(leaveRequests.endDate, from),
              ),
            );
          for (const l of leave) {
            for (
              let d = l.startDate < from ? from : l.startDate;
              d <= (l.endDate > to ? to : l.endDate);
              d = addDays(d, 1)
            ) {
              if (
                employee.workDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) &&
                !holidays.has(d)
              )
                unpaid100 += l.halfDay === 'none' ? 100 : 50;
            }
          }
        }
        const lateMinutes = rules.lateDeduction.enabled
          ? (await this.attendance.daysOf(tx, employee, from, to)).reduce(
              (t, d) => t + d.lateMinutes,
              0,
            )
          : 0;
        const month: MonthInputs = {
          overtimeHours: filsToKwd(
            sumOf('overtime_hours').reduce((t, i) => t + kwdToFils(i.value), 0n),
          ),
          unpaidLeaveDays: (unpaid100 / 100).toFixed(2),
          lateMinutes,
          additions: [
            ...sumOf('bonus').map((i) => ({
              kind: 'bonus' as const,
              amount: kwdToFils(i.value),
              note: i.note,
            })),
            ...sumOf('addition').map((i) => ({
              kind: 'adjustment' as const,
              amount: kwdToFils(i.value),
              note: i.note,
            })),
          ],
          deductions: [
            ...sumOf('advance').map((i) => ({
              kind: 'advance' as const,
              amount: kwdToFils(i.value),
              note: i.note,
            })),
            ...sumOf('deduction').map((i) => ({
              kind: 'adjustment' as const,
              amount: kwdToFils(i.value),
              note: i.note,
            })),
          ],
        };
        const result = calculatePayslip(
          rules,
          {
            basic: kwdToFils(salary.basic),
            allowances: salary.allowances.map((a) => ({
              code: a.code,
              label: a.label,
              amount: kwdToFils(a.amount),
            })),
            socialInsurance: salary.socialInsurance,
          },
          month,
        );
        await tx.insert(payslips).values({
          tenantId: access.tenantId,
          runId: id,
          membershipId: employee.membershipId,
          salaryRecordId: salary.id,
          gross: filsToKwd(result.gross),
          deductions: filsToKwd(result.deductions),
          net: filsToKwd(result.net),
          lines: {
            lines: result.lines.map((l) => ({ ...l, amount: filsToKwd(l.amount) })),
            inputs: {
              overtimeHours: month.overtimeHours,
              unpaidLeaveDays: month.unpaidLeaveDays,
              lateMinutes,
            },
            ruleSetVersion: ruleSet.version,
          },
          warnings: result.warnings,
        });
      }
      await tx
        .update(payrollRuns)
        .set({
          status: 'calculated',
          ruleSetId: ruleSet.id,
          calculatedAt: new Date(),
          version: run.version + 1,
        })
        .where(eq(payrollRuns.id, id));
      await this.record(tx, req, access, 'payroll_run', id, 'payroll.run.calculated', {
        ruleSetVersion: ruleSet.version,
      });
    });
    return this.run(req, access, id);
  }

  async transition(
    req: Request,
    access: AccessContext,
    id: string,
    action: 'submit' | 'approve' | 'pay' | 'cancel',
  ) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      const run = await this.runOf(tx, id, true);
      const now = new Date();
      if (action === 'submit') {
        if (!this.may(access, 'payroll.run.prepare')) throw forbidden();
        if (run.status !== 'calculated')
          throw conflict('status', 'invalid_transition', 'Calculate the run before submitting it.');
        await tx
          .update(payrollRuns)
          .set({ status: 'submitted', submittedAt: now, version: run.version + 1 })
          .where(eq(payrollRuns.id, id));
        await this.notifier.notify(tx, req, {
          tenantId: access.tenantId,
          type: 'payroll.submitted',
          recipients: await this.approverUsers(tx, access),
          params: { period: run.period },
          link: `/payroll/runs/${id}`,
          actor: { userId: access.userId, membershipId: access.membershipId },
        });
      } else if (action === 'approve' || action === 'pay') {
        if (!this.may(access, 'payroll.run.approve')) throw forbidden();
        // Separation of duties: whoever prepared the run never approves or pays it.
        if (run.preparedByUserId === access.userId) throw forbidden();
        if (action === 'approve') {
          if (run.status !== 'submitted')
            throw conflict('status', 'invalid_transition', 'Only a submitted run can be approved.');
          await tx
            .update(payrollRuns)
            .set({
              status: 'approved',
              approvedByUserId: access.userId,
              approvedAt: now,
              version: run.version + 1,
            })
            .where(eq(payrollRuns.id, id));
          const people = await tx
            .select({ userId: memberships.userId })
            .from(payslips)
            .innerJoin(memberships, eq(memberships.id, payslips.membershipId))
            .where(eq(payslips.runId, id));
          for (let i = 0; i < people.length; i += 200) {
            await this.notifier.notify(tx, req, {
              tenantId: access.tenantId,
              type: 'payroll.payslip_ready',
              recipients: people.slice(i, i + 200).map((p) => p.userId),
              params: { period: run.period },
              link: '/payroll/payslips',
              actor: { userId: access.userId, membershipId: access.membershipId },
            });
          }
        } else {
          if (run.status !== 'approved')
            throw conflict(
              'status',
              'invalid_transition',
              'Only an approved run can be marked paid.',
            );
          if (await this.isTest(tx, run))
            throw conflict(
              'status',
              'rules_not_verified',
              'Payroll rules are not verified; a test run cannot be paid.',
            );
          await tx
            .update(payrollRuns)
            .set({
              status: 'paid',
              paidByUserId: access.userId,
              paidAt: now,
              version: run.version + 1,
            })
            .where(eq(payrollRuns.id, id));
        }
      } else {
        if (!this.may(access, 'payroll.run.prepare')) throw forbidden();
        if (!['draft', 'calculated', 'submitted'].includes(run.status))
          throw conflict(
            'status',
            'invalid_transition',
            'Approved or paid runs cannot be cancelled.',
          );
        await tx
          .update(payrollRuns)
          .set({ status: 'cancelled', version: run.version + 1 })
          .where(eq(payrollRuns.id, id));
      }
      await this.record(
        tx,
        req,
        access,
        'payroll_run',
        id,
        `payroll.run.${action === 'pay' ? 'paid' : action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'cancelled'}`,
      );
    });
    return this.run(req, access, id);
  }

  /** CSV for the bank / accountant (authorised and audited). */
  async export(req: Request, access: AccessContext, id: string) {
    if (!this.may(access, 'exports.confidential')) throw forbidden();
    const { run, rows } = await this.database.withTenant(access.tenantId, async (tx) => {
      const r = await this.runOf(tx, id);
      if (!['approved', 'paid'].includes(r.status))
        throw conflict('status', 'not_approved', 'Only approved runs can be exported.');
      const slips = await tx
        .select({ slip: payslips, number: employees.number })
        .from(payslips)
        .innerJoin(employees, eq(employees.membershipId, payslips.membershipId))
        .where(eq(payslips.runId, id))
        .orderBy(asc(employees.number));
      await this.record(tx, req, access, 'payroll_run', id, 'payroll.run.exported', {
        count: slips.length,
      });
      return { run: r, rows: slips };
    });
    const names = await this.namesOf(
      access,
      rows.map((r) => r.slip.membershipId),
    );
    const cell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
    const lines = [
      'employee_number,name,gross,deductions,net,currency',
      ...rows.map((r) =>
        [
          r.number,
          names.get(r.slip.membershipId) ?? '',
          r.slip.gross,
          r.slip.deductions,
          r.slip.net,
          r.slip.currency,
        ]
          .map((v) => `"${cell(v)}"`)
          .join(','),
      ),
    ];
    return { filename: `payroll-${run.period}.csv`, body: `${lines.join('\r\n')}\r\n` };
  }

  // --- payslips ------------------------------------------------------------------------------

  async myPayslips(access: AccessContext) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const rows = await tx
        .select({ slip: payslips, run: payrollRuns })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
        .where(
          and(
            eq(payslips.membershipId, access.membershipId),
            inArray(payrollRuns.status, ['approved', 'paid']),
          ),
        )
        .orderBy(desc(payrollRuns.period));
      return {
        items: await Promise.all(rows.map((r) => this.toPayslip(tx, access, r.slip, r.run))),
      };
    });
  }

  async payslip(req: Request, access: AccessContext, id: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .select({ slip: payslips, run: payrollRuns })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
        .where(eq(payslips.id, id));
      if (!row) throw notFound();
      const own =
        row.slip.membershipId === access.membershipId &&
        ['approved', 'paid'].includes(row.run.status);
      const staff =
        this.may(access, 'payroll.payslip.read') ||
        this.may(access, 'payroll.run.prepare') ||
        this.may(access, 'payroll.run.approve');
      if (!own && !staff) throw notFound();
      await this.record(tx, req, access, 'payslip', id, 'payroll.payslip.viewed');
      return this.toPayslip(tx, access, row.slip, row.run);
    });
  }

  // --- helpers -------------------------------------------------------------------------------

  private async runOf(tx: TenantTransaction, id: string, lock = false) {
    const query = tx.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    return row;
  }

  /** A run is a test run when it was (or would be) calculated with an unverified rule set. */
  private async isTest(tx: TenantTransaction, run: RunRow) {
    if (!run.ruleSetId) return true;
    const [set] = await tx
      .select({ toVerify: payrollRuleSets.toVerify })
      .from(payrollRuleSets)
      .where(eq(payrollRuleSets.id, run.ruleSetId));
    return set?.toVerify ?? true;
  }

  private totals(slips: (typeof payslips.$inferSelect)[]) {
    const sum = (k: 'gross' | 'deductions' | 'net') =>
      filsToKwd(slips.reduce((t, s) => t + kwdToFils(s[k]), 0n));
    return {
      people: slips.length,
      gross: sum('gross'),
      deductions: sum('deductions'),
      net: sum('net'),
    };
  }

  private async toRun(
    tx: TenantTransaction,
    access: AccessContext,
    run: RunRow,
  ): Promise<PayrollRun> {
    const slips = await tx
      .select()
      .from(payslips)
      .where(eq(payslips.runId, run.id))
      .orderBy(asc(payslips.createdAt));
    const inputs = await tx
      .select()
      .from(payrollInputs)
      .where(eq(payrollInputs.runId, run.id))
      .orderBy(asc(payrollInputs.createdAt));
    const [set] = run.ruleSetId
      ? await tx.select().from(payrollRuleSets).where(eq(payrollRuleSets.id, run.ruleSetId))
      : [];
    const staff = (await tx.select().from(employees).where(ne(employees.status, 'left'))).map(
      (e) => e.membershipId,
    );
    const paid = new Set(slips.map((s) => s.membershipId));
    const names = await this.namesOf(access, [...staff, ...slips.map((s) => s.membershipId)], tx);
    const users = new Map(
      (
        await this.identity.userSummaries(
          [run.preparedByUserId, run.approvedByUserId, run.paidByUserId].filter((u): u is string =>
            Boolean(u),
          ),
        )
      ).map((u) => [u.id, u.name]),
    );
    const prepare = this.may(access, 'payroll.run.prepare');
    const approve =
      this.may(access, 'payroll.run.approve') && run.preparedByUserId !== access.userId;
    const test = await this.isTest(tx, run);
    const warnings = [
      ...(run.status === 'draft' || run.status === 'calculated'
        ? staff
            .filter((m) => !paid.has(m) && run.status === 'calculated')
            .map((m) => ({
              person: { membershipId: m, name: names.get(m) ?? '' },
              code: 'no_salary_record',
            }))
        : []),
      ...slips.flatMap((s) =>
        s.warnings.map((w) => ({
          person: { membershipId: s.membershipId, name: names.get(s.membershipId) ?? '' },
          code: w,
        })),
      ),
    ];
    return {
      id: run.id,
      period: run.period,
      status: run.status,
      testRun: test,
      ruleSetVersion: set?.version ?? null,
      preparedByName: users.get(run.preparedByUserId) ?? null,
      approvedByName: run.approvedByUserId ? (users.get(run.approvedByUserId) ?? null) : null,
      paidByName: run.paidByUserId ? (users.get(run.paidByUserId) ?? null) : null,
      paidAt: run.paidAt?.toISOString() ?? null,
      totals: this.totals(slips),
      warnings,
      inputs: inputs.map((i) => ({
        id: i.id,
        membershipId: i.membershipId,
        kind: i.kind,
        value: i.value.replace(/\.?0+$/, ''),
        note: i.note,
      })),
      payslips: await Promise.all(slips.map((s) => this.toPayslip(tx, access, s, run))),
      actions: [
        ...(prepare && ['draft', 'calculated'].includes(run.status)
          ? (['inputs', 'calculate'] as const)
          : []),
        ...(prepare && run.status === 'calculated' ? (['submit'] as const) : []),
        ...(approve && run.status === 'submitted' ? (['approve'] as const) : []),
        ...(approve && run.status === 'approved' && !test ? (['pay'] as const) : []),
        ...(prepare && ['draft', 'calculated', 'submitted'].includes(run.status)
          ? (['cancel'] as const)
          : []),
        ...(this.may(access, 'exports.confidential') && ['approved', 'paid'].includes(run.status)
          ? (['export'] as const)
          : []),
      ],
      version: run.version,
    };
  }

  private async toPayslip(
    tx: TenantTransaction,
    access: AccessContext,
    s: typeof payslips.$inferSelect,
    run: RunRow,
  ): Promise<Payslip> {
    const names = await this.namesOf(access, [s.membershipId], tx);
    const trace = s.lines as {
      lines: { code: string; label: string; basis: string; amount: string }[];
    };
    return {
      id: s.id,
      run: {
        id: run.id,
        period: run.period,
        status: run.status,
        testRun: await this.isTest(tx, run),
      },
      person: { membershipId: s.membershipId, name: names.get(s.membershipId) ?? '' },
      gross: s.gross,
      deductions: s.deductions,
      net: s.net,
      currency: s.currency,
      lines: trace.lines,
      warnings: s.warnings,
    };
  }

  private async approverUsers(tx: TenantTransaction, access: AccessContext) {
    const rows = await tx
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .where(and(eq(memberships.status, 'active'), eq(membershipRoles.role, 'ceo')));
    return rows.map((r) => r.userId).filter((u) => u !== access.userId);
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
