import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  PROJECT_STATUSES,
  projectListResponseSchema,
  type ProjectStatus,
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
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { dateText } from '../contracts/shared.js';
import { hoursText, ProjectStatusChip } from './shared.js';

const PRIMARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover';

/** Projects / engagements (brief Module D): company-wide, or only the ones I work on. */
export function ProjectsPage() {
  const { t, locale } = useI18n();
  const access = useAccess(true);
  const companyWide = can(access.data, 'projects.project.read');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
  const [mine, setMine] = useState(false);
  const term = useDebounced(search.trim());

  const params = new URLSearchParams({ limit: '25' });
  if (term) params.set('search', term);
  if (status !== 'all') params.set('status', status);
  if (mine) params.set('mine', 'true');

  const list = useInfiniteQuery({
    queryKey: ['projects', 'list', params.toString()],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api(`/projects?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`, {
        schema: projectListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(term) || status !== 'all' || mine;

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.projects.title')}
        actions={
          can(access.data, 'projects.project.create') && (
            <Link to="/projects/new" className={PRIMARY_LINK}>
              <Plus aria-hidden className="size-4" />
              {t('ui.projects.new')}
            </Link>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <TextField
            label={t('ui.projects.search')}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-48">
          <SelectField
            label={t('ui.projects.colStatus')}
            placeholder={t('ui.projects.allStatuses')}
            value={status}
            onValueChange={(v) => {
              setStatus(v as ProjectStatus | 'all');
            }}
            options={[
              { value: 'all', label: t('ui.projects.allStatuses') },
              ...PROJECT_STATUSES.map((s) => ({ value: s, label: t(`ui.projects.status.${s}`) })),
            ]}
          />
        </div>
        {companyWide && (
          <div className="pb-2.5">
            <Checkbox label={t('ui.projects.mine')} checked={mine} onCheckedChange={setMine} />
          </div>
        )}
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
            title={filtered ? t('ui.projects.noMatches') : t('ui.projects.empty')}
            body={
              filtered
                ? t('ui.states.emptyBody')
                : companyWide
                  ? t('ui.projects.emptyBody')
                  : t('ui.projects.emptyMine')
            }
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
                    {t('ui.projects.colNumber')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.projects.colName')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.projects.colManager')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.projects.colStatus')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.projects.colEnd')}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {t('ui.projects.colBudget')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-3 tabular-nums text-ink-2" dir="ltr">
                      {p.number}
                    </td>
                    <td className="py-3">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: p.id }}
                        className="font-semibold hover:underline"
                      >
                        {locale === 'ar' ? p.name.ar : p.name.en}
                      </Link>
                      <small className="block text-ink-3">
                        {locale === 'ar' ? p.client.name.ar : p.client.name.en}
                      </small>
                    </td>
                    <td className="py-3">{p.manager?.name ?? '—'}</td>
                    <td className="py-3">
                      <ProjectStatusChip status={p.status} />
                    </td>
                    <td className="py-3 text-ink-2">{dateText(locale, p.endDate)}</td>
                    <td className="py-3 text-end tabular-nums">
                      {hoursText(locale, t, p.budgetHours)}
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
            {t('ui.projects.loadMore')}
          </Button>
        )}
      </Card>
    </div>
  );
}
