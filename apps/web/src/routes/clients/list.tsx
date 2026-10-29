import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CLIENT_STATUSES,
  clientListResponseSchema,
  type ClientStatus,
  type ClientSummary,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
  TextField,
} from '@ultimate-erp/ui';
import { ArrowDown, ArrowUp, Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';

type Sort = 'number' | 'name' | 'created';
const PAGE = 25;
const PRIMARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover';

export const STATUS_CHIP: Record<ClientStatus, 'good' | 'info' | 'warn'> = {
  active: 'good',
  prospect: 'info',
  inactive: 'warn',
};

/** Client list: search, filter, sort, page and export (docs/modules/clients.md §7.2). */
export function ClientsPage() {
  const { t, locale } = useI18n();
  const access = useAccess(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | 'all'>('all');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<Sort>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const term = useDebounced(search.trim());
  // Sorting by name follows the reader's language.
  const sortParam = sort === 'name' && locale === 'ar' ? 'nameAr' : sort;

  const params = new URLSearchParams({
    sort: sortParam,
    dir,
    limit: String(PAGE),
    archived: String(archived),
  });
  if (term) params.set('search', term);
  if (status !== 'all') params.set('status', status);

  const list = useInfiniteQuery({
    queryKey: ['clients', 'list', params.toString()],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api(
        `/clients?${params.toString()}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        {
          schema: clientListResponseSchema,
        },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
  });
  const items: ClientSummary[] = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(term) || status !== 'all' || archived;

  const header = (column: Sort, label: string) => {
    const active = sort === column;
    return (
      <th
        scope="col"
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="py-2 text-start"
      >
        <button
          type="button"
          aria-label={t('ui.clients.sortBy', { column: label })}
          onClick={() => {
            if (active) setDir(dir === 'asc' ? 'desc' : 'asc');
            else {
              setSort(column);
              setDir(column === 'created' ? 'desc' : 'asc');
            }
          }}
          className="inline-flex items-center gap-1 font-semibold hover:text-ink"
        >
          {label}
          {active &&
            (dir === 'asc' ? (
              <ArrowUp aria-hidden className="size-3.5" />
            ) : (
              <ArrowDown aria-hidden className="size-3.5" />
            ))}
        </button>
      </th>
    );
  };

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.clients.title')}
        actions={
          <>
            {can(access.data, 'clients.client.export') && (
              <a
                href={`/api/v1/clients/export.csv?${params.toString()}`}
                className="inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame"
                download
              >
                <Download aria-hidden className="size-4" />
                {t('ui.clients.export')}
              </a>
            )}
            {can(access.data, 'clients.client.create') && (
              <Link to="/clients/new" className={PRIMARY_LINK}>
                <Plus aria-hidden className="size-4" />
                {t('ui.clients.new')}
              </Link>
            )}
          </>
        }
      />

      {/* Filters: one row above the list they scope. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <TextField
            label={t('ui.clients.search')}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-48">
          <SelectField
            label={t('ui.clients.filterStatus')}
            placeholder={t('ui.clients.allStatuses')}
            value={status}
            onValueChange={(v) => {
              setStatus(v as ClientStatus | 'all');
            }}
            options={[
              { value: 'all', label: t('ui.clients.allStatuses') },
              ...CLIENT_STATUSES.map((s) => ({ value: s, label: t(`ui.clients.status.${s}`) })),
            ]}
          />
        </div>
        <div className="pb-2.5">
          <Checkbox
            label={t('ui.clients.showArchived')}
            checked={archived}
            onCheckedChange={setArchived}
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
            title={filtered ? t('ui.clients.noMatches') : t('ui.clients.empty')}
            body={filtered ? t('ui.states.emptyBody') : t('ui.clients.emptyBody')}
          />
        )}
        {items.length > 0 && (
          <div
            className={`overflow-x-auto transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}
          >
            <table className="w-full text-[13.5px]">
              <thead className="text-[12px] text-ink-3">
                <tr>
                  {header('number', t('ui.clients.colNumber'))}
                  {header('name', t('ui.clients.colName'))}
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.clients.colStatus')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.clients.colCr')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.clients.colCity')}
                  </th>
                  {header('created', t('ui.clients.colCreated'))}
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
                        to="/clients/$clientId"
                        params={{ clientId: c.id }}
                        className="font-semibold hover:underline"
                      >
                        {locale === 'ar' ? c.legalName.ar : c.legalName.en}
                      </Link>
                      <small className="block text-ink-3">
                        {locale === 'ar' ? c.legalName.en : c.legalName.ar}
                      </small>
                    </td>
                    <td className="py-3">
                      <span className="inline-flex flex-wrap gap-1">
                        <StatusChip
                          status={STATUS_CHIP[c.status]}
                          label={t(`ui.clients.status.${c.status}`)}
                        />
                        {c.archived && (
                          <StatusChip status="bad" label={t('ui.clients.archivedBadge')} />
                        )}
                      </span>
                    </td>
                    <td className="py-3 tabular-nums" dir="ltr">
                      {c.commercialRegistration ?? '—'}
                    </td>
                    <td className="py-3">{c.city ?? '—'}</td>
                    <td className="py-3 text-ink-2">
                      {formatDate(locale, new Date(c.createdAt), { dateStyle: 'medium' })}
                    </td>
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
            {t('ui.clients.loadMore')}
          </Button>
        )}
      </Card>
    </div>
  );
}
