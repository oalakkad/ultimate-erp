import { describe, expect, it } from 'vitest';
import { addDays, isoDate, normaliseHours } from '../src/lib/dates';

describe('dates', () => {
  it('formats and shifts calendar dates', () => {
    expect(isoDate(new Date(2026, 2, 5))).toBe('2026-03-05');
    expect(addDays('2026-03-30', 3)).toBe('2026-04-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('accepts hours the API accepts', () => {
    expect(normaliseHours('3')).toBe('3');
    expect(normaliseHours(' 3,5 ')).toBe('3.5');
    expect(normaliseHours('0')).toBeNull();
    expect(normaliseHours('24.5')).toBeNull();
    expect(normaliseHours('abc')).toBeNull();
  });
});
