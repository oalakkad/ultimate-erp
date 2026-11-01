import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { correctionSchema } from '@ultimate-erp/contracts';
import { useState } from 'react';
import { useI18n } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useApi } from '../core/session';
import { HHMM, ISO_DATE, todayIso } from '../lib/dates';
import { Button, Field, Segments } from '../ui/controls';
import { FormError } from '../ui/states';
import { Card, Screen } from '../ui/surfaces';
import { Text } from '../ui/text';

type Props = NativeStackScreenProps<RootParamList, 'Correction'>;

/** Asks for a missing check-in or check-out; the team lead / HR reviews it. */
export function CorrectionScreen({ navigation }: Props) {
  const { t } = useI18n();
  const api = useApi();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const dateOk = ISO_DATE.test(date);
  const timeOk = HHMM.test(time);

  const send = useMutation({
    mutationFn: () => {
      // The device's own offset: the server stores the instant and shows Kuwait time.
      const local = new Date(`${date}T${time}:00`);
      return api('/attendance/corrections', {
        method: 'POST',
        body: { kind, at: local.toISOString(), reason: reason.trim() },
        schema: correctionSchema,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      navigation.goBack();
    },
  });

  return (
    <Screen>
      <Card>
        <Text level="label" tone="ink2">
          {t('ui.attendance.missing')}
        </Text>
        <Segments
          value={kind}
          onChange={setKind}
          options={[
            { value: 'in', label: t('ui.attendance.kind.in') },
            { value: 'out', label: t('ui.attendance.kind.out') },
          ]}
        />
        <Field
          label={t('ui.attendance.date')}
          value={date}
          onChangeText={setDate}
          autoCapitalize="none"
          hint={t('ui.mobile.dateFormat')}
          error={date !== '' && !dateOk ? t('ui.mobile.dateFormat') : undefined}
        />
        <Field
          label={t('ui.attendance.time')}
          value={time}
          onChangeText={setTime}
          autoCapitalize="none"
          hint={t('ui.mobile.timeFormat')}
          error={time !== '' && !timeOk ? t('ui.mobile.timeFormat') : undefined}
        />
        <Field
          label={t('ui.attendance.reason')}
          value={reason}
          onChangeText={setReason}
          multiline
        />
        <FormError error={send.error} />
        <Button
          label={t('ui.attendance.askCorrection')}
          loading={send.isPending}
          disabled={!dateOk || !timeOk || reason.trim() === ''}
          onPress={() => {
            send.mutate();
          }}
        />
      </Card>
    </Screen>
  );
}
