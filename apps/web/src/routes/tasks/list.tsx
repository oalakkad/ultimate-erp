import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  OPEN_TASK_STATUSES,
  type TaskStatus,
  type TaskSummary,
  taskListResponseSchema,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  Tabs,
  TextField,
} from '@ultimate-erp/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { canAny, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { dateText } from '../contracts/shared.js';
import { hoursText } from '../projects/shared.js';
import { PriorityBadge, TaskStatusChip } from './shared.js';

const PRIMARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover';
const BOARD: TaskStatus[] = [...OPEN_TASK_STATUSES, 'completed'];

/** Tasks I may see, as a list or a board by status (brief Module E). */
export function TasksPage() {
  const { t, locale } = useI18n();
  const access = useAccess(true);
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [mine, setMine] = useState(useSearchParam('mine') === '1');
  const [overdue, setOverdue] = useState(useSearchParam('overdue') === '1');
  const term = useDebounced(search.trim());

  const params = new URLSearchParams({ limit: '100' });
  if (term) params.set('search', term);
  if (state !== 'all') params.set('state', state);
  if (mine) params.set('assignee', 'me');
  if (overdue) params.set('overdue', 'true');

  const list = useInfiniteQuery({
    queryKey: ['tasks', 'list', params.toString()],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api(`/tasks?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`, {
        schema: taskListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    placeholderData: (previous) => previous,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(term) || state !== 'open' || mine || overdue;

  const frame = (content: React.ReactNode) => (
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
          title={filtered ? t('ui.tasks.noMatches') : t('ui.tasks.empty')}
          body={filtered ? t('ui.states.emptyBody') : t('ui.tasks.emptyBody')}
        />
      )}
      {items.length > 0 && content}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="w-fit"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('ui.tasks.loadMore')}
        </Button>
      )}
    </Card>
  );

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.tasks.title')}
        actions={
          canAny(access.data, 'tasks.task.manage') && (
            <Link to="/tasks/new" className={PRIMARY_LINK}>
              <Plus aria-hidden className="size-4" />
              {t('ui.tasks.new')}
            </Link>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <TextField
            label={t('ui.tasks.search')}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-44">
          <SelectField
            label={t('ui.tasks.show')}
            placeholder={t('ui.tasks.stateOpen')}
            value={state}
            onValueChange={(v) => {
              setState(v as 'open' | 'closed' | 'all');
            }}
            options={[
              { value: 'open', label: t('ui.tasks.stateOpen') },
              { value: 'closed', label: t('ui.tasks.stateClosed') },
              { value: 'all', label: t('ui.tasks.stateAll') },
            ]}
          />
        </div>
        <div className="flex gap-4 pb-2.5">
          <Checkbox label={t('ui.tasks.mine')} checked={mine} onCheckedChange={setMine} />
          <Checkbox
            label={t('ui.tasks.overdueOnly')}
            checked={overdue}
            onCheckedChange={setOverdue}
          />
        </div>
      </div>
      <Tabs
        label={t('ui.tasks.view')}
        items={[
          {
            value: 'list',
            label: t('ui.tasks.viewList'),
            content: frame(<TaskTable items={items} dim={list.isPlaceholderData} />),
          },
          {
            value: 'board',
            label: t('ui.tasks.viewBoard'),
            content: frame(
              <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
                {BOARD.map((status) => {
                  const column = items.filter((i) => i.status === status);
                  return (
                    <section
                      key={status}
                      aria-label={t(`ui.tasks.status.${status}`)}
                      className="grid min-w-[200px] content-start gap-2 rounded-tile bg-frame p-2.5"
                    >
                      <h2 className="flex items-center justify-between text-[13px] font-bold">
                        {t(`ui.tasks.status.${status}`)}
                        <span className="tabular-nums text-ink-3">{column.length}</span>
                      </h2>
                      {column.map((task) => (
                        <article
                          key={task.id}
                          className="grid gap-1 rounded-tile bg-card p-2.5 shadow-sm"
                        >
                          <Link
                            to="/tasks/$taskId"
                            params={{ taskId: task.id }}
                            className="text-[13.5px] font-semibold hover:underline"
                          >
                            {task.title}
                          </Link>
                          <small className="text-ink-3">
                            {locale === 'ar' ? task.project.name.ar : task.project.name.en}
                          </small>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <PriorityBadge priority={task.priority} />
                            {task.overdue && (
                              <small className="font-semibold text-bad">
                                {t('ui.tasks.overdue')}
                              </small>
                            )}
                          </div>
                        </article>
                      ))}
                    </section>
                  );
                })}
              </div>,
            ),
          },
        ]}
      />
    </div>
  );
}

/** Table of tasks; also used on the project page. */
export function TaskTable({ items, dim = false }: { items: TaskSummary[]; dim?: boolean }) {
  const { t, locale } = useI18n();
  return (
    <div className={`overflow-x-auto transition-opacity ${dim ? 'opacity-60' : ''}`}>
      <table className="w-full text-[13.5px]">
        <thead className="text-[12px] text-ink-3">
          <tr>
            <th scope="col" className="py-2 text-start font-semibold">
              {t('ui.tasks.colNumber')}
            </th>
            <th scope="col" className="py-2 text-start font-semibold">
              {t('ui.tasks.colTitle')}
            </th>
            <th scope="col" className="py-2 text-start font-semibold">
              {t('ui.tasks.colAssignees')}
            </th>
            <th scope="col" className="py-2 text-start font-semibold">
              {t('ui.tasks.colStatus')}
            </th>
            <th scope="col" className="py-2 text-start font-semibold">
              {t('ui.tasks.colDue')}
            </th>
            <th scope="col" className="py-2 text-end font-semibold">
              {t('ui.tasks.colHours')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((task) => (
            <tr key={task.id} className="border-t border-line">
              <td className="py-3 tabular-nums text-ink-2" dir="ltr">
                {task.number}
              </td>
              <td className="py-3">
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  className="font-semibold hover:underline"
                >
                  {task.title}
                </Link>
                <small className="block text-ink-3">
                  {locale === 'ar' ? task.project.name.ar : task.project.name.en}
                </small>
              </td>
              <td className="py-3">{task.allocations.map((a) => a.name).join('، ') || '—'}</td>
              <td className="py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <TaskStatusChip status={task.status} />
                  <PriorityBadge priority={task.priority} />
                </div>
              </td>
              <td className={`py-3 ${task.overdue ? 'font-semibold text-bad' : 'text-ink-2'}`}>
                {dateText(locale, task.dueDate)}
                {task.overdue && <span className="sr-only"> {t('ui.tasks.overdue')}</span>}
              </td>
              <td className="py-3 text-end tabular-nums">
                {hoursText(locale, t, task.allocatedHours)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
