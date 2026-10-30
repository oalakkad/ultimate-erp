import { z } from 'zod';
import { moneySchema } from './agreements.js';

// Payroll (docs/modules/payroll.md §7).

export const PAYROLL_RUN_STATUSES = [
  'draft',
  'calculated',
  'submitted',
  'approved',
  'paid',
  'cancelled',
] as const;
export const PAYROLL_INPUT_KINDS = [
  'overtime_hours',
  'bonus',
  'advance',
  'addition',
  'deduction',
] as const;
export const payrollRunStatusSchema = z.enum(PAYROLL_RUN_STATUSES);
export type PayrollRunStatus = z.infer<typeof payrollRunStatusSchema>;

const decimal = z.string().regex(/^\d{1,6}(\.\d{1,3})?$/, 'decimal');
const isoDate = z.iso.date();
const personRef = z.object({ membershipId: z.uuid(), name: z.string() }).strict();

/** Company payroll rules (versioned). Law-dependent values start disabled or at 0 and flagged. */
export const payrollRulesSchema = z
  .object({
    workingDaysDivisor: decimal,
    monthlyHours: decimal,
    overtime: z.object({ enabled: z.boolean(), multiplier: decimal }).strict(),
    unpaidLeave: z.object({ enabled: z.boolean() }).strict(),
    lateDeduction: z.object({ enabled: z.boolean() }).strict(),
    socialInsurance: z.object({ enabled: z.boolean(), employeePercent: decimal }).strict(),
  })
  .strict();
export type PayrollRulesInput = z.infer<typeof payrollRulesSchema>;

export const ruleSetSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    effectiveFrom: isoDate,
    rules: payrollRulesSchema,
    toVerify: z.boolean(),
    note: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const ruleSetListResponseSchema = z.object({ items: z.array(ruleSetSchema) }).strict();
export const newRuleSetRequestSchema = z
  .object({ effectiveFrom: isoDate, rules: payrollRulesSchema, note: z.string().trim().max(1000) })
  .strict();
export const verifyRuleSetRequestSchema = z
  .object({ confirm: z.literal(true), note: z.string().trim().min(1).max(1000) })
  .strict();

const allowanceSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    label: z.string().trim().min(1).max(120),
    amount: moneySchema,
  })
  .strict();
export const salaryRequestSchema = z
  .object({
    membershipId: z.uuid(),
    effectiveFrom: isoDate,
    basic: moneySchema,
    allowances: z.array(allowanceSchema).max(20),
    socialInsurance: z.boolean(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const salaryRecordSchema = z
  .object({
    id: z.uuid(),
    person: personRef,
    effectiveFrom: isoDate,
    basic: z.string(),
    currency: z.string(),
    allowances: z.array(
      z.object({ code: z.string(), label: z.string(), amount: z.string() }).strict(),
    ),
    socialInsurance: z.boolean(),
    note: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const salaryListQuerySchema = z.object({ membershipId: z.uuid().optional() }).strict();
export const salaryListResponseSchema = z.object({ items: z.array(salaryRecordSchema) }).strict();

export const payslipLineSchema = z
  .object({ code: z.string(), label: z.string(), basis: z.string(), amount: z.string() })
  .strict();
export const payslipSchema = z
  .object({
    id: z.uuid(),
    run: z
      .object({
        id: z.uuid(),
        period: z.string(),
        status: payrollRunStatusSchema,
        testRun: z.boolean(),
      })
      .strict(),
    person: personRef,
    gross: z.string(),
    deductions: z.string(),
    net: z.string(),
    currency: z.string(),
    lines: z.array(payslipLineSchema),
    warnings: z.array(z.string()),
  })
  .strict();
export type Payslip = z.infer<typeof payslipSchema>;
export const payslipListResponseSchema = z.object({ items: z.array(payslipSchema) }).strict();

export const payrollInputSchema = z
  .object({
    membershipId: z.uuid(),
    kind: z.enum(PAYROLL_INPUT_KINDS),
    value: decimal,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export const setInputsRequestSchema = z
  .object({ inputs: z.array(payrollInputSchema).max(2000) })
  .strict();

export const payrollRunSchema = z
  .object({
    id: z.uuid(),
    period: z.string(),
    status: payrollRunStatusSchema,
    /** Calculated with rules not yet verified by a Kuwaiti lawyer/accountant: never payable. */
    testRun: z.boolean(),
    ruleSetVersion: z.number().int().nullable(),
    preparedByName: z.string().nullable(),
    approvedByName: z.string().nullable(),
    paidByName: z.string().nullable(),
    paidAt: z.iso.datetime().nullable(),
    totals: z
      .object({
        people: z.number().int(),
        gross: z.string(),
        deductions: z.string(),
        net: z.string(),
      })
      .strict(),
    /** People without a salary record (skipped) and payslips with warnings. */
    warnings: z.array(z.object({ person: personRef, code: z.string() }).strict()),
    inputs: z.array(payrollInputSchema.extend({ id: z.uuid() }).strict()),
    payslips: z.array(payslipSchema),
    actions: z.array(
      z.enum(['inputs', 'calculate', 'submit', 'approve', 'pay', 'cancel', 'export']),
    ),
    version: z.number().int(),
  })
  .strict();
export type PayrollRun = z.infer<typeof payrollRunSchema>;
export const payrollRunSummarySchema = payrollRunSchema
  .pick({ id: true, period: true, status: true, testRun: true, totals: true })
  .strict();
export const payrollRunListResponseSchema = z
  .object({ items: z.array(payrollRunSummarySchema) })
  .strict();
export const newRunRequestSchema = z
  .object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
  .strict();
export const payrollIdParamSchema = z.object({ id: z.uuid() }).strict();
