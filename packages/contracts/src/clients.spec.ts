import { describe, expect, it } from 'vitest';
import { clientNameKey, createClientRequestSchema } from './clients.js';

describe('clientNameKey (duplicate warning)', () => {
  it.each([
    ['Al-Noor Trading Co. W.L.L.', 'al noor trading'],
    ['AL NOOR TRADING K.S.C.C.', 'al noor trading'],
    ['The Gulf Audit Group', 'gulf audit'],
    ['شركة النور للتجارة ذ.م.م', 'النور للتجاره'],
    ['شركه النُّور للتجاره', 'النور للتجاره'],
    ['مؤسسة الأمل', 'الامل'],
  ])('%s → %s', (name, key) => {
    expect(clientNameKey(name)).toBe(key);
  });

  it('keeps genuinely different names apart', () => {
    expect(clientNameKey('Gulf Audit Partners')).not.toBe(clientNameKey('Gulf Audit'));
  });
});

describe('createClientRequestSchema', () => {
  it('treats empty optional fields as "not set" and normalises codes', () => {
    const parsed = createClientRequestSchema.parse({
      legalNameEn: '  Acme ',
      legalNameAr: 'أكمي',
      email: '',
      phone: '',
      commercialRegistration: 'cr-12',
      country: 'kw',
    });
    expect(parsed).toMatchObject({
      legalNameEn: 'Acme',
      email: null,
      phone: null,
      commercialRegistration: 'CR-12',
      country: 'KW',
    });
  });

  it('rejects unknown fields (no mass assignment)', () => {
    expect(() =>
      createClientRequestSchema.parse({ legalNameEn: 'a', legalNameAr: 'b', tenantId: 'x' }),
    ).toThrow();
  });
});
