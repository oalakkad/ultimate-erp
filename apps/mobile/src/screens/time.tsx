import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  taskListResponseSchema,
  timeEntrySchema,
  timerSchema,
  timesheetSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { useState } from 'react';
import { useI18n, useName } from '../core/i18n';
import { useApi } from '../core/session';
import { isApiError } from '../lib/api';
import { ISO_DATE, normaliseHours, todayIso } from '../lib/dates';
import { Button, Choices, Field, Toggle } from '../ui/controls';
import { Empty, ErrorView, FormError, Loading, Notice } from '../ui/states';
import { Card, Chip, Row, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';
import { type ToneName } from '../ui/theme';

const STATUS_TONE: Record<string, ToneName | 'neutral'> = {
  draft: 'neutral',
  submitted: 'butter',
  approved: 'mint',
  rejected: 'blush',
};

/** This week's timesheet: timer, entries, add an entry on one of my tasks, submit the week. */
export function TimeScreen() {
  const { t, locale } = useI18n();
  const name = useName();
  const api = useApi();
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [hours, setHours] = useState('');
  const [billable, setBillable] = useState<boolean | undefined>(undefined);
  const [description, setDescription] = useState('');
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const week = useQuery({
    queryKey: ['timesheet', 'current'],
    queryFn: () => api('/timesheets/mine', { schema: timesheetSchema }),
  });
  const timer = useQuery({
    queryKey: ['timer'],
    queryFn: () => api('/timer', { schema: timerSchema }),
  });
  const tasks = useQuery({
    queryKey: ['tasks', 'mine', 'open', 'forTime'],
    queryFn: () =>
      api('/tasks?assignee=me&state=open&limit=100', { schema: taskListResponseSchema }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['timesheet'] });
    void queryClient.invalidateQueries({ queryKey: ['timer'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const stopTimer = useMutation({
    mutationFn: () => api('/timer/stop', { method: 'POST', body: {}, schema: timeEntrySchema }),
    onSuccess: () => {
      setSaved(t('ui.mobile.timerStopped'));
      refresh();
    },
  });
  const add = useMutation({
    mutationFn: () =>
      api('/time-entries', {
        method: 'POST',
        body: {
          taskId,
          workDate: date,
          hours: normaliseHours(hours),
          ...(billable === undefined ? {} : { billable }),
          ...(description.trim() === '' ? {} : { description: description.trim() }),
          ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
        },
        schema: timeEntrySchema,
      }),
    onSuccess: () => {
      setHours('');
      setDescription('');
      setConfirmDuplicate(false);
      setSaved(t('ui.mobile.entrySaved'));
      refresh();
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      api(`/timesheets/${week.data?.id ?? ''}/submit`, {
        method: 'POST',
        body: {},
        schema: timesheetSchema,
      }),
    onSuccess: () => {
      setSaved(t('ui.time.submitted'));
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/time-entries/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const duplicate =
    isApiError(add.error, 'CONFLICT') &&
    add.error.details.some((d) => d.code === 'possible_duplicate');
  const hoursOk = normaliseHours(hours) !== null;
  const dateOk = ISO_DATE.test(date) && date <= todayIso();
  const day = (iso: string) =>
    formatDate(locale, new Date(`${iso}T12:00:00`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  return (
    <Screen onRefresh={() => void week.refetch()} refreshing={week.isRefetching}>
      <Text level="title" accessibilityRole="header">
        {t('ui.time.title')}
      </Text>
      {saved ? <Notice text={saved} /> : null}

      <Card title={t('ui.time.timer')}>
        {timer.data?.running ? (
          <Stack>
            <Text level="label">
              {t('ui.time.timerRunning', {
                task: `${timer.data.running.task.number} ${timer.data.running.task.title}`,
                since: formatDate(locale, new Date(timer.data.running.startedAt), {
                  timeStyle: 'short',
                }),
              })}
            </Text>
            <Button
              label={t('ui.time.stopTimer')}
              loading={stopTimer.isPending}
              onPress={() => {
                stopTimer.mutate();
              }}
            />
            <FormError error={stopTimer.error} />
          </Stack>
        ) : (
          <Text tone="ink3">
            {t('ui.mobile.startTimerOn')} — {t('ui.mobile.myTasks')}
          </Text>
        )}
      </Card>

      <Card title={t('ui.time.thisWeek')}>
        {week.isPending ? <Loading /> : null}
        {week.isError ? <ErrorView error={week.error} onRetry={() => void week.refetch()} /> : null}
        {week.data ? (
          <Stack>
            <Text level="caption" tone="ink3">
              {t('ui.time.weekOf', { from: day(week.data.weekStart), to: day(week.data.weekEnd) })}{' '}
              · {t(`ui.time.status.${week.data.status}`)}
            </Text>
            <Text level="number">{t('ui.mobile.hoursShort', { hours: week.data.totalHours })}</Text>
            <Text level="caption" tone="ink3">
              {t('ui.mobile.weekTotal', {
                total: week.data.totalHours,
                billable: week.data.billableHours,
              })}
            </Text>
            {week.data.entries.length === 0 ? (
              <Empty title={t('ui.time.noEntries')} body={t('ui.time.noEntriesBody')} />
            ) : (
              week.data.entries.map((entry, index) => (
                <Row
                  key={entry.id}
                  title={`${day(entry.workDate)} · ${t('ui.mobile.hoursShort', { hours: entry.hours })} · ${entry.task.number}`}
                  subtitle={`${entry.task.title}${entry.description ? ` · ${entry.description}` : ''}${
                    entry.rejectionReason
                      ? ` · ${t('ui.time.rejectedBecause', { name: entry.decidedByName ?? '', reason: entry.rejectionReason })}`
                      : ''
                  }`}
                  last={index === week.data.entries.length - 1}
                  trailing={
                    entry.actions.includes('delete') ? (
                      <Button
                        label={t('ui.time.delete')}
                        variant="ghost"
                        loading={remove.isPending && remove.variables === entry.id}
                        onPress={() => {
                          remove.mutate(entry.id);
                        }}
                      />
                    ) : (
                      <Chip
                        tone={STATUS_TONE[entry.status] ?? 'neutral'}
                        label={t(`ui.time.status.${entry.status}`)}
                      />
                    )
                  }
                />
              ))
            )}
            <FormError error={remove.error} />
            {week.data.canSubmit && week.data.id ? (
              <Button
                label={t('ui.time.submitWeek')}
                loading={submit.isPending}
                onPress={() => {
                  submit.mutate();
                }}
              />
            ) : null}
            <FormError error={submit.error} />
          </Stack>
        ) : null}
      </Card>

      <Card title={t('ui.time.logTime')}>
        {tasks.isPending ? <Loading /> : null}
        {tasks.isError ? (
          <ErrorView error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : null}
        {tasks.data && tasks.data.items.length === 0 ? (
          <Empty title={t('ui.mobile.noAssignedTasks')} body={t('ui.mobile.noAssignedTasksBody')} />
        ) : null}
        {tasks.data && tasks.data.items.length > 0 ? (
          <Stack>
            <Choices
              label={t('ui.time.task')}
              value={taskId}
              onChange={setTaskId}
              options={tasks.data.items.map((task) => ({
                value: task.id,
                label: `${task.number} · ${task.title}`,
                hint: name(task.project.name),
              }))}
            />
            <Field
              label={t('ui.time.date')}
              value={date}
              onChangeText={setDate}
              autoCapitalize="none"
              hint={t('ui.mobile.dateFormat')}
              error={
                date !== '' && !dateOk
                  ? ISO_DATE.test(date)
                    ? t('ui.time.future')
                    : t('ui.mobile.dateFormat')
                  : undefined
              }
            />
            <Field
              label={t('ui.time.hours')}
              value={hours}
              onChangeText={setHours}
              keyboardType="decimal-pad"
              hint={t('ui.time.hoursFormat')}
              error={hours !== '' && !hoursOk ? t('ui.time.hoursFormat') : undefined}
              testID="hours"
            />
            <Toggle label={t('ui.time.billable')} value={billable ?? true} onChange={setBillable} />
            <Field
              label={t('ui.time.description')}
              value={description}
              onChangeText={setDescription}
              multiline
            />
            {duplicate ? (
              <Stack>
                <Notice tone="butter" text={t('ui.time.duplicate')} />
                <Toggle
                  label={t('ui.time.saveAnyway')}
                  value={confirmDuplicate}
                  onChange={setConfirmDuplicate}
                />
              </Stack>
            ) : (
              <FormError error={add.error} />
            )}
            <Button
              label={t('ui.time.add')}
              loading={add.isPending}
              disabled={!taskId || !hoursOk || !dateOk}
              onPress={() => {
                setSaved(null);
                add.mutate();
              }}
              testID="add-entry"
            />
          </Stack>
        ) : null}
      </Card>
    </Screen>
  );
}
