import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  leavePreviewSchema,
  leaveRequestSchema,
  leaveTypeListResponseSchema,
} from '@ultimate-erp/contracts';
import { useEffect, useState } from 'react';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useApi } from '../core/session';
import { ISO_DATE, todayIso } from '../lib/dates';
import { Button, Choices, Field, Toggle } from '../ui/controls';
import { ErrorView, FormError, Loading, Notice } from '../ui/states';
import { Card, Screen, Stack } from '../ui/surfaces';

type Props = NativeStackScreenProps<RootParamList, 'LeaveApply'>;
type HalfDay = 'none' | 'first' | 'second';

/** Apply for leave with a live preview (working days, balance after, problems) before sending. */
export function LeaveApplyScreen({ navigation }: Props) {
  const { t } = useI18n();
  const name = useName();
  const api = useApi();
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState<string | null>(null);
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [halfDay, setHalfDay] = useState<HalfDay>('none');
  const [reason, setReason] = useState('');

  const types = useQuery({
    queryKey: ['leave', 'types'],
    queryFn: () => api('/leave/types', { schema: leaveTypeListResponseSchema }),
  });
  const active = types.data?.items.filter((item) => !item.archived) ?? [];
  const chosen = active.find((item) => item.id === typeId);
  const datesOk = ISO_DATE.test(start) && ISO_DATE.test(end) && end >= start;
  const body = {
    leaveTypeId: typeId,
    startDate: start,
    endDate: end,
    ...(halfDay === 'none' ? {} : { halfDay }),
    ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
  };

  const preview = useMutation({
    mutationFn: () =>
      api('/leave/requests/preview', {
        method: 'POST',
        body: { ...body, preview: true },
        schema: leavePreviewSchema,
      }),
  });
  useEffect(() => {
    if (typeId && datesOk) preview.mutate();
    // Re-run the preview whenever the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId, start, end, halfDay]);

  const send = useMutation({
    mutationFn: () => api('/leave/requests', { method: 'POST', body, schema: leaveRequestSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] });
      navigation.goBack();
    },
  });
  const problems = preview.data?.problems ?? [];

  return (
    <Screen>
      <Card>
        {types.isPending ? <Loading /> : null}
        {types.isError ? (
          <ErrorView error={types.error} onRetry={() => void types.refetch()} />
        ) : null}
        {types.data ? (
          <Stack>
            <Choices
              label={t('ui.leave.type')}
              value={typeId}
              onChange={setTypeId}
              options={active.map((item) => ({
                value: item.id,
                label: name(item.name),
                hint: `${t('ui.leave.typeLine', { days: item.annualDays, accrual: t(`ui.leave.accrual.${item.accrual}`) })}${item.toVerify ? ` · ${t('ui.leave.toVerify')}` : ''}`,
              }))}
            />
            <Field
              label={t('ui.leave.from')}
              value={start}
              onChangeText={setStart}
              autoCapitalize="none"
              hint={t('ui.mobile.dateFormat')}
              error={start !== '' && !ISO_DATE.test(start) ? t('ui.mobile.dateFormat') : undefined}
              testID="leave-from"
            />
            <Field
              label={t('ui.leave.to')}
              value={end}
              onChangeText={setEnd}
              autoCapitalize="none"
              hint={t('ui.mobile.dateFormat')}
              error={
                end !== '' && (!ISO_DATE.test(end) || end < start)
                  ? t('ui.mobile.dateFormat')
                  : undefined
              }
              testID="leave-to"
            />
            {chosen?.allowHalfDay && start === end ? (
              <Toggle
                label={t('ui.leave.halfDay')}
                value={halfDay !== 'none'}
                onChange={(on) => {
                  setHalfDay(on ? 'first' : 'none');
                }}
              />
            ) : null}
            <Field label={t('ui.leave.reason')} value={reason} onChangeText={setReason} multiline />
            {preview.data ? (
              <Notice
                tone={problems.length > 0 ? 'butter' : 'mint'}
                text={`${t('ui.leave.previewDays', { days: preview.data.days })}${
                  preview.data.balanceBefore !== null && preview.data.balanceAfter !== null
                    ? ` · ${t('ui.leave.previewBalance', { before: preview.data.balanceBefore, after: preview.data.balanceAfter })}`
                    : ''
                }${problems.map((p) => `\n${t(`ui.leave.problem.${p}`)}`).join('')}`}
              />
            ) : null}
            <FormError error={preview.error} />
            <FormError error={send.error} />
            <Button
              label={t('ui.leave.submit')}
              loading={send.isPending}
              disabled={!typeId || !datesOk || problems.length > 0 || preview.isPending}
              onPress={() => {
                send.mutate();
              }}
              testID="send-leave"
            />
          </Stack>
        ) : null}
      </Card>
    </Screen>
  );
}
