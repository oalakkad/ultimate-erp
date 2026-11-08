import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  allocationPreviewSchema,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from '@ultimate-erp/contracts';
import { AvatarStack, EntityCard, StatusChip } from '@ultimate-erp/ui';
import { CalendarClock, Clock3 } from 'lucide-react';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { daysFromToday } from '../../lib/use-view-mode.js';
import { dateText } from '../contracts/shared.js';
import { hoursText } from '../projects/shared.js';

export const taskKey = (id: string) => ['tasks', 'detail', id] as const;

const CHIP: Record<TaskStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  backlog: 'info',
  ready: 'info',
  in_progress: 'warn',
  in_review: 'warn',
  completed: 'good',
  cancelled: 'bad',
};

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  const { t } = useI18n();
  return <StatusChip status={CHIP[status]} label={t(`ui.tasks.status.${status}`)} />;
}

const PRIORITY_TONE: Record<TaskPriority, string> = {
  low: 'bg-frame text-ink-2',
  normal: 'bg-sky text-sky-ink',
  high: 'bg-butter text-butter-ink',
  urgent: 'bg-blush text-blush-ink',
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useI18n();
  return (
    <small className={`rounded-full px-2 py-0.5 font-semibold ${PRIORITY_TONE[priority]}`}>
      {t(`ui.tasks.priority.${priority}`)}
    </small>
  );
}

export interface AllocationRow {
  membershipId: string;
  hours: string;
}

const HOURS = /^\d{1,8}(\.\d{1,2})?$/;
export const validHours = (rows: AllocationRow[]) => rows.every((r) => HOURS.test(r.hours.trim()));

/** Live effect of an allocation on the project budget and workloads (workflow steps 7–8). */
export function useAllocationPreview(projectId: string, rows: AllocationRow[], taskId?: string) {
  const ready = Boolean(projectId) && validHours(rows);
  const body = useDebounced(
    JSON.stringify({
      projectId,
      ...(taskId ? { taskId } : {}),
      allocations: rows.map((r) => ({ membershipId: r.membershipId, hours: r.hours.trim() })),
    }),
  );
  return useQuery({
    queryKey: ['tasks', 'preview', body],
    enabled: ready,
    queryFn: () =>
      api('/tasks/allocation-preview', {
        method: 'POST',
        body: JSON.parse(body) as object,
        schema: allocationPreviewSchema,
      }),
    placeholderData: (previous) => previous,
  });
}

/** Budget box shown while allocating: budget, this task, remaining after, per-person workload. */
export function AllocationImpact({
  preview,
}: {
  preview: ReturnType<typeof useAllocationPreview>;
}) {
  const { t, locale } = useI18n();
  const p = preview.data;
  if (!p) return null;
  return (
    <div
      role="status"
      className={`grid gap-2 rounded-tile p-3 text-[13.5px] ${p.overBudget ? 'bg-blush text-blush-ink' : 'bg-mint text-mint-ink'}`}
    >
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>
          {t('ui.tasks.impact.budgeted')}: <b>{hoursText(locale, t, p.budgeted)}</b>
        </span>
        <span>
          {t('ui.tasks.impact.elsewhere')}: <b>{hoursText(locale, t, p.allocatedElsewhere)}</b>
        </span>
        <span>
          {t('ui.tasks.impact.thisTask')}: <b>{hoursText(locale, t, p.thisTask)}</b>
        </span>
        <span>
          {t('ui.tasks.impact.remaining')}: <b>{hoursText(locale, t, p.remainingAfter)}</b>
        </span>
      </div>
      {p.overBudget && (
        <b>{p.canOverride ? t('ui.tasks.impact.overCanOverride') : t('ui.tasks.impact.over')}</b>
      )}
      {p.people.length > 0 && (
        <ul className="grid gap-0.5">
          {p.people.map((person) => (
            <li key={person.membershipId}>
              {t('ui.tasks.impact.workload', {
                name: person.name,
                hours: hoursText(locale, t, person.openWorkload),
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PRIORITY_ACCENT: Record<TaskPriority, 'sky' | 'lilac' | 'butter' | 'blush'> = {
  low: 'sky',
  normal: 'lilac',
  high: 'butter',
  urgent: 'blush',
};

/**
 * A task as a card (cards view and board): priority accent, title, project and client, who is
 * on it, allocated hours and the deadline in words ("3 days late", "Due in 2 days").
 */
export function TaskCard({ task, compact = false }: { task: TaskSummary; compact?: boolean }) {
  const { t, locale } = useI18n();
  const names = task.allocations.map((a) => a.name);
  const days = task.dueDate ? daysFromToday(task.dueDate) : null;
  const closed = task.status === 'completed' || task.status === 'cancelled';
  return (
    <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="block rounded-tile">
      <EntityCard
        accent={task.overdue ? 'blush' : PRIORITY_ACCENT[task.priority]}
        className={compact ? 'gap-2.5 p-3 pt-4' : undefined}
        header={
          <div className="grid gap-1">
            <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
              <span dir="ltr" className="num font-semibold">
                {task.number}
              </span>
              <span className="ms-auto flex gap-1">
                <PriorityBadge priority={task.priority} />
              </span>
            </span>
            <span className="text-[13.5px] leading-snug font-bold">{task.title}</span>
            <span className="truncate text-[12px] text-ink-2">
              {locale === 'ar' ? task.project.name.ar : task.project.name.en}
              {!compact && (
                <span className="text-ink-3">
                  {' · '}
                  {locale === 'ar' ? task.client.name.ar : task.client.name.en}
                </span>
              )}
            </span>
          </div>
        }
        footer={
          <>
            <span
              className={`flex items-center gap-1 ${task.overdue ? 'font-semibold text-blush-ink' : ''}`}
            >
              <CalendarClock aria-hidden className="size-3.5" />
              {days === null || closed
                ? task.dueDate
                  ? dateText(locale, task.dueDate)
                  : t('ui.ws.tasks.noDue')
                : days < 0
                  ? t('ui.ws.billing.lateBy', { count: -days })
                  : t('ui.ws.billing.dueIn', { count: days })}
            </span>
            <span className="ms-auto flex items-center gap-1">
              <Clock3 aria-hidden className="size-3.5" />
              {hoursText(locale, t, task.allocatedHours)}
            </span>
          </>
        }
      >
        <div className="flex items-center gap-2">
          {names.length > 0 ? (
            <AvatarStack
              names={names}
              size={compact ? 24 : 28}
              label={t('ui.ws.tasks.assigned', { names: names.join(', ') })}
            />
          ) : (
            <span className="text-[12px] text-ink-3">{t('ui.ws.tasks.unassigned')}</span>
          )}
          {!compact && (
            <span className="ms-auto">
              <TaskStatusChip status={task.status} />
            </span>
          )}
        </div>
      </EntityCard>
    </Link>
  );
}
