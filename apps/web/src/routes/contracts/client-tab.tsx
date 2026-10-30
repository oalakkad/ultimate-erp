import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { contractListResponseSchema } from '@ultimate-erp/contracts';
import { Card, EmptyState, ErrorState, LoadingState } from '@ultimate-erp/ui';
import { Plus } from 'lucide-react';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { ContractStatusChip, dateText, kindLabel } from './shared.js';

/** "Contracts" tab on a client page: that client's contracts and engagement letters. */
export function ClientContractsTab({
  clientId,
  canCreate,
}: {
  clientId: string;
  canCreate: boolean;
}) {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ['contracts', 'client', clientId],
    queryFn: () =>
      api(`/contracts?clientId=${clientId}&limit=100`, { schema: contractListResponseSchema }),
  });
  return (
    <Card
      action={
        canCreate ? (
          <Link
            to="/contracts/new"
            search={{ clientId }}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-plum hover:underline"
          >
            <Plus aria-hidden className="size-4" />
            {t('ui.contracts.newForClient')}
          </Link>
        ) : undefined
      }
    >
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, list.error)}
          reference={errorReference(t, list.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data?.items.length === 0 && (
        <EmptyState title={t('ui.contracts.empty')} body={t('ui.contracts.emptyBody')} />
      )}
      <ul className="grid gap-2">
        {list.data?.items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3">
            <div className="grid min-w-0 flex-1">
              <Link
                to="/contracts/$contractId"
                params={{ contractId: c.id }}
                className="font-semibold hover:underline"
              >
                {locale === 'ar' ? c.title.ar : c.title.en}
              </Link>
              <small className="text-ink-3">
                <span dir="ltr">{c.number}</span> · {kindLabel(t, c.kind)} ·{' '}
                {dateText(locale, c.endDate)}
              </small>
            </div>
            <ContractStatusChip status={c.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
