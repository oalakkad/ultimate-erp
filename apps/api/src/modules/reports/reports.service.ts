import { HttpStatus, Injectable } from '@nestjs/common';
import {
  hasPermission,
  type Permission,
  type Report,
  type ReportKey,
  REPORT_KEYS,
  type REPORT_COLUMN_TYPES,
} from '@ultimate-erp/contracts';
import {
  clients,
  creditNotes,
  employees,
  expenseClaims,
  expenseLines,
  invoices,
  leaveRequests,
  leaveTypes,
  memberships,
  payments,
  payrollRuleSets,
  payrollRuns,
  payslips,
  projects,
  taskAllocations,
  tasks,
  type TenantTransaction,
  timeEntries,
} from '@ultimate-erp/db';
import { and, asc, eq, gte, inArray, lte, ne, type SQL } from 'drizzle-orm';
import { type Request } from 'express';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { type AccessContext } from '../access/access-context.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { csvCell } from '../clients/clients.service.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { filsToKwd, kwdToFils } from '../payroll/engine.js';
import { teamScopeOf } from '../people/people.service.js';
import { formatHours, hundredths } from '../projects/projects.service.js';

type ColumnType = (typeof REPORT_COLUMN_TYPES)[number];
type Row = Record<string, string | null>;
type Filter = 'period' | 'client' | 'project';
interface Query {
  from: string;
  to: string;
  clientId?: string | undefined;
  projectId?: string | undefined;
  locale: 'en' | 'ar';
}
type QueryInput = { [K in keyof Query]?: Query[K] | undefined };
/** null = everyone / every project in the company; otherwise the IDs in my scope. */
type Scope = Set<string> | null;
interface Definition {
  permissions: Permission[];
  /** The narrower scope that also qualifies (rows are then limited to it). */
  scoped?: 'team' | 'project';
  /** The permission that grants the scoped version (default: the report's own). */
  scopedBy?: Permission;
  filters: Filter[];
  /** Exporting needs the confidential-export permission as well. */
  confidential?: boolean;
  columns: [string, ColumnType][];
  totals?: string[];
}

const MAX_ROWS = 2000;
const MAX_DAYS = 366;
const forbidden = () => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, messageFor('FORBIDDEN'));
const invalid = (path: string, code: string) =>
  new AppError(
    'VALIDATION_FAILED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    messageFor('VALIDATION_FAILED'),
    [{ path, code }],
  );
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const kuwaitDayStart = (iso: string) => new Date(Date.parse(`${iso}T00:00:00+03:00`));
const kuwaitDate = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
const money = (fils: bigint) => filsToKwd(fils);
const sumFils = (values: string[]) => values.reduce((t, v) => t + kwdToFils(v), 0n);
/** Ratio as a percentage with one decimal ("82.5"), or null when the base is zero. */
const percent = (part: bigint, whole: bigint) =>
  whole === 0n ? null : (Number((part * 1000n) / whole) / 10).toFixed(1);
const OPEN_INVOICE = ['issued', 'partially_paid'] as const;
const LIVE_INVOICE = ['issued', 'partially_paid', 'paid'] as const;

/** Report catalogue (docs/modules/reports.md §3). Column keys are translated by the web app. */
export const REPORTS: Record<ReportKey, Definition> = {
  clients: {
    permissions: ['clients.client.read'],
    filters: ['period', 'client'],
    columns: [
      ['number', 'text'],
      ['client', 'text'],
      ['invoiced', 'money'],
      ['received', 'money'],
      ['outstanding', 'money'],
    ],
    totals: ['invoiced', 'received', 'outstanding'],
  },
  projects: {
    permissions: ['projects.project.read'],
    scoped: 'project',
    scopedBy: 'projects.project.manage',
    filters: ['client', 'project'],
    columns: [
      ['number', 'text'],
      ['project', 'text'],
      ['client', 'text'],
      ['status', 'status'],
      ['budgetHours', 'hours'],
      ['allocatedHours', 'hours'],
      ['approvedHours', 'hours'],
      ['consumption', 'percent'],
    ],
    totals: ['budgetHours', 'allocatedHours', 'approvedHours'],
  },
  profitability: {
    permissions: ['billing.invoice.read'],
    filters: ['period', 'client', 'project'],
    columns: [
      ['number', 'text'],
      ['project', 'text'],
      ['client', 'text'],
      ['invoiced', 'money'],
      ['expenses', 'money'],
      ['contribution', 'money'],
      ['margin', 'percent'],
    ],
    totals: ['invoiced', 'expenses', 'contribution'],
  },
  utilization: {
    permissions: ['people.employee.read'],
    scoped: 'team',
    filters: ['period'],
    columns: [
      ['person', 'text'],
      ['capacityHours', 'hours'],
      ['approvedHours', 'hours'],
      ['billableHours', 'hours'],
      ['utilization', 'percent'],
    ],
    totals: ['capacityHours', 'approvedHours', 'billableHours'],
  },
  tasks: {
    permissions: ['tasks.task.read'],
    filters: ['period', 'project'],
    columns: [
      ['number', 'text'],
      ['project', 'text'],
      ['completed', 'number'],
      ['onTime', 'number'],
      ['late', 'number'],
      ['openOverdue', 'number'],
      ['estimatedHours', 'hours'],
      ['actualHours', 'hours'],
    ],
    totals: ['completed', 'onTime', 'late', 'openOverdue', 'estimatedHours', 'actualHours'],
  },
  timesheets: {
    permissions: ['time.entry.read'],
    scoped: 'project',
    filters: ['period', 'project'],
    columns: [
      ['person', 'text'],
      ['project', 'text'],
      ['submittedHours', 'hours'],
      ['approvedHours', 'hours'],
      ['rejectedHours', 'hours'],
      ['billableHours', 'hours'],
    ],
    totals: ['submittedHours', 'approvedHours', 'rejectedHours', 'billableHours'],
  },
  attendance: {
    permissions: ['attendance.read'],
    scoped: 'team',
    filters: ['period'],
    columns: [
      ['person', 'text'],
      ['present', 'number'],
      ['absent', 'number'],
      ['late', 'number'],
      ['early', 'number'],
      ['leave', 'number'],
      ['workedHours', 'hours'],
    ],
    totals: ['present', 'absent', 'late', 'early', 'leave', 'workedHours'],
  },
  leave: {
    permissions: ['leave.request.read'],
    scoped: 'team',
    filters: ['period'],
    columns: [
      ['person', 'text'],
      ['type', 'text'],
      ['requests', 'number'],
      ['days', 'hours'],
    ],
    totals: ['requests', 'days'],
  },
  payroll: {
    permissions: ['payroll.run.approve', 'payroll.run.prepare'],
    filters: ['period'],
    confidential: true,
    columns: [
      ['period', 'text'],
      ['status', 'status'],
      ['testRun', 'status'],
      ['employees', 'number'],
      ['gross', 'money'],
      ['deductions', 'money'],
      ['net', 'money'],
    ],
    totals: ['employees', 'gross', 'deductions', 'net'],
  },
  invoices: {
    permissions: ['billing.invoice.read'],
    filters: ['period', 'client', 'project'],
    columns: [
      ['number', 'text'],
      ['client', 'text'],
      ['issueDate', 'date'],
      ['dueDate', 'date'],
      ['status', 'status'],
      ['total', 'money'],
      ['outstanding', 'money'],
    ],
    totals: ['total', 'outstanding'],
  },
  payments: {
    permissions: ['billing.invoice.read'],
    filters: ['period', 'client'],
    columns: [
      ['receivedOn', 'date'],
      ['invoice', 'text'],
      ['client', 'text'],
      ['method', 'status'],
      ['status', 'status'],
      ['amount', 'money'],
    ],
    totals: ['amount'],
  },
  receivables: {
    permissions: ['billing.invoice.read'],
    filters: ['client'],
    columns: [
      ['client', 'text'],
      ['notDue', 'money'],
      ['days1to30', 'money'],
      ['days31to60', 'money'],
      ['days61to90', 'money'],
      ['over90', 'money'],
      ['total', 'money'],
    ],
    totals: ['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90', 'total'],
  },
  revenue: {
    permissions: ['billing.invoice.read'],
    filters: ['period'],
    columns: [
      ['month', 'text'],
      ['invoiced', 'money'],
      ['received', 'money'],
    ],
    totals: ['invoiced', 'received'],
  },
};

/** Reports & analytics (docs/modules/reports.md). Computed on request, never cached. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly identity: IdentityService,
    private readonly attendance: AttendanceService,
  ) {}

  /** How this person may run a report: company-wide, scoped, or not at all. */
  private reach(access: AccessContext, key: ReportKey): 'company' | 'scoped' | null {
    const d = REPORTS[key];
    if (d.permissions.some((p) => hasPermission(access.permissions, p, 'company')))
      return 'company';
    const scopedBy = d.scopedBy ? [d.scopedBy] : d.permissions;
    if (d.scoped && scopedBy.some((p) => hasPermission(access.permissions, p, d.scoped)))
      return 'scoped';
    return null;
  }

  catalog(access: AccessContext) {
    return {
      items: REPORT_KEYS.flatMap((key) => {
        const reach = this.reach(access, key);
        return reach ? [{ key, filters: REPORTS[key].filters, scoped: reach === 'scoped' }] : [];
      }),
    };
  }

  async run(access: AccessContext, key: ReportKey, input: QueryInput): Promise<Report> {
    const reach = this.reach(access, key);
    if (!reach) throw forbidden();
    const today = kuwaitToday();
    const query: Query = {
      from: input.from ?? `${today.slice(0, 4)}-01-01`,
      to: input.to ?? today,
      clientId: input.clientId,
      projectId: input.projectId,
      locale: input.locale ?? 'en',
    };
    if (query.to < query.from) throw invalid('to', 'before_from');
    if (daysBetween(query.from, query.to) > MAX_DAYS) throw invalid('to', 'period_too_long');
    const definition = REPORTS[key];
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const scope = reach === 'company' ? null : await this.scopeOf(tx, access, definition);
      return this.compute(tx, key, query, scope);
    });
    const shown = rows.slice(0, MAX_ROWS);
    return {
      key,
      from: query.from,
      to: query.to,
      columns: definition.columns.map(([k, type]) => ({ key: k, type })),
      rows: shown,
      totals: definition.totals ? this.totalsOf(definition, rows) : null,
      truncated: rows.length > MAX_ROWS,
      scoped: reach === 'scoped',
      generatedAt: new Date().toISOString(),
    };
  }

  /** CSV of a report (formula-safe); the export is audited, payroll needs confidential export. */
  async exportCsv(req: Request, access: AccessContext, key: ReportKey, input: QueryInput) {
    if (
      REPORTS[key].confidential &&
      !hasPermission(access.permissions, 'exports.confidential', 'company')
    )
      throw forbidden();
    const report = await this.run(access, key, input);
    await this.database.withTenant(access.tenantId, (tx) =>
      this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'reports.report.exported',
        actor: { userId: access.userId, membershipId: access.membershipId },
        details: { report: key, from: report.from, to: report.to, rows: report.rows.length },
      }),
    );
    const keys = report.columns.map((c) => c.key);
    const lines = report.rows.map((r) => keys.map((k) => csvCell(r[k])).join(','));
    const totals = report.totals
      ? [keys.map((k, i) => csvCell(i === 0 ? 'Total' : (report.totals?.[k] ?? ''))).join(',')]
      : [];
    return `\uFEFF${[keys.map(csvCell).join(','), ...lines, ...totals].join('\r\n')}\r\n`;
  }

  // --- scope ---------------------------------------------------------------------------------

  private async scopeOf(tx: TenantTransaction, access: AccessContext, d: Definition) {
    if (d.scoped === 'team') {
      const team = await teamScopeOf(tx, access.membershipId);
      team.add(access.membershipId);
      return team;
    }
    const managed = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.managerMembershipId, access.membershipId));
    return new Set(managed.map((p) => p.id));
  }

  private totalsOf(d: Definition, rows: Row[]) {
    const out: Record<string, string> = {};
    for (const key of d.totals ?? []) {
      const type = d.columns.find(([k]) => k === key)?.[1];
      const values = rows.map((r) => r[key] ?? '0');
      if (type === 'money') out[key] = money(sumFils(values));
      else if (type === 'hours')
        out[key] = formatHours(values.reduce((t, v) => t + hundredths(v), 0n));
      else out[key] = String(values.reduce((t, v) => t + Number(v), 0));
    }
    return out;
  }

  // --- computations --------------------------------------------------------------------------

  private compute(tx: TenantTransaction, key: ReportKey, q: Query, scope: Scope): Promise<Row[]> {
    switch (key) {
      case 'clients':
        return this.clientsReport(tx, q);
      case 'projects':
        return this.projectsReport(tx, q, scope);
      case 'profitability':
        return this.profitabilityReport(tx, q);
      case 'utilization':
        return this.utilizationReport(tx, q, scope);
      case 'tasks':
        return this.tasksReport(tx, q);
      case 'timesheets':
        return this.timesheetsReport(tx, q, scope);
      case 'attendance':
        return this.attendanceReport(tx, q, scope);
      case 'leave':
        return this.leaveReport(tx, q, scope);
      case 'payroll':
        return this.payrollReport(tx, q);
      case 'invoices':
        return this.invoicesReport(tx, q);
      case 'payments':
        return this.paymentsReport(tx, q);
      case 'receivables':
        return this.receivablesReport(tx, q);
      case 'revenue':
        return this.revenueReport(tx, q);
    }
  }

  private name(q: Query, en: string, ar: string) {
    return q.locale === 'ar' ? ar : en;
  }

  /** Outstanding (fils) of each open invoice: total − recorded payments − credit notes. */
  private async openBalances(tx: TenantTransaction, ids: string[]) {
    const out = new Map<string, bigint>();
    if (ids.length === 0) return out;
    const paid = await tx
      .select({ invoiceId: payments.invoiceId, amount: payments.amount })
      .from(payments)
      .where(and(inArray(payments.invoiceId, ids), eq(payments.status, 'recorded')));
    const credited = await tx
      .select({ invoiceId: creditNotes.invoiceId, amount: creditNotes.amount })
      .from(creditNotes)
      .where(inArray(creditNotes.invoiceId, ids));
    for (const r of [...paid, ...credited])
      out.set(r.invoiceId, (out.get(r.invoiceId) ?? 0n) + kwdToFils(r.amount));
    return out;
  }

  private async openInvoices(tx: TenantTransaction, clientId?: string) {
    const rows = await tx
      .select()
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, [...OPEN_INVOICE]),
          clientId ? eq(invoices.clientId, clientId) : undefined,
        ),
      );
    const deducted = await this.openBalances(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      invoice: r,
      outstanding: kwdToFils(r.total) - (deducted.get(r.id) ?? 0n),
    }));
  }

  private async clientsReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const list = await tx
      .select()
      .from(clients)
      .where(q.clientId ? eq(clients.id, q.clientId) : undefined)
      .orderBy(asc(clients.number));
    const issued = await tx
      .select({ clientId: invoices.clientId, total: invoices.total })
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, [...LIVE_INVOICE]),
          gte(invoices.issueDate, q.from),
          lte(invoices.issueDate, q.to),
        ),
      );
    const received = await tx
      .select({ clientId: invoices.clientId, amount: payments.amount })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(
        and(
          eq(payments.status, 'recorded'),
          gte(payments.receivedOn, q.from),
          lte(payments.receivedOn, q.to),
        ),
      );
    const open = await this.openInvoices(tx, q.clientId);
    const by = <T extends { clientId: string }>(rows: T[], value: (r: T) => string) => {
      const m = new Map<string, bigint>();
      for (const r of rows) m.set(r.clientId, (m.get(r.clientId) ?? 0n) + kwdToFils(value(r)));
      return m;
    };
    const inv = by(issued, (r) => r.total);
    const rec = by(received, (r) => r.amount);
    const out = new Map<string, bigint>();
    for (const o of open)
      out.set(o.invoice.clientId, (out.get(o.invoice.clientId) ?? 0n) + o.outstanding);
    return list.map((c) => ({
      number: c.number,
      client: this.name(q, c.legalNameEn, c.legalNameAr),
      invoiced: money(inv.get(c.id) ?? 0n),
      received: money(rec.get(c.id) ?? 0n),
      outstanding: money(out.get(c.id) ?? 0n),
    }));
  }

  private async projectRows(tx: TenantTransaction, q: Query, scope: Scope) {
    const where: (SQL | undefined)[] = [
      q.clientId ? eq(projects.clientId, q.clientId) : undefined,
      q.projectId ? eq(projects.id, q.projectId) : undefined,
    ];
    if (scope) {
      if (scope.size === 0) return [];
      where.push(inArray(projects.id, [...scope]));
    }
    return tx
      .select({ project: projects, client: clients })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(and(...where))
      .orderBy(asc(projects.number));
  }

  private async projectsReport(tx: TenantTransaction, q: Query, scope: Scope): Promise<Row[]> {
    const list = await this.projectRows(tx, q, scope);
    const ids = list.map((r) => r.project.id);
    if (ids.length === 0) return [];
    const allocated = await tx
      .select({ projectId: taskAllocations.projectId, hours: taskAllocations.hours })
      .from(taskAllocations)
      .where(inArray(taskAllocations.projectId, ids));
    const approved = await tx
      .select({ projectId: timeEntries.projectId, hours: timeEntries.hours })
      .from(timeEntries)
      .where(and(inArray(timeEntries.projectId, ids), eq(timeEntries.status, 'approved')));
    const sum = (rows: { projectId: string; hours: string }[]) => {
      const m = new Map<string, bigint>();
      for (const r of rows) m.set(r.projectId, (m.get(r.projectId) ?? 0n) + hundredths(r.hours));
      return m;
    };
    const alloc = sum(allocated);
    const appr = sum(approved);
    return list.map(({ project: p, client: c }) => {
      const budget = p.budgetHours ? hundredths(p.budgetHours) : 0n;
      return {
        number: p.number,
        project: this.name(q, p.nameEn, p.nameAr),
        client: this.name(q, c.legalNameEn, c.legalNameAr),
        status: p.status,
        budgetHours: formatHours(budget),
        allocatedHours: formatHours(alloc.get(p.id) ?? 0n),
        approvedHours: formatHours(appr.get(p.id) ?? 0n),
        consumption: percent(appr.get(p.id) ?? 0n, budget),
      };
    });
  }

  private async profitabilityReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const list = await this.projectRows(tx, q, null);
    const ids = list.map((r) => r.project.id);
    if (ids.length === 0) return [];
    const issued = await tx
      .select({ projectId: invoices.projectId, total: invoices.total })
      .from(invoices)
      .where(
        and(
          inArray(invoices.projectId, ids),
          inArray(invoices.status, [...LIVE_INVOICE]),
          gte(invoices.issueDate, q.from),
          lte(invoices.issueDate, q.to),
        ),
      );
    const spent = await tx
      .select({ projectId: expenseLines.projectId, amount: expenseLines.amount })
      .from(expenseLines)
      .innerJoin(expenseClaims, eq(expenseClaims.id, expenseLines.claimId))
      .where(
        and(
          inArray(expenseLines.projectId, ids),
          inArray(expenseClaims.status, ['approved', 'reimbursed']),
          gte(expenseLines.spentOn, q.from),
          lte(expenseLines.spentOn, q.to),
        ),
      );
    const inv = new Map<string, bigint>();
    for (const r of issued)
      if (r.projectId) inv.set(r.projectId, (inv.get(r.projectId) ?? 0n) + kwdToFils(r.total));
    const exp = new Map<string, bigint>();
    for (const r of spent)
      if (r.projectId) exp.set(r.projectId, (exp.get(r.projectId) ?? 0n) + kwdToFils(r.amount));
    return list
      .filter(({ project: p }) => inv.has(p.id) || exp.has(p.id))
      .map(({ project: p, client: c }) => {
        const invoiced = inv.get(p.id) ?? 0n;
        const contribution = invoiced - (exp.get(p.id) ?? 0n);
        return {
          number: p.number,
          project: this.name(q, p.nameEn, p.nameAr),
          client: this.name(q, c.legalNameEn, c.legalNameAr),
          invoiced: money(invoiced),
          expenses: money(exp.get(p.id) ?? 0n),
          contribution: contribution < 0n ? `-${money(-contribution)}` : money(contribution),
          margin: percent(contribution, invoiced),
        };
      });
  }

  private async people(tx: TenantTransaction, q: Query, scope: Scope) {
    const rows = await tx
      .select()
      .from(employees)
      .where(
        and(
          ne(employees.status, 'left'),
          scope ? inArray(employees.membershipId, [...scope]) : undefined,
        ),
      );
    const names = await this.namesOf(
      tx,
      rows.map((r) => r.membershipId),
    );
    return rows
      .map((employee) => ({ employee, name: names.get(employee.membershipId) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, q.locale));
  }

  private async utilizationReport(tx: TenantTransaction, q: Query, scope: Scope): Promise<Row[]> {
    const staff = await this.people(tx, q, scope);
    if (staff.length === 0) return [];
    const time = await tx
      .select({
        membershipId: timeEntries.membershipId,
        hours: timeEntries.hours,
        billable: timeEntries.billable,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.status, 'approved'),
          gte(timeEntries.workDate, q.from),
          lte(timeEntries.workDate, q.to),
          inArray(
            timeEntries.membershipId,
            staff.map((s) => s.employee.membershipId),
          ),
        ),
      );
    // Count each weekday in the period once.
    const weekdays = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i <= daysBetween(q.from, q.to); i++) {
      const day = new Date(Date.parse(`${q.from}T00:00:00Z`) + i * DAY).getUTCDay();
      weekdays[day] = (weekdays[day] ?? 0) + 1;
    }
    return staff.map(({ employee: e, name }) => {
      const workDays = e.workDays.length;
      const days = e.workDays.reduce((t, d) => t + (weekdays[d] ?? 0), 0);
      // capacity = weekly hours ÷ work days × working days in the period (hundredths, exact).
      const capacity =
        workDays === 0 ? 0n : (hundredths(e.weeklyHours) * BigInt(days)) / BigInt(workDays);
      const mine = time.filter((t) => t.membershipId === e.membershipId);
      const approved = mine.reduce((t, r) => t + hundredths(r.hours), 0n);
      const billable = mine.filter((r) => r.billable).reduce((t, r) => t + hundredths(r.hours), 0n);
      return {
        person: name,
        capacityHours: formatHours(capacity),
        approvedHours: formatHours(approved),
        billableHours: formatHours(billable),
        utilization: percent(billable, capacity),
      };
    });
  }

  private async tasksReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const list = await this.projectRows(tx, q, null);
    const ids = list.map((r) => r.project.id);
    if (ids.length === 0) return [];
    const all = await tx.select().from(tasks).where(inArray(tasks.projectId, ids));
    const start = kuwaitDayStart(q.from).getTime();
    const end = kuwaitDayStart(q.to).getTime() + DAY;
    const done = all.filter(
      (t) =>
        t.status === 'completed' &&
        t.completedAt &&
        t.completedAt.getTime() >= start &&
        t.completedAt.getTime() < end,
    );
    const actual = done.length
      ? await tx
          .select({ taskId: timeEntries.taskId, hours: timeEntries.hours })
          .from(timeEntries)
          .where(
            and(
              inArray(
                timeEntries.taskId,
                done.map((t) => t.id),
              ),
              eq(timeEntries.status, 'approved'),
            ),
          )
      : [];
    const today = kuwaitToday();
    return list
      .map(({ project: p }) => {
        const mine = done.filter((t) => t.projectId === p.id);
        // Tasks without a due date count as on time.
        const onTime = mine.filter(
          (t) => !t.dueDate || (t.completedAt && kuwaitDate(t.completedAt) <= t.dueDate),
        ).length;
        const openOverdue = all.filter(
          (t) =>
            t.projectId === p.id &&
            !['completed', 'cancelled'].includes(t.status) &&
            t.dueDate !== null &&
            t.dueDate < today,
        ).length;
        const ids = new Set(mine.map((t) => t.id));
        return {
          number: p.number,
          project: this.name(q, p.nameEn, p.nameAr),
          completed: String(mine.length),
          onTime: String(onTime),
          late: String(mine.length - onTime),
          openOverdue: String(openOverdue),
          estimatedHours: formatHours(
            mine.reduce((t, x) => t + (x.estimatedHours ? hundredths(x.estimatedHours) : 0n), 0n),
          ),
          actualHours: formatHours(
            actual.filter((a) => ids.has(a.taskId)).reduce((t, a) => t + hundredths(a.hours), 0n),
          ),
        };
      })
      .filter((r) => r.completed !== '0' || r.openOverdue !== '0');
  }

  private async timesheetsReport(tx: TenantTransaction, q: Query, scope: Scope): Promise<Row[]> {
    const list = await this.projectRows(tx, q, scope);
    const ids = list.map((r) => r.project.id);
    if (ids.length === 0) return [];
    const entries = await tx
      .select()
      .from(timeEntries)
      .where(
        and(
          inArray(timeEntries.projectId, ids),
          ne(timeEntries.status, 'draft'),
          gte(timeEntries.workDate, q.from),
          lte(timeEntries.workDate, q.to),
        ),
      );
    const names = await this.namesOf(
      tx,
      entries.map((e) => e.membershipId),
    );
    const projectName = new Map(
      list.map(({ project: p }) => [p.id, `${p.number} ${this.name(q, p.nameEn, p.nameAr)}`]),
    );
    const groups = new Map<
      string,
      { person: string; project: string; h: Record<string, bigint> }
    >();
    for (const e of entries) {
      const key = `${e.membershipId}:${e.projectId}`;
      const g = groups.get(key) ?? {
        person: names.get(e.membershipId) ?? '',
        project: projectName.get(e.projectId) ?? '',
        h: { submitted: 0n, approved: 0n, rejected: 0n, billable: 0n },
      };
      const hours = hundredths(e.hours);
      g.h[e.status] = (g.h[e.status] ?? 0n) + hours;
      if (e.status === 'approved' && e.billable) g.h.billable = (g.h.billable ?? 0n) + hours;
      groups.set(key, g);
    }
    return [...groups.values()]
      .sort(
        (a, b) => a.person.localeCompare(b.person, q.locale) || a.project.localeCompare(b.project),
      )
      .map((g) => ({
        person: g.person,
        project: g.project,
        submittedHours: formatHours(g.h.submitted ?? 0n),
        approvedHours: formatHours(g.h.approved ?? 0n),
        rejectedHours: formatHours(g.h.rejected ?? 0n),
        billableHours: formatHours(g.h.billable ?? 0n),
      }));
  }

  private async attendanceReport(tx: TenantTransaction, q: Query, scope: Scope): Promise<Row[]> {
    const staff = await this.people(tx, q, scope);
    const rows: Row[] = [];
    for (const { employee, name } of staff) {
      // The attendance module's own day rules (shifts, grace, leave, holidays).
      const days = await this.attendance.daysOf(tx, employee, q.from, q.to);
      rows.push({
        person: name,
        present: String(
          days.filter((d) => d.status === 'present' || d.status === 'incomplete').length,
        ),
        absent: String(days.filter((d) => d.status === 'absent').length),
        late: String(days.filter((d) => d.lateMinutes > 0).length),
        early: String(days.filter((d) => d.earlyMinutes > 0).length),
        leave: String(days.filter((d) => d.status === 'leave').length),
        workedHours: formatHours(
          (BigInt(days.reduce((t, d) => t + d.workedMinutes, 0)) * 100n) / 60n,
        ),
      });
    }
    return rows;
  }

  private async leaveReport(tx: TenantTransaction, q: Query, scope: Scope): Promise<Row[]> {
    if (scope?.size === 0) return [];
    const list = await tx
      .select({ request: leaveRequests, type: leaveTypes })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.status, 'approved'),
          gte(leaveRequests.startDate, q.from),
          lte(leaveRequests.startDate, q.to),
          scope ? inArray(leaveRequests.membershipId, [...scope]) : undefined,
        ),
      );
    const names = await this.namesOf(
      tx,
      list.map((r) => r.request.membershipId),
    );
    const groups = new Map<string, { person: string; type: string; n: number; days: bigint }>();
    for (const { request: r, type } of list) {
      const key = `${r.membershipId}:${type.id}`;
      const g = groups.get(key) ?? {
        person: names.get(r.membershipId) ?? '',
        type: this.name(q, type.nameEn, type.nameAr),
        n: 0,
        days: 0n,
      };
      g.n += 1;
      g.days += hundredths(r.days);
      groups.set(key, g);
    }
    return [...groups.values()]
      .sort((a, b) => a.person.localeCompare(b.person, q.locale) || a.type.localeCompare(b.type))
      .map((g) => ({
        person: g.person,
        type: g.type,
        requests: String(g.n),
        days: formatHours(g.days),
      }));
  }

  private async payrollReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const runs = await tx
      .select({ run: payrollRuns, rules: payrollRuleSets })
      .from(payrollRuns)
      .innerJoin(payrollRuleSets, eq(payrollRuleSets.id, payrollRuns.ruleSetId))
      .where(
        and(
          ne(payrollRuns.status, 'cancelled'),
          gte(payrollRuns.period, q.from.slice(0, 7)),
          lte(payrollRuns.period, q.to.slice(0, 7)),
        ),
      )
      .orderBy(asc(payrollRuns.period));
    if (runs.length === 0) return [];
    const slips = await tx
      .select()
      .from(payslips)
      .where(
        inArray(
          payslips.runId,
          runs.map((r) => r.run.id),
        ),
      );
    return runs.map(({ run, rules }) => {
      const mine = slips.filter((s) => s.runId === run.id);
      return {
        period: run.period,
        status: run.status,
        testRun: rules.toVerify ? 'yes' : 'no',
        employees: String(mine.length),
        gross: money(sumFils(mine.map((s) => s.gross))),
        deductions: money(sumFils(mine.map((s) => s.deductions))),
        net: money(sumFils(mine.map((s) => s.net))),
      };
    });
  }

  private async invoicesReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const list = await tx
      .select({ invoice: invoices, client: clients })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(
        and(
          ne(invoices.status, 'draft'),
          gte(invoices.issueDate, q.from),
          lte(invoices.issueDate, q.to),
          q.clientId ? eq(invoices.clientId, q.clientId) : undefined,
          q.projectId ? eq(invoices.projectId, q.projectId) : undefined,
        ),
      )
      .orderBy(asc(invoices.issueDate), asc(invoices.number));
    const deducted = await this.openBalances(
      tx,
      list.map((r) => r.invoice.id),
    );
    return list.map(({ invoice: i, client: c }) => ({
      number: i.number,
      client: this.name(q, c.legalNameEn, c.legalNameAr),
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      status: i.status,
      total: i.total,
      outstanding: OPEN_INVOICE.includes(i.status as (typeof OPEN_INVOICE)[number])
        ? money(kwdToFils(i.total) - (deducted.get(i.id) ?? 0n))
        : money(0n),
    }));
  }

  private async paymentsReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const list = await tx
      .select({ payment: payments, invoice: invoices, client: clients })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(
        and(
          gte(payments.receivedOn, q.from),
          lte(payments.receivedOn, q.to),
          q.clientId ? eq(invoices.clientId, q.clientId) : undefined,
        ),
      )
      .orderBy(asc(payments.receivedOn));
    return list.map(({ payment: p, invoice: i, client: c }) => ({
      receivedOn: p.receivedOn,
      invoice: i.number,
      client: this.name(q, c.legalNameEn, c.legalNameAr),
      method: p.method,
      status: p.status,
      // Reversed payments are listed but count as zero.
      amount: p.status === 'recorded' ? p.amount : money(0n),
    }));
  }

  private async receivablesReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const open = await this.openInvoices(tx, q.clientId);
    const list = await tx.select().from(clients).orderBy(asc(clients.number));
    const today = kuwaitToday();
    const buckets = new Map<string, bigint[]>();
    for (const { invoice, outstanding } of open) {
      if (outstanding <= 0n) continue;
      const late = invoice.dueDate ? daysBetween(invoice.dueDate, today) : 0;
      const slot = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
      const b = buckets.get(invoice.clientId) ?? [0n, 0n, 0n, 0n, 0n];
      b[slot] = (b[slot] ?? 0n) + outstanding;
      buckets.set(invoice.clientId, b);
    }
    return list
      .filter((c) => buckets.has(c.id))
      .map((c) => {
        const b = buckets.get(c.id) ?? [0n, 0n, 0n, 0n, 0n];
        return {
          client: this.name(q, c.legalNameEn, c.legalNameAr),
          notDue: money(b[0] ?? 0n),
          days1to30: money(b[1] ?? 0n),
          days31to60: money(b[2] ?? 0n),
          days61to90: money(b[3] ?? 0n),
          over90: money(b[4] ?? 0n),
          total: money(b.reduce((t, v) => t + v, 0n)),
        };
      });
  }

  private async revenueReport(tx: TenantTransaction, q: Query): Promise<Row[]> {
    const issued = await tx
      .select({ date: invoices.issueDate, total: invoices.total })
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, [...LIVE_INVOICE]),
          gte(invoices.issueDate, q.from),
          lte(invoices.issueDate, q.to),
        ),
      );
    const received = await tx
      .select({ date: payments.receivedOn, amount: payments.amount })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'recorded'),
          gte(payments.receivedOn, q.from),
          lte(payments.receivedOn, q.to),
        ),
      );
    const months: string[] = [];
    for (let m = q.from.slice(0, 7); m <= q.to.slice(0, 7);) {
      months.push(m);
      const [y = 0, mo = 1] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return months.map((m) => ({
      month: m,
      invoiced: money(sumFils(issued.filter((r) => r.date?.startsWith(m)).map((r) => r.total))),
      received: money(sumFils(received.filter((r) => r.date.startsWith(m)).map((r) => r.amount))),
    }));
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
}
