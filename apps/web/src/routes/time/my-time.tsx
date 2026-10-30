import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type TimeEntry,
  timeEntrySchema,
  timerSchema,
  timesheetSchema,
  type TimesheetStatus,
  taskListResponseSchema,
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
  StatusChip,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { ChevronLeft, ChevronRight, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { hoursText } from '../projects/shared.js';

const CHIP: Record<TimesheetStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  draft: 'info',
  submitted: 'warn',
  approved: 'good',
  rejected: 'bad',
};
export function TimeStatusChip({ status }: { status: TimesheetStatus }) {
  const { t } = useI18n();
  return <StatusChip status={CHIP[status]} label={t(`ui.time.status.${status}`)} />;
}

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const kuwaitToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** My timesheet: log time on my tasks, run a timer, submit the week (docs/modules/timesheets.md). */
export function MyTimePage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [week, setWeek] = useState(useSearchParam('week') ?? kuwaitToday());
  const sheetKey = ['time', 'week', week];
  const sheet = useQuery({
    queryKey: sheetKey,
    queryFn: () => api(`/timesheets/mine?week=${week}`, { schema: timesheetSchema }),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['time'] });
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
  const submit = useMutation({
    mutationFn: (id: string) =>
      api(`/timesheets/${id}/submit`, { method: 'POST', schema: timesheetSchema }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.time.submitted') });
      await refresh();
    },
  });
  const day = (iso: string) =>
    formatDate(locale, new Date(`${iso}T12:00:00Z`), { weekday: 'short', day: 'numeric' });

  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.time.title')} />
      <TimerCard onStopped={refresh} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<ChevronLeft aria-hidden className="size-4 rtl:rotate-180" />}
          onClick={() => {
            setWeek(shift(sheet.data?.weekStart ?? week, -7));
          }}
        >
          {t('ui.time.previousWeek')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<ChevronRight aria-hidden className="size-4 rtl:rotate-180" />}
          onClick={() => {
            setWeek(shift(sheet.data?.weekStart ?? week, 7));
          }}
        >
          {t('ui.time.nextWeek')}
        </Button>
        {sheet.data && (
          <b className="text-[14px]">
            {t('ui.time.weekOf', {
              from: formatDate(locale, new Date(`${sheet.data.weekStart}T12:00:00Z`), {
                dateStyle: 'medium',
              }),
              to: formatDate(locale, new Date(`${sheet.data.weekEnd}T12:00:00Z`), {
                dateStyle: 'medium',
              }),
            })}
          </b>
        )}
      </div>
      {sheet.isPending && <LoadingState label={t('ui.common.loading')} />}
      {sheet.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, sheet.error)}
          reference={errorReference(t, sheet.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void sheet.refetch()}
        />
      )}
      {sheet.data && (
        <>
          <Card
            title={t('ui.time.thisWeek')}
            action={
              sheet.data.canSubmit && sheet.data.id ? (
                <Button
                  size="sm"
                  loading={submit.isPending}
                  onClick={() => {
                    if (sheet.data.id) submit.mutate(sheet.data.id);
                  }}
                >
                  {t('ui.time.submitWeek')}
                </Button>
              ) : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <TimeStatusChip status={sheet.data.status} />
              <span className="text-[13.5px] text-ink-2">
                {t('ui.time.totals', {
                  total: hoursText(locale, t, sheet.data.totalHours),
                  billable: hoursText(locale, t, sheet.data.billableHours),
                })}
              </span>
            </div>
            <dl className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {sheet.data.days.map((d) => (
                <div key={d.date} className="grid gap-0.5 rounded-tile bg-frame p-2 text-center">
                  <dt className="text-[12px] font-semibold text-ink-3">{day(d.date)}</dt>
                  <dd className="text-[14px] font-bold tabular-nums">
                    {hoursText(locale, t, d.hours)}
                  </dd>
                </div>
              ))}
            </dl>
            <FormError error={submit.error} />
          </Card>
          {(sheet.data.status === 'draft' || sheet.data.status === 'rejected') && (
            <EntryForm weekStart={sheet.data.weekStart} onSaved={refresh} />
          )}
          <Card title={t('ui.time.entries')}>
            {sheet.data.entries.length === 0 ? (
              <EmptyState title={t('ui.time.noEntries')} body={t('ui.time.noEntriesBody')} />
            ) : (
              <ul className="grid gap-2">
                {sheet.data.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} onChanged={refresh} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function useMyTasks() {
  return useQuery({
    queryKey: ['tasks', 'list', 'mine-open'],
    queryFn: () =>
      api('/tasks?assignee=me&state=open&limit=200', { schema: taskListResponseSchema }),
  });
}

function EntryForm({ weekStart, onSaved }: { weekStart: string; onSaved: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const tasks = useMyTasks();
  const today = kuwaitToday();
  const weekEnd = shift(weekStart, 6);
  const [taskId, setTaskId] = useState(useSearchParam('taskId') ?? '');
  const [date, setDate] = useState(today >= weekStart && today <= weekEnd ? today : weekStart);
  const [hours, setHours] = useState('');
  const [billable, setBillable] = useState(true);
  const [description, setDescription] = useState('');
  const save = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      api('/time-entries', {
        method: 'POST',
        body: {
          taskId,
          workDate: date,
          hours: hours.trim(),
          billable,
          description,
          confirmDuplicate,
        },
        schema: timeEntrySchema,
      }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.time.logged') });
      setHours('');
      setDescription('');
      await onSaved();
    },
  });
  const code = isApiError(save.error) ? save.error.details[0]?.code : undefined;
  const hint =
    code === 'day_over_24'
      ? t('ui.time.dayOver24')
      : code === 'future'
        ? t('ui.time.future')
        : code === 'hours_range' || code === 'hours'
          ? t('ui.time.hoursFormat')
          : undefined;
  return (
    <Card title={t('ui.time.logTime')}>
      <form
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(false);
        }}
      >
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <SelectField
              label={t('ui.time.task')}
              placeholder={t('ui.time.task')}
              value={taskId}
              onValueChange={setTaskId}
              options={(tasks.data?.items ?? []).map((task) => ({
                value: task.id,
                label: `${task.number} · ${task.title} (${locale === 'ar' ? task.project.name.ar : task.project.name.en})`,
              }))}
            />
          </div>
          <TextField
            label={t('ui.time.date')}
            type="date"
            min={weekStart}
            max={weekEnd < today ? weekEnd : today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
            }}
          />
          <TextField
            label={t('ui.time.hours')}
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
            }}
            error={hint}
          />
        </div>
        <TextField
          label={t('ui.time.description')}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
        <Checkbox label={t('ui.time.billable')} checked={billable} onCheckedChange={setBillable} />
        {code === 'possible_duplicate' ? (
          <div
            role="alert"
            className="grid gap-2 rounded-tile bg-butter p-3 text-[13.5px] text-butter-ink"
          >
            {t('ui.time.duplicate')}
            <Button
              size="sm"
              variant="secondary"
              className="w-fit"
              onClick={() => {
                save.mutate(true);
              }}
            >
              {t('ui.time.saveAnyway')}
            </Button>
          </div>
        ) : (
          !hint && <FormError error={save.error} />
        )}
        <Button
          type="submit"
          className="w-fit"
          loading={save.isPending}
          disabled={!taskId || !hours.trim()}
        >
          {t('ui.time.add')}
        </Button>
      </form>
    </Card>
  );
}

function EntryRow({ entry: e, onChanged }: { entry: TimeEntry; onChanged: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(e.hours);
  const [description, setDescription] = useState(e.description);
  const save = useMutation({
    mutationFn: () =>
      api(`/time-entries/${e.id}`, {
        method: 'PATCH',
        body: { hours: hours.trim(), description, version: e.version },
        schema: timeEntrySchema,
      }),
    onSuccess: async () => {
      setOpen(false);
      await onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/time-entries/${e.id}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });
  return (
    <li className="grid gap-1.5 rounded-tile bg-frame p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid min-w-0 flex-1">
          <b className="text-[13.5px]">
            <span dir="ltr">{e.task.number}</span> · {e.task.title}
          </b>
          <small className="text-ink-3">
            {formatDate(locale, new Date(`${e.workDate}T12:00:00Z`), { dateStyle: 'medium' })} ·{' '}
            {locale === 'ar' ? e.project.name.ar : e.project.name.en}
            {e.billable ? '' : ` · ${t('ui.time.nonBillable')}`}
            {e.description ? ` · ${e.description}` : ''}
          </small>
        </div>
        <b className="tabular-nums">{hoursText(locale, t, e.hours)}</b>
        <TimeStatusChip status={e.status} />
        {e.actions.includes('edit') && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              save.reset();
              setHours(e.hours);
              setDescription(e.description);
              setOpen(true);
            }}
          >
            {t('ui.common.edit')}
          </Button>
        )}
        {e.actions.includes('delete') && (
          <Button
            size="sm"
            variant="ghost"
            loading={remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            {t('ui.time.delete')}
          </Button>
        )}
      </div>
      {e.status === 'rejected' && e.rejectionReason && (
        <p className="text-[13px] text-bad">
          {t('ui.time.rejectedBecause', { reason: e.rejectionReason, name: e.decidedByName ?? '' })}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('ui.time.editEntry')}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <TextField
            label={t('ui.time.hours')}
            inputMode="decimal"
            dir="ltr"
            value={hours}
            onChange={(ev) => {
              setHours(ev.target.value);
            }}
          />
          <TextField
            label={t('ui.time.description')}
            value={description}
            onChange={(ev) => {
              setDescription(ev.target.value);
            }}
          />
          <FormError error={save.error} />
          <Button type="submit" className="w-fit" loading={save.isPending}>
            {t('ui.common.save')}
          </Button>
        </form>
      </Dialog>
    </li>
  );
}

function TimerCard({ onStopped }: { onStopped: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const tasks = useMyTasks();
  const [taskId, setTaskId] = useState('');
  const timer = useQuery({
    queryKey: ['time', 'timer'],
    queryFn: () => api('/timer', { schema: timerSchema }),
  });
  const start = useMutation({
    mutationFn: () => api('/timer', { method: 'POST', body: { taskId }, schema: timerSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(['time', 'timer'], data);
    },
  });
  const stop = useMutation({
    mutationFn: () => api('/timer/stop', { method: 'POST', body: {}, schema: timeEntrySchema }),
    onSuccess: onStopped,
  });
  const running = timer.data?.running;
  return (
    <Card title={t('ui.time.timer')}>
      {running ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13.5px]">
            {t('ui.time.timerRunning', {
              task: `${running.task.number} · ${running.task.title}`,
              since: formatDate(locale, new Date(running.startedAt), { timeStyle: 'short' }),
            })}
          </span>
          <Button
            size="sm"
            icon={<Square aria-hidden className="size-4" />}
            loading={stop.isPending}
            onClick={() => {
              stop.mutate();
            }}
          >
            {t('ui.time.stopTimer')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <SelectField
              label={t('ui.time.timerTask')}
              placeholder={t('ui.time.task')}
              value={taskId}
              onValueChange={setTaskId}
              options={(tasks.data?.items ?? []).map((task) => ({
                value: task.id,
                label: `${task.number} · ${task.title}`,
              }))}
            />
          </div>
          <Button
            icon={<Play aria-hidden className="size-4" />}
            loading={start.isPending}
            disabled={!taskId}
            onClick={() => {
              start.mutate();
            }}
          >
            {t('ui.time.startTimer')}
          </Button>
        </div>
      )}
      <FormError error={start.error ?? stop.error} />
    </Card>
  );
}
