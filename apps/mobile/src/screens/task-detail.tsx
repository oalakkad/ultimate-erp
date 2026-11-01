import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  commentListResponseSchema,
  commentSchema,
  taskSchema,
  timerSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { useState } from 'react';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useApi } from '../core/session';
import { isApiError } from '../lib/api';
import { Button, Field } from '../ui/controls';
import { Denied, Empty, ErrorView, FormError, Loading, Notice } from '../ui/states';
import { Card, Chip, Inline, Row, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';
import { STATUS_TONE } from './tasks';

type Props = NativeStackScreenProps<RootParamList, 'TaskDetail'>;

/** One task: facts, allowed status moves, timer, comments. The server decides what I may do. */
export function TaskDetailScreen({ route }: Props) {
  const { id } = route.params;
  const { t, locale } = useI18n();
  const name = useName();
  const api = useApi();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const task = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api(`/tasks/${id}`, { schema: taskSchema }),
  });
  const comments = useQuery({
    queryKey: ['tasks', id, 'comments'],
    queryFn: () => api(`/tasks/${id}/comments`, { schema: commentListResponseSchema }),
  });
  const timer = useQuery({
    queryKey: ['timer'],
    queryFn: () => api('/timer', { schema: timerSchema }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const move = useMutation({
    mutationFn: (status: string) =>
      api(`/tasks/${id}/status`, { method: 'POST', body: { status }, schema: taskSchema }),
    onSuccess: refresh,
  });
  const addComment = useMutation({
    mutationFn: () =>
      api(`/tasks/${id}/comments`, {
        method: 'POST',
        body: { body: comment.trim() },
        schema: commentSchema,
      }),
    onSuccess: () => {
      setComment('');
      void queryClient.invalidateQueries({ queryKey: ['tasks', id, 'comments'] });
    },
  });
  const startTimer = useMutation({
    mutationFn: () => api('/timer', { method: 'POST', body: { taskId: id }, schema: timerSchema }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['timer'] }),
  });

  if (task.isPending) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (task.isError) {
    return (
      <Screen>
        {isApiError(task.error, 'FORBIDDEN') ? (
          <Denied />
        ) : (
          <ErrorView error={task.error} onRetry={() => void task.refetch()} />
        )}
      </Screen>
    );
  }
  const data = task.data;
  const date = (iso: string) =>
    formatDate(locale, new Date(`${iso}T12:00:00`), { dateStyle: 'medium' });
  const timing = timer.data?.running?.task.id === id;
  const canComment = data.actions.includes('comment');
  const commentItems = comments.data?.items ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={task.isRefetching}>
      <Stack gap={4}>
        <Text level="caption" tone="ink3">
          {data.number} · {name(data.client.name)} · {name(data.project.name)}
        </Text>
        <Text level="title" accessibilityRole="header">
          {data.title}
        </Text>
        <Inline wrap>
          <Chip
            tone={data.overdue ? 'blush' : STATUS_TONE[data.status]}
            label={t(`ui.tasks.status.${data.status}`)}
          />
          <Chip tone="neutral" label={t(`ui.tasks.priority.${data.priority}`)} />
          {data.dueDate ? (
            <Chip
              tone={data.overdue ? 'blush' : 'neutral'}
              label={t('ui.mobile.due', { date: date(data.dueDate) })}
            />
          ) : null}
        </Inline>
      </Stack>

      {data.description ? (
        <Card>
          <Text>{data.description}</Text>
        </Card>
      ) : null}

      <Card title={t('ui.mobile.changeStatus')}>
        {data.nextStatuses.length === 0 ? (
          <Text tone="ink3">{t('ui.mobile.nothingNeedsYou')}</Text>
        ) : null}
        <Inline wrap>
          {data.nextStatuses.map((status) => (
            <Button
              key={status}
              label={t(`ui.tasks.moveTo.${status}`)}
              variant={
                status === 'completed' || status === 'in_progress'
                  ? 'primary'
                  : status === 'cancelled'
                    ? 'danger'
                    : 'ghost'
              }
              loading={move.isPending && move.variables === status}
              onPress={() => {
                move.mutate(status);
              }}
              testID={`move-${status}`}
            />
          ))}
        </Inline>
        <FormError error={move.error} />
        {data.blockedBy.length > 0 ? (
          <Stack gap={2}>
            {data.blockedBy.map((b) => (
              <Text key={b.id} level="caption" tone="ink3">
                ⛔ {b.number} · {b.title} · {t(`ui.tasks.status.${b.status}`)}
              </Text>
            ))}
          </Stack>
        ) : null}
      </Card>

      <Card title={t('ui.time.timer')}>
        {timing && timer.data?.running ? (
          <Notice
            tone="butter"
            text={t('ui.time.timerRunning', {
              task: data.number,
              since: formatDate(locale, new Date(timer.data.running.startedAt), {
                timeStyle: 'short',
              }),
            })}
          />
        ) : (
          <Button
            label={t('ui.mobile.startTimerOn')}
            variant="ghost"
            loading={startTimer.isPending}
            disabled={timer.data?.running !== null && timer.data?.running !== undefined}
            onPress={() => {
              startTimer.mutate();
            }}
          />
        )}
        <FormError error={startTimer.error} />
      </Card>

      <Card title={t('ui.mobile.comments')}>
        {comments.isPending ? <Loading /> : null}
        {comments.isError ? (
          <ErrorView error={comments.error} onRetry={() => void comments.refetch()} />
        ) : null}
        {comments.data?.items.length === 0 ? <Empty /> : null}
        {commentItems.map((c, index) => (
          <Row
            key={c.id}
            title={c.body}
            subtitle={`${c.authorName ?? '—'} · ${formatDate(locale, new Date(c.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}`}
            last={index === commentItems.length - 1}
          />
        ))}
        {canComment ? (
          <>
            <Field
              label={t('ui.mobile.comments')}
              placeholder={t('ui.mobile.commentPlaceholder')}
              value={comment}
              onChangeText={setComment}
              multiline
            />
            <FormError error={addComment.error} />
            <Button
              label={t('ui.mobile.send')}
              variant="ghost"
              loading={addComment.isPending}
              disabled={comment.trim() === ''}
              onPress={() => {
                addComment.mutate();
              }}
            />
          </>
        ) : null}
      </Card>
    </Screen>
  );
}
