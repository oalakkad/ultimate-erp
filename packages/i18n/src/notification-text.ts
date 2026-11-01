import { isRole, type Notification } from '@ultimate-erp/contracts';
import { type Locale } from './types.js';
import { type MessageKey, translate } from './format.js';

type NotificationLike = Pick<Notification, 'type' | 'params'>;

/**
 * The sentence for one in-app notification, in the reader's language. Shared by the web app and
 * the mobile app so both say exactly the same thing (docs/modules/notifications.md).
 */
export function notificationText(locale: Locale, item: NotificationLike): string {
  const t = (key: MessageKey, params?: Record<string, string>) => translate(locale, key, params);
  const p = (name: string) => item.params[name] ?? '';
  switch (item.type) {
    case 'access.member_joined':
      return t('ui.notifications.types.access_member_joined', { name: p('name') });
    case 'access.roles_changed': {
      const roles = p('roles')
        .split(',')
        .filter(isRole)
        .map((role) => t(`roles.${role}`))
        .join(' · ');
      return t('ui.notifications.types.access_roles_changed', { roles });
    }
    case 'contracts.submitted':
    case 'contracts.approved':
    case 'contracts.rejected':
    case 'contracts.renewal_due':
    case 'contracts.expired': {
      const key = item.type.replace('.', '_') as 'contracts_expired';
      return t(`ui.notifications.types.${key}`, { number: p('number'), endDate: p('endDate') });
    }
    case 'billing.issued':
      return t('ui.notifications.types.billing_issued', { number: p('number'), total: p('total') });
    case 'projects.budget_threshold':
      return t('ui.notifications.types.projects_budget_threshold', {
        number: p('number'),
        percent: p('percent'),
      });
    case 'announcements.published':
      return t('ui.notifications.types.announcements_published', {
        title: (locale === 'ar' ? item.params.titleAr : item.params.title) ?? '',
      });
    case 'expenses.submitted':
      return t('ui.notifications.types.expenses_submitted', {
        name: p('name'),
        number: p('number'),
        total: p('total'),
      });
    case 'expenses.decided':
      return t(
        item.params.status === 'approved'
          ? 'ui.notifications.types.expenses_approved'
          : 'ui.notifications.types.expenses_rejected',
        { number: p('number') },
      );
    case 'expenses.reimbursed':
      return t('ui.notifications.types.expenses_reimbursed', {
        number: p('number'),
        total: p('total'),
      });
    case 'billing.overdue':
      return t('ui.notifications.types.billing_overdue', {
        number: p('number'),
        dueDate: p('dueDate'),
      });
    case 'payroll.submitted':
    case 'payroll.payslip_ready': {
      const key = item.type.replace('.', '_') as 'payroll_submitted';
      return t(`ui.notifications.types.${key}`, { period: p('period') });
    }
    case 'attendance.correction_requested':
      return t('ui.notifications.types.attendance_correction_requested', {
        name: p('name'),
        date: p('date'),
      });
    case 'attendance.correction_decided':
      return t(
        item.params.status === 'approved'
          ? 'ui.notifications.types.attendance_correction_approved'
          : 'ui.notifications.types.attendance_correction_rejected',
        { date: p('date') },
      );
    case 'leave.requested':
    case 'leave.approved':
    case 'leave.rejected':
    case 'leave.cancelled': {
      const key = item.type.replace('.', '_') as 'leave_requested';
      return t(`ui.notifications.types.${key}`, { name: p('name'), from: p('from'), to: p('to') });
    }
    case 'time.submitted':
    case 'time.approved':
    case 'time.rejected': {
      const key = item.type.replace('.', '_') as 'time_submitted';
      return t(`ui.notifications.types.${key}`, { name: p('name'), week: p('week') });
    }
    case 'tasks.assigned':
    case 'tasks.overdue': {
      const key = item.type.replace('.', '_') as 'tasks_assigned';
      return t(`ui.notifications.types.${key}`, {
        number: p('number'),
        title: p('title'),
        dueDate: p('dueDate'),
      });
    }
  }
}
