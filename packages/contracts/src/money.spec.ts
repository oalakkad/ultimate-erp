import { describe, expect, it } from 'vitest';
import { compareMoney, moneyRatio, subtractMoney, sumMoney } from './money.js';

describe('exact money arithmetic', () => {
  it('adds without floating-point error', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.300');
    expect(sumMoney(['7200.000', '6500.000', '2104.000', '0.001'])).toBe('15804.001');
    expect(sumMoney([])).toBe('0.000');
    expect(sumMoney(['-1.5', '1'])).toBe('-0.500');
  });
  it('handles large amounts beyond float precision', () => {
    expect(sumMoney(['9007199254740993.001', '1.000'])).toBe('9007199254740994.001');
  });
  it('subtracts and compares', () => {
    expect(subtractMoney('4104.000', '2000.000')).toBe('2104.000');
    expect(subtractMoney('1.000', '1.001')).toBe('-0.001');
    expect(compareMoney('10.000', '9.999')).toBe(1);
    expect(compareMoney('1', '1.000')).toBe(0);
  });
  it('refuses malformed amounts and hidden extra decimals', () => {
    expect(() => sumMoney(['1e3'])).toThrow();
    expect(() => sumMoney(['1.0001'])).toThrow();
    expect(sumMoney(['1.5000'])).toBe('1.500');
  });
  it('gives a proportion for drawing only', () => {
    expect(moneyRatio('25.000', '100.000')).toBe(0.25);
    expect(moneyRatio('1', '0')).toBe(0);
  });
});
