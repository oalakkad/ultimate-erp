import { useNavigation } from '@react-navigation/native';
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  correctionListResponseSchema,
  correctionSchema,
  leaveBalanceSchema,
  leaveListResponseSchema,
  type LeaveRequest,
  leaveRequestSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { useState } from 'react';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { canAny, useApi, useSession } from '../core/session';
import { Button, Field } from '../ui/controls';
import { Empty, ErrorView, FormError, Loading, Notice } from '../ui/states';
import { Card, Chip, Inline, Row, Screen, Stack, Tile } from '../ui/surfaces';
import { Text } from '../ui/text';
import { type ToneName } from '../ui/theme';

type Nav = NativeStackNavigationProp<RootParamList>;

const STATUS_TONE: Record<LeaveRequest['status'], ToneName | 'neutral'> = {
  pending: 'butter',
  approved: 'mint',
  rejected: 'blush',
  withdrawn: 'neutral',
  cancelled: 'neutral',
};

/** My balances and requests; approvals of leave and attendance corrections for approvers. */
export function LeaveScreen() {
  const { t, locale } = useI18n();
  const name = useName();
  const api = useApi();
  const { access } = useSession();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const balances = useQuery({
    queryKey: ['leave', 'balances'],
    queryFn: () => api('/leave/balances', { schema: leaveBalanceSchema }),
  });
  const mine = useQuery({
    queryKey: ['leave', 'requests', 'mine'],
    queryFn: () => api('/leave/requests?view=mine', { schema: leaveListResponseSchema }),
  });
  const approvesLeave = canAny(access, 'leave.request.approve');
  const approvesCorrections = canAny(access, 'attendance.correction.approve');
  const approvals = useQuery({
    queryKey: ['leave', 'requests', 'approvals'],
    enabled: approvesLeave,
    queryFn: () =>
      api('/leave/requests?view=approvals&status=pending', { schema: leaveListResponseSchema }),
  });
  const corrections = useQuery({
    queryKey: ['attendance', 'corrections', 'approvals'],
    enabled: approvesCorrections,
    queryFn: () =>
      api('/attendance/corrections?view=approvals', { schema: correctionListResponseSchema }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['leave'] });
    void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: LeaveRequest['actions'][number] }) =>
      api(`/leave/requests/${id}/${action}`, {
        method: 'POST',
        body: notes[id] ? { note: notes[id] } : {},
        schema: leaveRequestSchema,
      }),
    onSuccess: (_data, { action }) => {
      setDone(t(`ui.leave.done.${action}`));
      refresh();
    },
  });
  const decideCorrection = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api(`/attendance/corrections/${id}/${action}`, {
        method: 'POST',
        body: notes[id] ? { note: notes[id] } : {},
        schema: correctionSchema,
      }),
    onSuccess: () => {
      setDone(t('ui.common.save'));
      refresh();
    },
  });
  const range = (r: { startDate: string; endDate: string }) =>
    r.startDate === r.endDate
      ? formatDate(locale, new Date(`${r.startDate}T12:00:00`), { dateStyle: 'medium' })
      : `${formatDate(locale, new Date(`${r.startDate}T12:00:00`), { day: 'numeric', month: 'short' })} – ${formatDate(locale, new Date(`${r.endDate}T12:00:00`), { dateStyle: 'medium' })}`;
  const myRequests = mine.data?.items ?? [];
  const pending = approvals.data?.items.filter((r) => r.actions.includes('approve')) ?? [];
  const pendingCorrections =
    corrections.data?.items.filter((c) => c.actions.includes('approve')) ?? [];

  return (
    <Screen onRefresh={refresh} refreshing={mine.isRefetching}>
      <Text level="title" accessibilityRole="header">
        {t('ui.leave.title')}
      </Text>
      {done ? <Notice text={done} /> : null}

      <Card
        title={t('ui.leave.balances', { year: balances.data?.year ?? new Date().getFullYear() })}
        action={
          <Button
            label={t('ui.leave.apply')}
            onPress={() => {
              navigation.navigate('LeaveApply');
            }}
            testID="apply-leave"
          />
        }
      >
        {balances.isPending ? <Loading /> : null}
        {balances.isError ? <ErrorView error={balances.error} onRetry={refresh} /> : null}
        <Inline wrap gap={10}>
          {balances.data?.items
            .filter((item) => item.deductsBalance)
            .map((item) => (
              <Tile
                key={item.type.id}
                tone="butter"
                label={name(item.type.name)}
                value={t('ui.mobile.daysShort', { days: item.balance })}
                hint={t('ui.leave.balanceLine', {
                  accrued: item.accrued,
                  taken: item.taken,
                  pending: item.pending,
                })}
              />
            ))}
        </Inline>
        {balances.data?.items.some((item) => item.type.toVerify) ? (
          <Text level="caption" tone="ink3">
            {t('ui.leave.verifyNote')}
          </Text>
        ) : null}
      </Card>

      <Card title={t('ui.leave.myRequests')}>
        {mine.isPending ? <Loading /> : null}
        {mine.isError ? <ErrorView error={mine.error} onRetry={refresh} /> : null}
        {mine.data?.items.length === 0 ? (
          <Empty title={t('ui.leave.noRequests')} body={t('ui.leave.noRequestsBody')} />
        ) : null}
        {myRequests.map((r, index) => (
          <Row
            key={r.id}
            title={`${name(r.type.name)} · ${range(r)}`}
            subtitle={`${t('ui.leave.daysValue', { days: r.days })}${r.decisionNote && r.decidedByName ? ` · ${t('ui.leave.note', { name: r.decidedByName, note: r.decisionNote })}` : ''}`}
            last={index === myRequests.length - 1}
            trailing={
              r.actions.includes('withdraw') || r.actions.includes('cancel') ? (
                <Button
                  label={
                    r.actions.includes('withdraw')
                      ? t('ui.leave.actions.withdraw')
                      : t('ui.leave.actions.cancel')
                  }
                  variant="ghost"
                  loading={decide.isPending && decide.variables.id === r.id}
                  onPress={() => {
                    decide.mutate({
                      id: r.id,
                      action: r.actions.includes('withdraw') ? 'withdraw' : 'cancel',
                    });
                  }}
                />
              ) : (
                <Chip tone={STATUS_TONE[r.status]} label={t(`ui.leave.status.${r.status}`)} />
              )
            }
          />
        ))}
        <FormError error={decide.error} />
      </Card>

      {approvesLeave ? (
        <Card title={t('ui.leave.tabs.approvals')}>
          {approvals.isPending ? <Loading /> : null}
          {approvals.isError ? <ErrorView error={approvals.error} onRetry={refresh} /> : null}
          {approvals.data && pending.length === 0 ? (
            <Empty title={t('ui.leave.nothingWaiting')} body={t('ui.leave.nothingWaitingBody')} />
          ) : null}
          {pending.map((r) => (
            <Stack key={r.id} gap={6}>
              <Row
                title={`${r.person.name} · ${name(r.type.name)}`}
                subtitle={`${range(r)} · ${t('ui.leave.daysValue', { days: r.days })}${r.reason ? ` · ${r.reason}` : ''}`}
                last
              />
              <Field
                label={t('ui.leave.decisionNote')}
                value={notes[r.id] ?? ''}
                onChangeText={(v) => {
                  setNotes((n) => ({ ...n, [r.id]: v }));
                }}
              />
              <Inline>
                <Button
                  label={t('ui.leave.actions.approve')}
                  onPress={() => {
                    decide.mutate({ id: r.id, action: 'approve' });
                  }}
                  loading={decide.isPending && decide.variables.id === r.id}
                />
                <Button
                  label={t('ui.leave.actions.reject')}
                  variant="danger"
                  onPress={() => {
                    decide.mutate({ id: r.id, action: 'reject' });
                  }}
                />
              </Inline>
            </Stack>
          ))}
        </Card>
      ) : null}

      {approvesCorrections ? (
        <Card title={t('ui.attendance.tabs.approvals')}>
          {corrections.isPending ? <Loading /> : null}
          {corrections.isError ? <ErrorView error={corrections.error} onRetry={refresh} /> : null}
          {corrections.data && pendingCorrections.length === 0 ? (
            <Empty
              title={t('ui.attendance.nothingWaiting')}
              body={t('ui.attendance.nothingWaitingBody')}
            />
          ) : null}
          {pendingCorrections.map((c) => (
            <Stack key={c.id} gap={6}>
              <Row
                title={`${c.person.name} · ${t(`ui.attendance.kind.${c.kind}`)} · ${formatDate(locale, new Date(c.at), { dateStyle: 'medium', timeStyle: 'short' })}`}
                subtitle={c.reason}
                last
              />
              <Field
                label={t('ui.attendance.reviewerNote')}
                value={notes[c.id] ?? ''}
                onChangeText={(v) => {
                  setNotes((n) => ({ ...n, [c.id]: v }));
                }}
              />
              <Inline>
                <Button
                  label={t('ui.attendance.approve')}
                  onPress={() => {
                    decideCorrection.mutate({ id: c.id, action: 'approve' });
                  }}
                  loading={decideCorrection.isPending && decideCorrection.variables.id === c.id}
                />
                <Button
                  label={t('ui.attendance.reject')}
                  variant="danger"
                  disabled={!notes[c.id]}
                  onPress={() => {
                    decideCorrection.mutate({ id: c.id, action: 'reject' });
                  }}
                />
              </Inline>
            </Stack>
          ))}
          <FormError error={decideCorrection.error} />
        </Card>
      ) : null}
    </Screen>
  );
}
