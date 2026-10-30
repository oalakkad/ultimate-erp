import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  type ContractKind,
  contractListResponseSchema,
  type ContractStatus,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
} from '@ultimate-erp/ui';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { ContractStatusChip, dateText, kindLabel, moneyText } from './shared.js';

const SECONDARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame';
const PRIMARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover';

/** Register of contracts and engagement letters (brief Module C). */
export function ContractsPage() {
  const { t, locale } = useI18n();
  const access = useAccess(true);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<ContractKind | 'all'>('all');
  const [status, setStatus] = useState<ContractStatus | 'all'>('all');
  const [expiring, setExpiring] = useState(useSearchParam('expiring') === '1');
  const term = useDebounced(search.trim());

  const params = new URLSearchParams({ limit: '25' });
  if (term) params.set('search', term);
  if (kind !== 'all') params.set('kind', kind);
  if (status !== 'all') params.set('status', status);
  if (expiring) params.set('expiringWithinDays', '60');

  const list = useInfiniteQuery({
    queryKey: ['contracts', 'list', params.toString()],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api(`/contracts?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`, {
        schema: contractListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(term) || kind !== 'all' || status !== 'all' || expiring;

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.contracts.title')}
        actions={
          <>
            <Link to="/contracts/templates" className={SECONDARY_LINK}>
              <FileText aria-hidden className="size-4" />
              {t('ui.contracts.templates')}
            </Link>
            {can(access.data, 'contracts.contract.manage') && (
              <Link to="/contracts/new" className={PRIMARY_LINK}>
                <Plus aria-hidden className="size-4" />
                {t('ui.contracts.new')}
              </Link>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <TextField
            label={t('ui.contracts.search')}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-44">
          <SelectField
            label={t('ui.contracts.fields.kind')}
            placeholder={t('ui.contracts.allKinds')}
            value={kind}
            onValueChange={(v) => {
              setKind(v as ContractKind | 'all');
            }}
            options={[
              { value: 'all', label: t('ui.contracts.allKinds') },
              ...CONTRACT_KINDS.map((k) => ({ value: k, label: kindLabel(t, k) })),
            ]}
          />
        </div>
        <div className="w-48">
          <SelectField
            label={t('ui.contracts.colStatus')}
            placeholder={t('ui.contracts.allStatuses')}
            value={status}
            onValueChange={(v) => {
              setStatus(v as ContractStatus | 'all');
            }}
            options={[
              { value: 'all', label: t('ui.contracts.allStatuses') },
              ...CONTRACT_STATUSES.map((s) => ({ value: s, label: t(`ui.contracts.status.${s}`) })),
            ]}
          />
        </div>
        <div className="pb-2.5">
          <Checkbox
            label={t('ui.contracts.expiringSoon')}
            checked={expiring}
            onCheckedChange={setExpiring}
          />
        </div>
      </div>
      <Card>
        {list.isPending && <LoadingState label={t('ui.common.loading')} />}
        {list.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, list.error)}
            reference={errorReference(t, list.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void list.refetch()}
          />
        )}
        {list.isSuccess && items.length === 0 && (
          <EmptyState
            title={filtered ? t('ui.contracts.noMatches') : t('ui.contracts.empty')}
            body={filtered ? t('ui.states.emptyBody') : t('ui.contracts.emptyBody')}
          />
        )}
        {items.length > 0 && (
          <div
            className={`overflow-x-auto transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}
          >
            <table className="w-full text-[13.5px]">
              <thead className="text-[12px] text-ink-3">
                <tr>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.contracts.colNumber')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.contracts.colTitle')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.contracts.colClient')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.contracts.colStatus')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.contracts.colEnd')}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {t('ui.contracts.colValue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-3 tabular-nums text-ink-2" dir="ltr">
                      {c.number}
                    </td>
                    <td className="py-3">
                      <Link
                        to="/contracts/$contractId"
                        params={{ contractId: c.id }}
                        className="font-semibold hover:underline"
                      >
                        {locale === 'ar' ? c.title.ar : c.title.en}
                      </Link>
                      <small className="block text-ink-3">{kindLabel(t, c.kind)}</small>
                    </td>
                    <td className="py-3">
                      {locale === 'ar' ? c.client.name.ar : c.client.name.en}
                    </td>
                    <td className="py-3">
                      <ContractStatusChip status={c.status} />
                    </td>
                    <td className="py-3 text-ink-2">{dateText(locale, c.endDate)}</td>
                    <td className="py-3 text-end tabular-nums">{moneyText(locale, c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
          <Button
            variant="secondary"
            className="w-fit"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('ui.contracts.loadMore')}
          </Button>
        )}
      </Card>
    </div>
  );
}
