import { NOTIFICATION_TYPES } from '@ultimate-erp/contracts';
import { describe, expect, it } from 'vitest';
import { notificationText } from './notification-text.js';

describe('notificationText', () => {
  it('produces a sentence for every notification type in both languages', () => {
    for (const type of NOTIFICATION_TYPES) {
      const params = { name: 'Sara', number: 'T-0001', title: 'Audit plan', roles: 'manager' };
      const en = notificationText('en', { type, params });
      const ar = notificationText('ar', { type, params });
      expect(en, type).not.toBe('');
      expect(ar, type).not.toBe('');
      expect(ar, type).not.toBe(en);
    }
  });

  it('fills the parameters', () => {
    expect(
      notificationText('en', {
        type: 'tasks.assigned',
        params: { number: 'T-0007', title: 'Plan' },
      }),
    ).toContain('T-0007');
    expect(
      notificationText('en', {
        type: 'access.roles_changed',
        params: { roles: 'manager,finance' },
      }),
    ).toContain('Manager');
  });
});
