import {
  type ContractKind,
  type ContractStatus,
  type ContractSummary,
} from '@ultimate-erp/contracts';
import { formatDate, formatMoney, type Locale } from '@ultimate-erp/i18n';
import { StatusChip } from '@ultimate-erp/ui';
import { useI18n } from '../../app/i18n.js';

export const contractKey = (id: string) => ['contracts', 'detail', id] as const;

const CHIP: Record<ContractStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  draft: 'info',
  in_review: 'warn',
  approved: 'info',
  sent: 'info',
  signed: 'good',
  active: 'good',
  expired: 'bad',
  terminated: 'bad',
};

export function ContractStatusChip({ status }: { status: ContractStatus }) {
  const { t } = useI18n();
  return <StatusChip status={CHIP[status]} label={t(`ui.contracts.status.${status}`)} />;
}

export const kindLabel = (t: ReturnType<typeof useI18n>['t'], kind: ContractKind) =>
  t(`ui.contracts.kind.${kind}`);

export const dateText = (locale: Locale, iso: string | null) =>
  iso ? formatDate(locale, new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' }) : '—';

export const moneyText = (locale: Locale, c: Pick<ContractSummary, 'valueAmount' | 'currency'>) =>
  c.valueAmount ? formatMoney(locale, c.valueAmount, c.currency) : '—';
