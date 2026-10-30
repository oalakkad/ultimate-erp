import { describe, expect, it } from 'vitest';
import { testConfig } from '../../../test/support/config.js';
import { FieldCipher } from './field-cipher.js';

describe('FieldCipher', () => {
  const cipher = new FieldCipher(testConfig());
  const tenant = '00000000-0000-4000-8000-000000000001';
  const other = '00000000-0000-4000-8000-000000000002';

  it('round-trips a value and never shows it in the sealed text', () => {
    const sealed = cipher.seal(tenant, {
      civilId: '290010112345',
      iban: 'KW81CBKU0000000000001234560101',
    });
    expect(sealed).not.toContain('290010112345');
    expect(sealed).not.toContain('KW81');
    expect(cipher.open(tenant, sealed)).toEqual({
      civilId: '290010112345',
      iban: 'KW81CBKU0000000000001234560101',
    });
  });

  it('refuses a value moved to another company, tampered with, or sealed with another key', () => {
    const sealed = cipher.seal(tenant, { a: 1 });
    expect(() => cipher.open(other, sealed)).toThrow();
    const parts = sealed.split('.');
    const body = parts[2] ?? '';
    parts[2] = `${body.startsWith('A') ? 'B' : 'A'}${body.slice(1)}`;
    expect(() => cipher.open(tenant, parts.join('.'))).toThrow();
    const otherKey = new FieldCipher(
      testConfig({ DATA_ENCRYPTION_KEY: 'another-key-for-tests-only-0123456789' }),
    );
    expect(() => otherKey.open(tenant, sealed)).toThrow();
  });

  it('hashes look-up values per company, ignoring spaces and case', () => {
    expect(cipher.lookupHash(tenant, '2900 1011 2345')).toBe(
      cipher.lookupHash(tenant, '290010112345'),
    );
    expect(cipher.lookupHash(tenant, 'ab12')).toBe(cipher.lookupHash(tenant, 'AB12'));
    expect(cipher.lookupHash(tenant, '290010112345')).not.toBe(
      cipher.lookupHash(other, '290010112345'),
    );
  });
});
