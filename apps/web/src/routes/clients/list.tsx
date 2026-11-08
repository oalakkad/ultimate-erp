import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CLIENT_STATUSES,
  clientListResponseSchema,
  type ClientListItem,
  type ClientStatus,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Avatar,
  Button,
  Card,
  CardGrid,
  Checkbox,
  EmptyState,
  EntityCard,
  ErrorState,
  initialsOf,
  LoadingState,
  SectionTitle,
  SelectField,
  StatusChip,
  TextField,
  ViewToggle,
} from '@ultimate-erp/ui';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Download,
  Landmark,
  MapPin,
  Plus,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { useViewMode } from '../../lib/use-view-mode.js';

type Sort = 'number' | 'name' | 'created';
const PAGE = 25;
const PRIMARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum shadow-[0_8px_18px_-8px_rgb(59_31_62/0.7)] transition-transform hover:-translate-y-px hover:bg-plum-hover';
const ACCENT: Record<ClientStatus, 'mint' | 'sky' | 'butter'> = {
  active: 'mint',
  prospect: 'sky',
  inactive: 'butter',
};

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
  const [mode, setMode] = useViewMode('clients');
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
  const items: ClientListItem[] = list.data?.pages.flatMap((p) => p.items) ?? [];
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

      <SectionTitle
        title={t('ui.ws.clients.directory')}
        count={items.length > 0 ? items.length : undefined}
        action={
          <ViewToggle
            label={t('ui.ws.view')}
            value={mode}
            onChange={setMode}
            cardsLabel={t('ui.ws.cards')}
            tableLabel={t('ui.ws.table')}
          />
        }
      />
      {mode === 'cards' && items.length > 0 && (
        <CardGrid className={list.isPlaceholderData ? 'opacity-60' : ''}>
          {items.map((c) => (
            <ClientCard key={c.id} client={c} />
          ))}
        </CardGrid>
      )}
      <Card className={mode === 'cards' && items.length > 0 ? 'hidden' : undefined}>
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
        {mode === 'table' && items.length > 0 && (
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
      </Card>
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="w-fit justify-self-center"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('ui.clients.loadMore')}
        </Button>
      )}
    </div>
  );
}

/** A client as a card: who they are, where, who looks after them and who to call. */
function ClientCard({ client: c }: { client: ClientListItem }) {
  const { t, locale } = useI18n();
  const name = locale === 'ar' ? c.legalName.ar : c.legalName.en;
  const other = locale === 'ar' ? c.legalName.en : c.legalName.ar;
  const TypeIcon = c.type === 'government' ? Landmark : Building2;
  return (
    <Link to="/clients/$clientId" params={{ clientId: c.id }} className="block rounded-tile">
      <EntityCard
        accent={c.archived ? undefined : ACCENT[c.status]}
        header={
          <div className="flex items-start gap-3">
            <Avatar name={c.legalName.en} initials={initialsOf(c.legalName.en)} size={46} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-[14px] font-bold">{name}</span>
              <span className="truncate text-[12px] text-ink-3">{other}</span>
              <span className="flex flex-wrap gap-1 pt-1">
                <StatusChip
                  status={STATUS_CHIP[c.status]}
                  label={t(`ui.clients.status.${c.status}`)}
                />
                {c.archived && <StatusChip status="bad" label={t('ui.clients.archivedBadge')} />}
              </span>
            </div>
            <span className="num text-[11.5px] font-semibold text-ink-3" dir="ltr">
              {c.number}
            </span>
          </div>
        }
        footer={
          <>
            <span className="flex items-center gap-1">
              <TypeIcon aria-hidden className="size-3.5" />
              {c.industry ?? t(`ui.clients.type.${c.type}`)}
            </span>
            {c.city && (
              <span className="flex items-center gap-1">
                <MapPin aria-hidden className="size-3.5" />
                {c.city}
              </span>
            )}
          </>
        }
      >
        <dl className="grid gap-2 text-[12.5px]">
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0 text-ink-3">{t('ui.ws.clients.manager')}</dt>
            <dd className="flex min-w-0 items-center gap-1.5 font-semibold">
              {c.accountManagerName ? (
                <>
                  <Avatar
                    name={c.accountManagerName}
                    initials={initialsOf(c.accountManagerName)}
                    size={20}
                  />
                  <span className="truncate">{c.accountManagerName}</span>
                </>
              ) : (
                <span className="font-normal text-ink-3">{t('ui.ws.clients.none')}</span>
              )}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0 text-ink-3">{t('ui.ws.clients.contact')}</dt>
            <dd className="flex min-w-0 items-center gap-1.5 font-semibold">
              {c.primaryContact ? (
                <>
                  <UserRound aria-hidden className="size-3.5 text-ink-3" />
                  <span className="truncate">{c.primaryContact}</span>
                </>
              ) : (
                <span className="font-normal text-ink-3">{t('ui.ws.clients.none')}</span>
              )}
            </dd>
          </div>
          {c.commercialRegistration && (
            <div className="flex items-center gap-2">
              <dt className="w-24 shrink-0 text-ink-3">{t('ui.clients.colCr')}</dt>
              <dd className="num font-semibold" dir="ltr">
                {c.commercialRegistration}
              </dd>
            </div>
          )}
        </dl>
      </EntityCard>
    </Link>
  );
}
