import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { taskListResponseSchema, workloadSchema } from '@ultimate-erp/contracts';
import { Card, EmptyState, ErrorState, LoadingState } from '@ultimate-erp/ui';
import { Plus } from 'lucide-react';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { hoursText } from '../projects/shared.js';
import { TaskTable } from './list.js';

/** "Tasks" tab on a project page: its tasks, and the team's workload when I may allocate. */
export function ProjectTasksTab({
  projectId,
  canCreate,
  canAllocate,
}: {
  projectId: string;
  canCreate: boolean;
  canAllocate: boolean;
}) {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ['tasks', 'list', 'project', projectId],
    queryFn: () =>
      api(`/tasks?projectId=${projectId}&limit=200`, { schema: taskListResponseSchema }),
  });
  const workload = useQuery({
    queryKey: ['tasks', 'workload', projectId],
    enabled: canAllocate,
    queryFn: () => api(`/workload?projectId=${projectId}`, { schema: workloadSchema }),
  });
  return (
    <div className="grid gap-4">
      <Card
        action={
          canCreate ? (
            <Link
              to="/tasks/new"
              search={{ projectId }}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-plum hover:underline"
            >
              <Plus aria-hidden className="size-4" />
              {t('ui.tasks.newForProject')}
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
          <EmptyState title={t('ui.tasks.empty')} body={t('ui.tasks.emptyBody')} />
        )}
        {list.data && list.data.items.length > 0 && <TaskTable items={list.data.items} />}
      </Card>
      {workload.data && workload.data.items.length > 0 && (
        <Card title={t('ui.tasks.workload')}>
          <ul className="grid gap-1.5 text-[13.5px]">
            {workload.data.items.map((w) => (
              <li
                key={w.membershipId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>{w.name}</span>
                <span className="text-ink-2">
                  {t('ui.tasks.workloadLine', {
                    tasks: w.openTasks,
                    hours: hoursText(locale, t, w.openHours),
                    overdue: w.overdueTasks,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
