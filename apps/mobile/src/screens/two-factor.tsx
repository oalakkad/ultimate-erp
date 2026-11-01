import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useSession } from '../core/session';
import { Button, Field, Toggle } from '../ui/controls';
import { FormError } from '../ui/states';
import { Card, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';

type Props = NativeStackScreenProps<RootParamList, 'TwoFactor'>;

/** Second step: authenticator code, or a backup code. */
export function TwoFactorScreen({ navigation }: Props) {
  const { t } = useI18n();
  const session = useSession();
  const [kind, setKind] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const verify = useMutation({
    mutationFn: () => session.verifyTwoFactor(code.trim(), kind, trust),
    onSuccess: () => {
      navigation.replace('Companies');
    },
  });
  const valid = kind === 'totp' ? /^\d{6}$/.test(code.trim()) : code.trim().length > 0;

  return (
    <Screen>
      <Stack>
        <Text tone="ink2">{t('ui.auth.twoFactorBody')}</Text>
        <Card>
          <Field
            label={kind === 'totp' ? t('ui.auth.code') : t('ui.auth.backupCode')}
            value={code}
            onChangeText={setCode}
            keyboardType={kind === 'totp' ? 'number-pad' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            testID="code"
            onSubmitEditing={() => {
              if (valid) verify.mutate();
            }}
          />
          <Toggle
            label={t('ui.auth.trustDevice')}
            hint={t('ui.auth.trustDeviceHint')}
            value={trust}
            onChange={setTrust}
          />
          <FormError error={verify.error} />
          <Button
            label={t('ui.auth.verify')}
            loading={verify.isPending}
            disabled={!valid}
            onPress={() => {
              verify.mutate();
            }}
            testID="verify"
          />
          <Button
            label={kind === 'totp' ? t('ui.auth.useBackupCode') : t('ui.auth.useAuthenticator')}
            variant="ghost"
            onPress={() => {
              setKind((k) => (k === 'totp' ? 'backup' : 'totp'));
              setCode('');
            }}
          />
          <Button
            label={t('ui.auth.backToSignIn')}
            variant="ghost"
            onPress={() => {
              void session.signOut();
              navigation.replace('SignIn');
            }}
          />
        </Card>
      </Stack>
    </Screen>
  );
}
