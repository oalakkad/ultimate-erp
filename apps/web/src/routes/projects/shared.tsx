import { type ProjectStatus } from '@ultimate-erp/contracts';
import { formatNumber, type Locale } from '@ultimate-erp/i18n';
import { StatusChip } from '@ultimate-erp/ui';
import { useI18n } from '../../app/i18n.js';

export const projectKey = (id: string) => ['projects', 'detail', id] as const;

const CHIP: Record<ProjectStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  planned: 'info',
  active: 'good',
  on_hold: 'warn',
  completed: 'good',
  cancelled: 'bad',
};

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  const { t } = useI18n();
  return <StatusChip status={CHIP[status]} label={t(`ui.projects.status.${status}`)} />;
}

/** "37.5" → "37.5 h" in the reader's numerals (hours stay strings until display). */
export const hoursText = (locale: Locale, t: ReturnType<typeof useI18n>['t'], hours: string) =>
  t('ui.projects.hours', {
    hours: formatNumber(locale, Number(hours), { maximumFractionDigits: 2 }),
  });
