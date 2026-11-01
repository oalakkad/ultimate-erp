import { useNavigation } from '@react-navigation/native';
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  dashboardSummarySchema,
  myAttendanceSchema,
  timerSchema,
  unreadCountResponseSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { Bell, UserRound } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useApi, useSession } from '../core/session';
import { Button } from '../ui/controls';
import { ErrorView, Loading, Notice } from '../ui/states';
import { Card, Inline, Row, Screen, Stack, Tile } from '../ui/surfaces';
import { Text } from '../ui/text';
import { space, useTheme } from '../ui/theme';
import { noEmployeeRecord, useCheck } from './attendance-shared';

type Nav = NativeStackNavigationProp<RootParamList>;

/** Today at a glance: attendance, timer, what needs me; bell and account in the header. */
export function HomeScreen() {
  const { t, locale } = useI18n();
  const name = useName();
  const theme = useTheme();
  const api = useApi();
  const session = useSession();
  const navigation = useNavigation<Nav>();

  const summary = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard/summary', { schema: dashboardSummarySchema }),
  });
  const attendance = useQuery({
    queryKey: ['attendance', 'me'],
    queryFn: () => api('/attendance/me', { schema: myAttendanceSchema }),
  });
  const timer = useQuery({
    queryKey: ['timer'],
    queryFn: () => api('/timer', { schema: timerSchema }),
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    refetchInterval: 60_000,
    queryFn: () => api('/notifications/unread-count', { schema: unreadCountResponseSchema }),
  });
  const check = useCheck();

  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t('ui.shell.greetingMorning')
      : hour < 17
        ? t('ui.shell.greetingAfternoon')
        : t('ui.shell.greetingEvening');
  const refresh = () => {
    void summary.refetch();
    void attendance.refetch();
    void timer.refetch();
    void unread.refetch();
  };
  const last = attendance.data?.events.at(-1);
  const time = (iso: string) => formatDate(locale, new Date(iso), { timeStyle: 'short' });

  const needs: {
    key: string;
    text: string;
    onPress: () => void;
    tone: 'blush' | 'butter' | 'lilac';
  }[] = [];
  const d = summary.data;
  if (d?.tasks && d.tasks.mineOverdue > 0) {
    needs.push({
      key: 'overdue',
      text: t('ui.mobile.overdueTasks', { count: d.tasks.mineOverdue }),
      onPress: () => {
        navigation.navigate('Main', { screen: 'Tasks' });
      },
      tone: 'blush',
    });
  }
  if (d?.leave?.waitingForMe) {
    needs.push({
      key: 'leave',
      text: t('ui.mobile.leaveToDecide', { count: d.leave.waitingForMe }),
      onPress: () => {
        navigation.navigate('Main', { screen: 'Leave' });
      },
      tone: 'butter',
    });
  }
  if (d?.time?.waitingForMe) {
    needs.push({
      key: 'time',
      text: t('ui.mobile.pendingTime', { count: d.time.waitingForMe }),
      onPress: () => {
        navigation.navigate('Main', { screen: 'Time' });
      },
      tone: 'butter',
    });
  }
  if (unread.data && unread.data.count > 0) {
    needs.push({
      key: 'unread',
      text: t('ui.mobile.unreadNotifications', { count: unread.data.count }),
      onPress: () => {
        navigation.navigate('Notifications');
      },
      tone: 'lilac',
    });
  }

  return (
    <Screen onRefresh={refresh} refreshing={summary.isRefetching}>
      <View style={styles.header}>
        <View style={styles.greeting}>
          <Text level="caption" tone="ink2">
            {greeting}
          </Text>
          <Text level="display" accessibilityRole="header">
            {session.user?.name ?? ''}
          </Text>
          {session.company ? (
            <Text level="caption" tone="ink3">
              {name(session.company.name)}
            </Text>
          ) : null}
        </View>
        <Inline>
          <Pressable
            onPress={() => {
              navigation.navigate('Notifications');
            }}
            accessibilityRole="button"
            accessibilityLabel={t('ui.notifications.open', { count: unread.data?.count ?? 0 })}
            style={[styles.iconButton, { backgroundColor: theme.card, borderColor: theme.line }]}
            testID="bell"
          >
            <Bell color={theme.ink} size={20} />
            {unread.data && unread.data.count > 0 ? (
              <View style={[styles.dot, { backgroundColor: theme.blush.solid }]} />
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => {
              navigation.navigate('Account');
            }}
            accessibilityRole="button"
            accessibilityLabel={t('ui.shell.myAccount')}
            style={[styles.iconButton, { backgroundColor: theme.card, borderColor: theme.line }]}
            testID="account"
          >
            <UserRound color={theme.ink} size={20} />
          </Pressable>
        </Inline>
      </View>

      <Card title={t('ui.attendance.todayTitle')}>
        {attendance.isPending ? <Loading /> : null}
        {attendance.isError ? (
          noEmployeeRecord(attendance.error) ? (
            <Notice tone="butter" text={t('ui.mobile.noEmployeeRecord')} />
          ) : (
            <ErrorView error={attendance.error} onRetry={() => void attendance.refetch()} />
          )
        ) : null}
        {attendance.data ? (
          <Stack>
            <Text level="heading" color={last?.kind === 'in' ? theme.mint.ink : theme.ink2}>
              {last
                ? last.kind === 'in'
                  ? t('ui.mobile.checkedInSince', { time: time(last.at) })
                  : t('ui.mobile.checkedOutAt', { time: time(last.at) })
                : t('ui.mobile.notInYet')}
            </Text>
            {attendance.data.shift ? (
              <Text level="caption" tone="ink3">
                {t('ui.attendance.shiftLine', {
                  name: name(attendance.data.shift.name),
                  from: attendance.data.shift.startTime,
                  to: attendance.data.shift.endTime,
                })}
              </Text>
            ) : null}
            <Inline wrap>
              <Button
                label={t('ui.mobile.scanCode')}
                onPress={() => {
                  navigation.navigate('Scan');
                }}
                testID="scan"
              />
              {attendance.data.allowWeb ? (
                <Button
                  label={
                    attendance.data.next === 'in'
                      ? t('ui.attendance.checkIn')
                      : t('ui.attendance.checkOut')
                  }
                  variant="ghost"
                  loading={check.isPending}
                  onPress={() => {
                    check.mutate(undefined);
                  }}
                  testID="check"
                />
              ) : null}
            </Inline>
          </Stack>
        ) : null}
      </Card>

      <Card title={t('ui.mobile.needsYou')}>
        {summary.isPending ? <Loading /> : null}
        {summary.isError ? <ErrorView error={summary.error} onRetry={refresh} /> : null}
        {summary.data && needs.length === 0 ? (
          <Text tone="ink2">{t('ui.mobile.nothingNeedsYou')}</Text>
        ) : null}
        {needs.map((item, index) => (
          <Row
            key={item.key}
            title={item.text}
            onPress={item.onPress}
            last={index === needs.length - 1}
            trailing={<View style={[styles.marker, { backgroundColor: theme[item.tone].solid }]} />}
          />
        ))}
      </Card>

      <Inline gap={space.md}>
        {d?.tasks ? (
          <Tile
            tone="lilac"
            label={t('ui.mobile.myTasks')}
            value={String(d.tasks.mineOpen)}
            onPress={() => {
              navigation.navigate('Main', { screen: 'Tasks' });
            }}
          />
        ) : null}
        {d?.time ? (
          <Tile
            tone="sky"
            label={t('ui.time.thisWeek')}
            value={t('ui.mobile.hoursShort', { hours: d.time.thisWeekHours })}
            onPress={() => {
              navigation.navigate('Main', { screen: 'Time' });
            }}
          />
        ) : null}
      </Inline>

      {timer.data?.running ? (
        <Card>
          <Text level="label" color={theme.sky.ink}>
            {t('ui.time.timerRunning', {
              task: `${timer.data.running.task.number} ${timer.data.running.task.title}`,
              since: time(timer.data.running.startedAt),
            })}
          </Text>
          <Button
            label={t('ui.time.stopTimer')}
            variant="ghost"
            onPress={() => {
              navigation.navigate('Main', { screen: 'Time' });
            }}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  greeting: { flex: 1, gap: 2 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { position: 'absolute', top: 8, end: 8, width: 8, height: 8, borderRadius: 4 },
  marker: { width: 8, height: 8, borderRadius: 4 },
});
