import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type Notification,
  notificationListResponseSchema,
  okResponseSchema,
} from '@ultimate-erp/contracts';
import { formatDate, notificationText } from '@ultimate-erp/i18n';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useApi } from '../core/session';
import { targetForLink } from '../lib/scan-link';
import { Button } from '../ui/controls';
import { Empty, ErrorView, Loading } from '../ui/states';
import { Card, Row, Screen } from '../ui/surfaces';
import { Text } from '../ui/text';
import { useTheme } from '../ui/theme';

type Props = NativeStackScreenProps<RootParamList, 'Notifications'>;

/** My notifications; opening one marks it read and goes to the matching screen. */
export function NotificationsScreen({ navigation }: Props) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const api = useApi();
  const queryClient = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api(`/notifications${pageParam ? `?cursor=${pageParam}` : ''}`, {
        schema: notificationListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/read`, { method: 'POST', schema: okResponseSchema }),
    onSettled: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST', schema: okResponseSchema }),
    onSettled: refresh,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  const open = (item: Notification) => {
    if (!item.read) markRead.mutate(item.id);
    const target = targetForLink(item.link);
    switch (target.screen) {
      case 'TaskDetail':
        navigation.navigate('TaskDetail', { id: target.id });
        return;
      case 'Notifications':
        return;
      case 'Home':
        navigation.navigate('Main', { screen: 'Home' });
        return;
      default:
        navigation.navigate('Main', { screen: target.screen });
    }
  };

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      <Text level="caption" tone="ink3">
        {t('ui.mobile.pushLater')}
      </Text>
      <Card
        action={
          items.some((i) => !i.read) ? (
            <Button
              label={t('ui.notifications.markAllRead')}
              variant="ghost"
              loading={markAll.isPending}
              onPress={() => {
                markAll.mutate();
              }}
            />
          ) : undefined
        }
      >
        {list.isPending ? <Loading /> : null}
        {list.isError ? <ErrorView error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data && items.length === 0 ? <Empty body={t('ui.notifications.empty')} /> : null}
        {items.map((item, index) => (
          <Row
            key={item.id}
            title={notificationText(locale, item)}
            subtitle={formatDate(locale, new Date(item.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            last={index === items.length - 1}
            onPress={() => {
              open(item);
            }}
            trailing={
              item.read ? null : (
                <View
                  style={[styles.dot, { backgroundColor: theme.blush.solid }]}
                  accessibilityLabel={t('ui.notifications.unread')}
                />
              )
            }
          />
        ))}
        {list.hasNextPage ? (
          <Button
            label={t('ui.notifications.older')}
            variant="ghost"
            loading={list.isFetchingNextPage}
            onPress={() => void list.fetchNextPage()}
          />
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ dot: { width: 8, height: 8, borderRadius: 4 } });
