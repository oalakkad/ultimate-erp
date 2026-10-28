import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, translate } from './format.js';

describe('translate (ICU)', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'ui.states.errorReference', { id: 'abc-123' })).toBe(
      'Reference: abc-123',
    );
    expect(translate('ar', 'ui.states.errorReference', { id: 'abc-123' })).toBe('المرجع: abc-123');
  });

  it('uses each language’s plural rules', () => {
    expect(translate('en', 'ui.gallery.badgeCount', { count: 1 })).toBe('1 pending');
    expect(translate('en', 'ui.gallery.badgeCount', { count: 4 })).toBe('4 pending');
    expect(translate('ar', 'ui.gallery.badgeCount', { count: 2 })).toBe('معلقان');
    expect(translate('ar', 'ui.gallery.badgeCount', { count: 4 })).toBe('4 معلقة');
  });
});

describe('formatMoney', () => {
  it('keeps the currency’s decimals exactly, with Western digits in both languages', () => {
    expect(formatMoney('en', '182460.25', 'KWD')).toContain('182,460.250');
    expect(formatMoney('ar', '182460.25', 'KWD')).toContain('182,460.250');
    expect(formatMoney('en', '0.001', 'KWD')).toContain('0.001');
  });

  it('formats long decimal strings without floating-point rounding errors', () => {
    expect(formatMoney('en', '9007199254740993.125', 'KWD')).toContain('9,007,199,254,740,993.125');
  });

  it('rejects anything that is not a decimal string', () => {
    expect(() => formatMoney('en', '1e3', 'KWD')).toThrow();
  });
});

describe('formatDate', () => {
  it('uses Kuwait time by default', () => {
    // 21:30 UTC on 24 Oct is already 25 Oct in Kuwait (UTC+3).
    const date = new Date('2026-10-24T21:30:00Z');
    expect(formatDate('en', date, { day: 'numeric' })).toBe('25');
    expect(formatDate('en', date, { day: 'numeric' }, 'UTC')).toBe('24');
  });
});
