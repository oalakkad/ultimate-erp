import { useNavigation } from '@react-navigation/native';
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  attendanceSummarySchema,
  correctionListResponseSchema,
  myAttendanceSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useApi } from '../core/session';
import { addDays, todayIso } from '../lib/dates';
import { Button } from '../ui/controls';
import { Empty, ErrorView, FormError, Loading, Notice } from '../ui/states';
import { Card, Chip, Inline, Row, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';
import { type ToneName } from '../ui/theme';
import { noEmployeeRecord, useCheck } from './attendance-shared';

type Nav = NativeStackNavigationProp<RootParamList>;

const DAY_TONE: Record<string, ToneName | 'neutral'> = {
  present: 'mint',
  incomplete: 'butter',
  absent: 'blush',
  leave: 'butter',
  holiday: 'lilac',
  weekend: 'neutral',
  upcoming: 'neutral',
};

/** My attendance: today's events, check in/out, the last two weeks, my correction requests. */
export function AttendanceScreen() {
  const { t, locale } = useI18n();
  const name = useName();
  const api = useApi();
  const navigation = useNavigation<Nav>();
  const me = useQuery({
    queryKey: ['attendance', 'me'],
    queryFn: () => api('/attendance/me', { schema: myAttendanceSchema }),
  });
  const today = todayIso();
  const summary = useQuery({
    queryKey: ['attendance', 'summary', today],
    queryFn: () =>
      api(`/attendance/summary?from=${addDays(today, -13)}&to=${today}`, {
        schema: attendanceSummarySchema,
      }),
  });
  const corrections = useQuery({
    queryKey: ['attendance', 'corrections', 'mine'],
    queryFn: () =>
      api('/attendance/corrections?view=mine', { schema: correctionListResponseSchema }),
  });
  const check = useCheck();
  const time = (iso: string) => formatDate(locale, new Date(iso), { timeStyle: 'short' });
  const day = (iso: string) =>
    formatDate(locale, new Date(`${iso}T12:00:00`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const refresh = () => {
    void me.refetch();
    void summary.refetch();
    void corrections.refetch();
  };
  const days = [...(summary.data?.days ?? [])].reverse();
  const items = corrections.data?.items ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={me.isRefetching}>
      <Text level="title" accessibilityRole="header">
        {t('ui.attendance.title')}
      </Text>
      <Card title={t('ui.attendance.todayTitle')}>
        {me.isPending ? <Loading /> : null}
        {me.isError ? (
          noEmployeeRecord(me.error) ? (
            <Notice tone="butter" text={t('ui.mobile.noEmployeeRecord')} />
          ) : (
            <ErrorView error={me.error} onRetry={refresh} />
          )
        ) : null}
        {me.data ? (
          <Stack>
            {me.data.events.length === 0 ? (
              <Text tone="ink2">{t('ui.attendance.noEvents')}</Text>
            ) : (
              me.data.events.map((event, index) => (
                <Row
                  key={event.id}
                  title={`${t(`ui.attendance.kind.${event.kind}`)} · ${time(event.at)}`}
                  subtitle={`${t(`ui.attendance.method.${event.method}`)}${event.site ? ` · ${name(event.site)}` : ''}`}
                  last={index === me.data.events.length - 1}
                />
              ))
            )}
            {check.isSuccess ? (
              <Notice
                text={
                  check.data.events.at(-1)?.kind === 'in'
                    ? t('ui.attendance.checkedIn')
                    : t('ui.attendance.checkedOut')
                }
              />
            ) : null}
            <FormError error={check.error} />
            <Inline wrap>
              <Button
                label={t('ui.mobile.scanCode')}
                onPress={() => {
                  navigation.navigate('Scan');
                }}
              />
              {me.data.allowWeb ? (
                <Button
                  label={
                    me.data.next === 'in' ? t('ui.attendance.checkIn') : t('ui.attendance.checkOut')
                  }
                  variant="ghost"
                  loading={check.isPending}
                  onPress={() => {
                    check.mutate(undefined);
                  }}
                />
              ) : (
                <Text level="caption" tone="ink3">
                  {t('ui.attendance.qrOnly')}
                </Text>
              )}
            </Inline>
          </Stack>
        ) : null}
      </Card>

      <Card title={t('ui.attendance.lastTwoWeeks')}>
        {summary.isPending ? <Loading /> : null}
        {summary.isError ? <ErrorView error={summary.error} onRetry={refresh} /> : null}
        {summary.data ? (
          <Text level="caption" tone="ink3">
            {t('ui.attendance.totals', {
              present: summary.data.totals.present,
              absent: summary.data.totals.absent,
              late: summary.data.totals.late,
              worked: t('ui.attendance.hm', {
                h: Math.floor(summary.data.totals.workedMinutes / 60),
                m: summary.data.totals.workedMinutes % 60,
              }),
              logged: summary.data.totals.loggedHours,
            })}
          </Text>
        ) : null}
        {days.map((entry, index) => (
          <Row
            key={entry.date}
            title={day(entry.date)}
            subtitle={
              entry.firstIn
                ? `${time(entry.firstIn)}${entry.lastOut ? ` – ${time(entry.lastOut)}` : ''}${
                    entry.lateMinutes > 0
                      ? ` · ${t('ui.attendance.lateBy', { minutes: entry.lateMinutes })}`
                      : ''
                  }`
                : undefined
            }
            last={index === days.length - 1}
            trailing={
              <Chip
                tone={DAY_TONE[entry.status] ?? 'neutral'}
                label={t(`ui.attendance.day.${entry.status}`)}
              />
            }
          />
        ))}
      </Card>

      <Card
        title={t('ui.attendance.corrections')}
        action={
          <Button
            label={t('ui.mobile.requestCorrection')}
            variant="ghost"
            onPress={() => {
              navigation.navigate('Correction');
            }}
          />
        }
      >
        <Text level="caption" tone="ink3">
          {t('ui.attendance.correctionHint')}
        </Text>
        {corrections.isPending ? <Loading /> : null}
        {corrections.isError ? <ErrorView error={corrections.error} onRetry={refresh} /> : null}
        {corrections.data?.items.length === 0 ? <Empty /> : null}
        {items.map((item, index) => (
          <Row
            key={item.id}
            title={`${t(`ui.attendance.kind.${item.kind}`)} · ${formatDate(locale, new Date(item.at), { dateStyle: 'medium', timeStyle: 'short' })}`}
            subtitle={
              item.note && item.decidedByName
                ? t('ui.attendance.reviewNote', { name: item.decidedByName, note: item.note })
                : item.reason
            }
            last={index === items.length - 1}
            trailing={
              <Chip
                tone={
                  item.status === 'approved'
                    ? 'mint'
                    : item.status === 'rejected'
                      ? 'blush'
                      : 'butter'
                }
                label={t(`ui.attendance.correctionStatus.${item.status}`)}
              />
            }
          />
        ))}
      </Card>
    </Screen>
  );
}
