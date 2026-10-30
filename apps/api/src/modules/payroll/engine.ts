// Payroll calculation engine (docs/modules/payroll.md §3). Pure: explicit inputs in, a traced
// result out. Amounts are integer fils (1 KWD = 1000 fils); rates and quantities are exact
// decimal strings. Every line is rounded half-up to the fil once, at the line.

export interface PayrollRules {
  workingDaysDivisor: string;
  monthlyHours: string;
  overtime: { enabled: boolean; multiplier: string };
  unpaidLeave: { enabled: boolean };
  lateDeduction: { enabled: boolean };
  socialInsurance: { enabled: boolean; employeePercent: string };
}

export interface SalaryInput {
  /** Fils. */
  basic: bigint;
  allowances: { code: string; label: string; amount: bigint }[];
  socialInsurance: boolean;
}

export interface MonthInputs {
  overtimeHours: string;
  unpaidLeaveDays: string;
  lateMinutes: number;
  additions: { kind: 'bonus' | 'adjustment'; amount: bigint; note: string }[];
  deductions: { kind: 'advance' | 'adjustment'; amount: bigint; note: string }[];
}

export interface PayslipLine {
  code: string;
  label: string;
  /** How it was worked out, e.g. "4 h × 1000.000 ÷ 208 × 1.25". */
  basis: string;
  /** Fils; deductions are negative. */
  amount: bigint;
}

export interface PayslipResult {
  lines: PayslipLine[];
  gross: bigint;
  deductions: bigint;
  net: bigint;
  /** Net below zero is reported, never paid as a negative amount. */
  warnings: 'negative_net'[];
}

/** An exact decimal "12.345" as a fraction n / 10^scale. */
function fraction(value: string): { n: bigint; d: bigint } {
  const negative = value.startsWith('-');
  const [whole = '0', frac = ''] = (negative ? value.slice(1) : value).split('.');
  const d = 10n ** BigInt(frac.length);
  const n = BigInt(whole) * d + BigInt(frac || '0');
  return { n: negative ? -n : n, d };
}

/** a × (num / den), rounded half-up (away from zero) to an integer. */
export function mulDivRound(a: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  const product = a * num;
  const sign = product < 0n !== den < 0n ? -1n : 1n;
  const p = product < 0n ? -product : product;
  const q = den < 0n ? -den : den;
  return sign * ((p * 2n + q) / (q * 2n));
}

export const filsToKwd = (fils: bigint): string => {
  const sign = fils < 0n ? '-' : '';
  const abs = fils < 0n ? -fils : fils;
  return `${sign}${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`;
};

export const kwdToFils = (kwd: string): bigint => {
  const { n, d } = fraction(kwd);
  return mulDivRound(n, 1000n, d);
};

export function calculatePayslip(
  rules: PayrollRules,
  salary: SalaryInput,
  month: MonthInputs,
): PayslipResult {
  const lines: PayslipLine[] = [];
  const kwd = filsToKwd;
  lines.push({
    code: 'basic',
    label: 'Basic salary',
    basis: kwd(salary.basic),
    amount: salary.basic,
  });
  for (const a of salary.allowances) {
    lines.push({
      code: `allowance.${a.code}`,
      label: a.label,
      basis: kwd(a.amount),
      amount: a.amount,
    });
  }

  const hours = fraction(rules.monthlyHours);
  if (rules.overtime.enabled) {
    const ot = fraction(month.overtimeHours);
    const mult = fraction(rules.overtime.multiplier);
    if (ot.n !== 0n && hours.n !== 0n) {
      // overtime × basic ÷ monthlyHours × multiplier, one rounding at the end
      const amount = mulDivRound(salary.basic, ot.n * hours.d * mult.n, ot.d * hours.n * mult.d);
      lines.push({
        code: 'overtime',
        label: 'Overtime',
        basis: `${month.overtimeHours} h × ${kwd(salary.basic)} ÷ ${rules.monthlyHours} × ${rules.overtime.multiplier}`,
        amount,
      });
    }
  }
  for (const add of month.additions) {
    lines.push({
      code: add.kind,
      label: add.kind === 'bonus' ? 'Bonus' : 'Adjustment',
      basis: add.note,
      amount: add.amount,
    });
  }

  if (rules.unpaidLeave.enabled) {
    const days = fraction(month.unpaidLeaveDays);
    const divisor = fraction(rules.workingDaysDivisor);
    if (days.n !== 0n && divisor.n !== 0n) {
      const amount = -mulDivRound(salary.basic, days.n * divisor.d, days.d * divisor.n);
      lines.push({
        code: 'unpaid_leave',
        label: 'Unpaid leave',
        basis: `${month.unpaidLeaveDays} days × ${kwd(salary.basic)} ÷ ${rules.workingDaysDivisor}`,
        amount,
      });
    }
  }
  if (rules.lateDeduction.enabled && month.lateMinutes > 0 && hours.n !== 0n) {
    const amount = -mulDivRound(salary.basic, BigInt(month.lateMinutes) * hours.d, hours.n * 60n);
    lines.push({
      code: 'late',
      label: 'Late arrivals',
      basis: `${month.lateMinutes} min × ${kwd(salary.basic)} ÷ (${rules.monthlyHours} × 60)`,
      amount,
    });
  }
  for (const ded of month.deductions) {
    lines.push({
      code: ded.kind,
      label: ded.kind === 'advance' ? 'Advance' : 'Adjustment',
      basis: ded.note,
      amount: -ded.amount,
    });
  }
  if (rules.socialInsurance.enabled && salary.socialInsurance) {
    const pct = fraction(rules.socialInsurance.employeePercent);
    if (pct.n !== 0n) {
      lines.push({
        code: 'social_insurance',
        label: 'Social insurance (employee share)',
        basis: `${rules.socialInsurance.employeePercent}% × ${kwd(salary.basic)}`,
        amount: -mulDivRound(salary.basic, pct.n, pct.d * 100n),
      });
    }
  }

  const gross = lines.filter((l) => l.amount > 0n).reduce((t, l) => t + l.amount, 0n);
  const deductions = -lines.filter((l) => l.amount < 0n).reduce((t, l) => t + l.amount, 0n);
  const net = gross - deductions;
  return {
    lines,
    gross,
    deductions,
    net: net < 0n ? 0n : net,
    warnings: net < 0n ? ['negative_net'] : [],
  };
}
