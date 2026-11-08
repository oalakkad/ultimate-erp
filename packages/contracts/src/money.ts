// Exact money arithmetic for display totals in the clients (ADR-0005: never floats). Amounts
// are the API's decimal strings; they are added as whole thousandths (fils for KWD) in BigInt,
// so "0.1" + "0.2" is exactly "0.300". `moneyRatio` returns a float ONLY for sizing a bar or a
// ring — it is never shown as a figure.

const SCALE = 3;
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function toUnits(amount: string): bigint {
  const m = DECIMAL.exec(amount.trim());
  if (!m) throw new Error(`Not a decimal amount: ${amount}`);
  const [, sign, whole = '0', frac = ''] = m;
  if (frac.length > SCALE && /[1-9]/.test(frac.slice(SCALE)))
    throw new Error(`More than ${String(SCALE)} decimals: ${amount}`);
  const units = BigInt(whole) * 1000n + BigInt(frac.slice(0, SCALE).padEnd(SCALE, '0'));
  return sign === '-' ? -units : units;
}

function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/** Exact sum of decimal amounts, as a decimal string with 3 places ("0.000" for none). */
export function sumMoney(amounts: readonly string[]): string {
  return fromUnits(amounts.reduce((total, a) => total + toUnits(a), 0n));
}

/** Exact `a - b`. */
export function subtractMoney(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

/** -1, 0 or 1. */
export function compareMoney(a: string, b: string): number {
  const d = toUnits(a) - toUnits(b);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

/** part / whole as a float in [0, ∞) — for drawing proportions only, never for display. */
export function moneyRatio(part: string, whole: string): number {
  const w = toUnits(whole);
  if (w === 0n) return 0;
  return Number((toUnits(part) * 1_000_000n) / w) / 1_000_000;
}
