import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './navigation.js';

describe('safeReturnTo', () => {
  it.each(['/', '/members', '/invitations/accept?token=abc-123_x', '/account#security'])(
    'keeps same-site path %s',
    (path) => {
      expect(safeReturnTo(path)).toBe(path);
    },
  );

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/ /x',
    'https://evil.example',
    'javascript:alert(1)',
    'members',
    '',
    undefined,
    42,
  ])('rejects %j', (value) => {
    expect(safeReturnTo(value)).toBeUndefined();
  });
});
