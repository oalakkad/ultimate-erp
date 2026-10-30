import { describe, expect, it } from 'vitest';
import {
  calculatePayslip,
  filsToKwd,
  kwdToFils,
  type MonthInputs,
  mulDivRound,
  type PayrollRules,
} from './engine.js';

const rules: PayrollRules = {
  workingDaysDivisor: '26',
  monthlyHours: '208',
  overtime: { enabled: true, multiplier: '1.25' },
  unpaidLeave: { enabled: true },
  lateDeduction: { enabled: false },
  socialInsurance: { enabled: false, employeePercent: '0' },
};
const month = (over: Partial<MonthInputs> = {}): MonthInputs => ({
  overtimeHours: '0',
  unpaidLeaveDays: '0',
  lateMinutes: 0,
  additions: [],
  deductions: [],
  ...over,
});
const salary = {
  basic: kwdToFils('1000'),
  allowances: [{ code: 'housing', label: 'Housing', amount: kwdToFils('150') }],
  socialInsurance: true,
};

describe('money helpers', () => {
  it('converts KWD and rounds half-up away from zero', () => {
    expect(kwdToFils('1000')).toBe(1_000_000n);
    expect(kwdToFils('12.3456')).toBe(12_346n);
    expect(kwdToFils('12.3455')).toBe(12_346n);
    expect(kwdToFils('12.3454')).toBe(12_345n);
    expect(filsToKwd(12_005n)).toBe('12.005');
    expect(filsToKwd(-5n)).toBe('-0.005');
    expect(mulDivRound(5n, 1n, 2n)).toBe(3n);
    expect(mulDivRound(-5n, 1n, 2n)).toBe(-3n);
    expect(mulDivRound(4n, 1n, 3n)).toBe(1n);
  });
});

describe('calculatePayslip', () => {
  it('computes the spec example line by line (docs/modules/payroll.md §8.1)', () => {
    const result = calculatePayslip(
      rules,
      salary,
      month({
        overtimeHours: '4',
        unpaidLeaveDays: '2',
        additions: [{ kind: 'bonus', amount: kwdToFils('50'), note: 'Q3 bonus' }],
      }),
    );
    const byCode = Object.fromEntries(result.lines.map((l) => [l.code, filsToKwd(l.amount)]));
    // 4 × 1000 ÷ 208 × 1.25 = 24.0384615… → 24.038
    // 2 × 1000 ÷ 26 = 76.923076… → 76.923
    expect(byCode).toEqual({
      basic: '1000.000',
      'allowance.housing': '150.000',
      overtime: '24.038',
      bonus: '50.000',
      unpaid_leave: '-76.923',
    });
    expect(filsToKwd(result.gross)).toBe('1224.038');
    expect(filsToKwd(result.deductions)).toBe('76.923');
    expect(filsToKwd(result.net)).toBe('1147.115');
    expect(result.lines.find((l) => l.code === 'overtime')?.basis).toBe(
      '4 h × 1000.000 ÷ 208 × 1.25',
    );
  });

  it('applies only enabled rules', () => {
    const off: PayrollRules = {
      ...rules,
      overtime: { enabled: false, multiplier: '1.25' },
      unpaidLeave: { enabled: false },
    };
    const result = calculatePayslip(
      off,
      salary,
      month({ overtimeHours: '10', unpaidLeaveDays: '3', lateMinutes: 90 }),
    );
    expect(result.lines.map((l) => l.code)).toEqual(['basic', 'allowance.housing']);
    const withLate = calculatePayslip(
      { ...rules, lateDeduction: { enabled: true } },
      salary,
      month({ lateMinutes: 90 }),
    );
    // 90 × 1000 ÷ (208 × 60) = 7.2115… → 7.212
    expect(filsToKwd(withLate.lines.find((l) => l.code === 'late')?.amount ?? 0n)).toBe('-7.212');
  });

  it('deducts social insurance only when enabled, with a rate, for eligible people', () => {
    const si: PayrollRules = {
      ...rules,
      socialInsurance: { enabled: true, employeePercent: '10.5' },
    };
    const eligible = calculatePayslip(si, salary, month());
    expect(filsToKwd(eligible.lines.find((l) => l.code === 'social_insurance')?.amount ?? 0n)).toBe(
      '-105.000',
    );
    expect(
      calculatePayslip(si, { ...salary, socialInsurance: false }, month()).lines.some(
        (l) => l.code === 'social_insurance',
      ),
    ).toBe(false);
    expect(
      calculatePayslip(rules, salary, month()).lines.some((l) => l.code === 'social_insurance'),
    ).toBe(false);
  });

  it('never pays a negative net and says so', () => {
    const result = calculatePayslip(
      rules,
      salary,
      month({ deductions: [{ kind: 'advance', amount: kwdToFils('2000'), note: 'Advance' }] }),
    );
    expect(result.net).toBe(0n);
    expect(result.warnings).toEqual(['negative_net']);
  });

  it('handles fractional inputs exactly', () => {
    const result = calculatePayslip(
      rules,
      { basic: kwdToFils('333.333'), allowances: [], socialInsurance: false },
      month({ overtimeHours: '1.5', unpaidLeaveDays: '0.5' }),
    );
    // 1.5 × 333.333 ÷ 208 × 1.25 = 3.004805… → 3.005 ; 0.5 × 333.333 ÷ 26 = 6.410250 → 6.410
    expect(result.lines.find((l) => l.code === 'overtime')?.amount).toBe(3005n);
    expect(result.lines.find((l) => l.code === 'unpaid_leave')?.amount).toBe(-6410n);
  });
});
