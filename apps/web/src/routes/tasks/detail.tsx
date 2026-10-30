import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  commentListResponseSchema,
  projectSchema,
  type Task,
  TASK_PRIORITIES,
  taskActivitySchema,
  taskListResponseSchema,
  type TaskPriority,
  taskSchema,
  type TaskStatus,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  Tabs,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { DocumentsTab } from '../clients/tabs.js';
import { dateText } from '../contracts/shared.js';
import { hoursText } from '../projects/shared.js';
import { TaskTimeCard } from '../time/task-time.js';
import { AllocationEditor } from './new.js';
import {
  AllocationImpact,
  type AllocationRow,
  PriorityBadge,
  taskKey,
  TaskStatusChip,
  useAllocationPreview,
  validHours,
} from './shared.js';

/** One task: workflow, details, people and hours, dependencies, comments, documents, activity. */
export function TaskDetailPage() {
  const { t, locale } = useI18n();
  const { taskId } = useParams({ from: '/app/tasks/$taskId' });
  const task = useQuery({
    queryKey: taskKey(taskId),
    queryFn: () => api(`/tasks/${taskId}`, { schema: taskSchema }),
  });
  if (task.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (task.isError) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, task.error)}
        reference={errorReference(t, task.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void task.refetch()}
      />
    );
  }
  const x = task.data;
  return (
    <div className="grid gap-4">
      <AppPageHeader title={x.title} />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span dir="ltr" className="tabular-nums">
          {x.number}
        </span>
        <span aria-hidden>·</span>
        <Link
          to="/projects/$projectId"
          params={{ projectId: x.project.id }}
          className="font-semibold text-plum hover:underline"
        >
          {locale === 'ar' ? x.project.name.ar : x.project.name.en}
        </Link>
        <span aria-hidden>·</span>
        <span>{locale === 'ar' ? x.client.name.ar : x.client.name.en}</span>
        <TaskStatusChip status={x.status} />
        <PriorityBadge priority={x.priority} />
        {x.overdue && <b className="text-bad">{t('ui.tasks.overdue')}</b>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <DetailsCard key={x.version} task={x} />
          <Tabs
            label={x.title}
            items={[
              {
                value: 'comments',
                label: t('ui.tasks.tabs.comments'),
                content: <CommentsCard task={x} />,
              },
              {
                value: 'documents',
                label: t('ui.tasks.tabs.documents'),
                content: (
                  <DocumentsTab
                    basePath={`/tasks/${x.id}`}
                    canUpdate={x.actions.includes('documents')}
                  />
                ),
              },
              {
                value: 'activity',
                label: t('ui.tasks.tabs.activity'),
                content: <ActivityCard task={x} />,
              },
            ]}
          />
        </div>
        <div className="grid content-start gap-4">
          <WorkflowCard task={x} />
          <PeopleCard task={x} />
          <TaskTimeCard
            taskId={x.id}
            canLog={x.actions.includes('comment') && x.status !== 'cancelled'}
          />
          <DependenciesCard task={x} />
        </div>
      </div>
    </div>
  );
}

function useSaved() {
  const queryClient = useQueryClient();
  return async (updated: Task) => {
    queryClient.setQueryData(taskKey(updated.id), updated);
    await queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
}

function WorkflowCard({ task: x }: { task: Task }) {
  const { t } = useI18n();
  const toast = useToast();
  const saved = useSaved();
  const move = useMutation({
    mutationFn: (status: TaskStatus) =>
      api(`/tasks/${x.id}/status`, { method: 'POST', body: { status }, schema: taskSchema }),
    onSuccess: async (updated) => {
      await saved(updated);
      toast({ tone: 'good', title: t('ui.tasks.statusChanged') });
    },
  });
  const open = x.blockedBy.filter((b) => b.status !== 'completed' && b.status !== 'cancelled');
  return (
    <Card title={t('ui.tasks.workflow')}>
      <TaskStatusChip status={x.status} />
      {open.length > 0 && (
        <p role="status" className="rounded-tile bg-butter p-3 text-[13px] text-butter-ink">
          {t('ui.tasks.blockedNote', { list: open.map((b) => b.number).join(', ') })}
        </p>
      )}
      <div className="grid gap-2">
        {x.nextStatuses.map((s) => (
          <Button
            key={s}
            variant={
              s === 'cancelled' || s === 'backlog' || s === 'ready' ? 'secondary' : 'primary'
            }
            loading={move.isPending && move.variables === s}
            onClick={() => {
              move.mutate(s);
            }}
          >
            {t(`ui.tasks.moveTo.${s}`)}
          </Button>
        ))}
      </div>
      <FormError error={move.error} />
    </Card>
  );
}

function DetailsCard({ task: x }: { task: Task }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const saved = useSaved();
  const [editing, setEditing] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>(x.priority);
  const [form, setForm] = useState({
    title: x.title,
    description: x.description ?? '',
    startDate: x.startDate ?? '',
    dueDate: x.dueDate ?? '',
    estimatedHours: x.estimatedHours ?? '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [key]: e.target.value });
  };
  const save = useMutation({
    mutationFn: () =>
      api(`/tasks/${x.id}`, {
        method: 'PATCH',
        body: {
          version: x.version,
          title: form.title,
          description: form.description,
          priority,
          startDate: form.startDate || null,
          dueDate: form.dueDate || null,
          estimatedHours: form.estimatedHours.trim() || null,
        },
        schema: taskSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setEditing(false);
      toast({ tone: 'good', title: t('ui.tasks.saved') });
    },
  });
  const dueError =
    isApiError(save.error) && save.error.details.some((d) => d.path === 'dueDate')
      ? t('ui.tasks.dueBeforeStart')
      : undefined;
  if (editing) {
    return (
      <Card>
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <TextField
            label={t('ui.tasks.fields.title')}
            value={form.title}
            onChange={set('title')}
          />
          <div className="grid gap-3 md:grid-cols-4">
            <SelectField
              label={t('ui.tasks.fields.priority')}
              placeholder={t('ui.tasks.fields.priority')}
              value={priority}
              onValueChange={(v) => {
                setPriority(v as TaskPriority);
              }}
              options={TASK_PRIORITIES.map((p) => ({
                value: p,
                label: t(`ui.tasks.priority.${p}`),
              }))}
            />
            <TextField
              label={t('ui.tasks.fields.startDate')}
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
            />
            <TextField
              label={t('ui.tasks.fields.dueDate')}
              type="date"
              value={form.dueDate}
              onChange={set('dueDate')}
              error={dueError}
            />
            <TextField
              label={t('ui.tasks.fields.estimatedHours')}
              inputMode="decimal"
              dir="ltr"
              value={form.estimatedHours}
              onChange={set('estimatedHours')}
            />
          </div>
          <TextArea
            label={t('ui.tasks.fields.description')}
            rows={4}
            value={form.description}
            onChange={set('description')}
          />
          <FormError error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending} disabled={!form.title.trim()}>
              {t('ui.common.save')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
              }}
            >
              {t('ui.common.cancel')}
            </Button>
          </div>
        </form>
      </Card>
    );
  }
  const row = (label: string, value: string) => (
    <div className="grid gap-0.5">
      <dt className="text-[12px] font-semibold text-ink-3">{label}</dt>
      <dd className="text-[14px]">{value || '—'}</dd>
    </div>
  );
  return (
    <Card
      action={
        x.actions.includes('edit') ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('ui.common.edit')}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-3 sm:grid-cols-4">
        {row(t('ui.tasks.fields.startDate'), dateText(locale, x.startDate))}
        {row(t('ui.tasks.fields.dueDate'), dateText(locale, x.dueDate))}
        {row(
          t('ui.tasks.fields.estimatedHours'),
          x.estimatedHours ? hoursText(locale, t, x.estimatedHours) : '',
        )}
        {row(t('ui.tasks.allocatedTotal'), hoursText(locale, t, x.allocatedHours))}
      </dl>
      {x.description && <p className="whitespace-pre-line text-[14px]">{x.description}</p>}
    </Card>
  );
}

function PeopleCard({ task: x }: { task: Task }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const saved = useSaved();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const project = useQuery({
    queryKey: ['projects', 'detail', x.project.id],
    enabled: open,
    queryFn: () => api(`/projects/${x.project.id}`, { schema: projectSchema }),
  });
  const preview = useAllocationPreview(open ? x.project.id : '', rows, x.id);
  const save = useMutation({
    mutationFn: () =>
      api(`/tasks/${x.id}/allocations`, {
        method: 'PUT',
        body: {
          allocations: rows.map((r) => ({ membershipId: r.membershipId, hours: r.hours.trim() })),
          ...(override ? { override: true, overrideReason: reason } : {}),
        },
        schema: taskSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setOpen(false);
      toast({ tone: 'good', title: t('ui.tasks.allocationsSaved') });
    },
  });
  const over = preview.data?.overBudget ?? false;
  return (
    <Card
      title={t('ui.tasks.people')}
      action={
        x.actions.includes('allocate') ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              save.reset();
              setOverride(false);
              setReason('');
              setRows(x.allocations.map((a) => ({ membershipId: a.membershipId, hours: a.hours })));
              setOpen(true);
            }}
          >
            {t('ui.tasks.editPeople')}
          </Button>
        ) : undefined
      }
    >
      {x.allocations.length === 0 ? (
        <EmptyState title={t('ui.tasks.noPeople')} body={t('ui.states.emptyBody')} />
      ) : (
        <ul className="grid gap-1.5 text-[13.5px]">
          {x.allocations.map((a) => (
            <li key={a.membershipId} className="flex items-center justify-between gap-2">
              <span>{a.name}</span>
              <b className="tabular-nums">{hoursText(locale, t, a.hours)}</b>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('ui.tasks.editPeople')}
        description={t('ui.tasks.peopleHint')}
        closeLabel={t('ui.common.close')}
      >
        {project.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        <AllocationEditor team={project.data?.members ?? []} rows={rows} onChange={setRows} />
        <AllocationImpact preview={preview} />
        {over && preview.data?.canOverride && (
          <>
            <Checkbox
              label={t('ui.tasks.override')}
              checked={override}
              onCheckedChange={setOverride}
            />
            {override && (
              <TextArea
                label={t('ui.tasks.overrideReason')}
                rows={2}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            )}
          </>
        )}
        <FormError error={save.error} />
        <Button
          className="w-fit"
          loading={save.isPending}
          disabled={!validHours(rows) || (over && !(override && reason.trim()))}
          onClick={() => {
            save.mutate();
          }}
        >
          {t('ui.common.save')}
        </Button>
      </Dialog>
    </Card>
  );
}

function DependenciesCard({ task: x }: { task: Task }) {
  const { t } = useI18n();
  const saved = useSaved();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const others = useQuery({
    queryKey: ['tasks', 'list', 'project', x.project.id],
    enabled: open,
    queryFn: () =>
      api(`/tasks?projectId=${x.project.id}&limit=200`, { schema: taskListResponseSchema }),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/tasks/${x.id}/dependencies`, {
        method: 'PUT',
        body: { blockedBy: picked },
        schema: taskSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setOpen(false);
    },
  });
  if (x.blockedBy.length === 0 && !x.actions.includes('dependencies')) return null;
  return (
    <Card
      title={t('ui.tasks.blockedBy')}
      action={
        x.actions.includes('dependencies') ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              save.reset();
              setPicked(x.blockedBy.map((b) => b.id));
              setOpen(true);
            }}
          >
            {t('ui.common.edit')}
          </Button>
        ) : undefined
      }
    >
      {x.blockedBy.length === 0 ? (
        <small className="text-ink-3">{t('ui.tasks.noBlockers')}</small>
      ) : (
        <ul className="grid gap-1.5 text-[13.5px]">
          {x.blockedBy.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2">
              <Link to="/tasks/$taskId" params={{ taskId: b.id }} className="hover:underline">
                <span dir="ltr">{b.number}</span> · {b.title}
              </Link>
              <TaskStatusChip status={b.status} />
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('ui.tasks.blockedBy')}
        description={t('ui.tasks.blockedByHint')}
        closeLabel={t('ui.common.close')}
      >
        <div className="grid gap-2">
          {(others.data?.items ?? [])
            .filter((o) => o.id !== x.id)
            .map((o) => (
              <Checkbox
                key={o.id}
                label={`${o.number} · ${o.title}`}
                checked={picked.includes(o.id)}
                onCheckedChange={(on) => {
                  setPicked(on ? [...picked, o.id] : picked.filter((id) => id !== o.id));
                }}
              />
            ))}
        </div>
        <FormError error={save.error} />
        <Button
          className="w-fit"
          loading={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {t('ui.common.save')}
        </Button>
      </Dialog>
    </Card>
  );
}

function CommentsCard({ task: x }: { task: Task }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const key = [...taskKey(x.id), 'comments'];
  const comments = useQuery({
    queryKey: key,
    queryFn: () => api(`/tasks/${x.id}/comments`, { schema: commentListResponseSchema }),
  });
  const add = useMutation({
    mutationFn: () =>
      api(`/tasks/${x.id}/comments`, {
        method: 'POST',
        body: { body },
        schema: commentListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setBody('');
    },
  });
  return (
    <Card>
      {comments.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {comments.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, comments.error)}
          reference={errorReference(t, comments.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void comments.refetch()}
        />
      )}
      {comments.data?.items.length === 0 && (
        <EmptyState title={t('ui.tasks.noComments')} body={t('ui.states.emptyBody')} />
      )}
      <ol className="grid gap-3">
        {comments.data?.items.map((c) => (
          <li key={c.id} className="grid gap-0.5 border-s-2 border-lilac ps-3">
            <span className="whitespace-pre-line text-[13.5px] text-ink">{c.body}</span>
            <small className="text-ink-3">
              {c.authorName ?? t('ui.dashboard.system')} ·{' '}
              {formatDate(locale, new Date(c.createdAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </small>
          </li>
        ))}
      </ol>
      {x.actions.includes('comment') && (
        <form
          noValidate
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <TextArea
            label={t('ui.tasks.addComment')}
            rows={2}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <FormError error={add.error} />
          <Button
            type="submit"
            size="sm"
            className="w-fit"
            loading={add.isPending}
            disabled={!body.trim()}
          >
            {t('ui.tasks.postComment')}
          </Button>
        </form>
      )}
    </Card>
  );
}

function ActivityCard({ task: x }: { task: Task }) {
  const { t, locale } = useI18n();
  const activity = useQuery({
    queryKey: [...taskKey(x.id), 'activity', x.version],
    queryFn: () => api(`/tasks/${x.id}/activity`, { schema: taskActivitySchema }),
  });
  const statuses = ['backlog', 'ready', 'in_progress', 'in_review', 'completed', 'cancelled'];
  const value = (action: string, v: string | null) => {
    if (v === null) return '';
    if (action === 'tasks.task.status_changed' && statuses.includes(v)) {
      return t(`ui.tasks.status.${v as TaskStatus}`);
    }
    if (action === 'tasks.allocation.changed') return hoursText(locale, t, v);
    return v;
  };
  return (
    <Card>
      {activity.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {activity.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, activity.error)}
          reference={errorReference(t, activity.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void activity.refetch()}
        />
      )}
      <ol className="grid gap-3">
        {activity.data?.items.map((item) => (
          <li key={item.id} className="grid gap-0.5 border-s-2 border-lilac ps-3">
            <span className="text-[13.5px]">
              {t(`ui.tasks.activity.${item.action.replace(/\./g, '_') as 'tasks_task_created'}`, {
                actor: item.actorName ?? t('ui.dashboard.system'),
                from: value(item.action, item.from),
                to: value(item.action, item.to),
              })}
            </span>
            <small className="text-ink-3">
              {formatDate(locale, new Date(item.occurredAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </small>
          </li>
        ))}
      </ol>
    </Card>
  );
}
