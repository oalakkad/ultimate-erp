import { useNavigation } from '@react-navigation/native';
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type TaskSummary, taskListResponseSchema } from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { useState } from 'react';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useApi } from '../core/session';
import { Button, Segments } from '../ui/controls';
import { Empty, ErrorView, Loading } from '../ui/states';
import { Card, Chip, Row, Screen } from '../ui/surfaces';
import { Text } from '../ui/text';
import { type ToneName } from '../ui/theme';

type Nav = NativeStackNavigationProp<RootParamList>;

export const STATUS_TONE: Record<TaskSummary['status'], ToneName | 'neutral'> = {
  backlog: 'neutral',
  ready: 'sky',
  in_progress: 'lilac',
  in_review: 'butter',
  completed: 'mint',
  cancelled: 'neutral',
};

/** My tasks (assigned to me), open or closed, newest first; tap for the detail. */
export function TasksScreen() {
  const { t, locale } = useI18n();
  const name = useName();
  const api = useApi();
  const navigation = useNavigation<Nav>();
  const [state, setState] = useState<'open' | 'closed'>('open');
  const list = useInfiniteQuery({
    queryKey: ['tasks', 'mine', state],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api(`/tasks?assignee=me&state=${state}&limit=50${pageParam ? `&cursor=${pageParam}` : ''}`, {
        schema: taskListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const due = (task: TaskSummary) =>
    task.dueDate
      ? t('ui.mobile.due', {
          date: formatDate(locale, new Date(`${task.dueDate}T12:00:00`), { dateStyle: 'medium' }),
        })
      : t('ui.mobile.noDue');

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Text level="title" accessibilityRole="header">
        {t('ui.mobile.myTasks')}
      </Text>
      <Segments
        value={state}
        onChange={setState}
        options={[
          { value: 'open', label: t('ui.tasks.stateOpen') },
          { value: 'closed', label: t('ui.tasks.stateClosed') },
        ]}
      />
      <Card>
        {list.isPending ? <Loading /> : null}
        {list.isError ? <ErrorView error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data && items.length === 0 ? (
          <Empty title={t('ui.tasks.empty')} body={t('ui.tasks.emptyBody')} />
        ) : null}
        {items.map((task, index) => (
          <Row
            key={task.id}
            title={`${task.number} · ${task.title}`}
            subtitle={`${name(task.project.name)} · ${due(task)}${task.overdue ? ` · ${t('ui.tasks.overdue')}` : ''}`}
            last={index === items.length - 1}
            onPress={() => {
              navigation.navigate('TaskDetail', { id: task.id });
            }}
            testID={`task-${task.number}`}
            trailing={
              <Chip
                tone={task.overdue ? 'blush' : STATUS_TONE[task.status]}
                label={t(`ui.tasks.status.${task.status}`)}
              />
            }
          />
        ))}
        {list.hasNextPage ? (
          <Button
            label={t('ui.tasks.loadMore')}
            variant="ghost"
            loading={list.isFetchingNextPage}
            onPress={() => void list.fetchNextPage()}
          />
        ) : null}
      </Card>
    </Screen>
  );
}
