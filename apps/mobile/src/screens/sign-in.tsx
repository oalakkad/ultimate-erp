import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useI18n } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useSession } from '../core/session';
import { normaliseServerUrl } from '../lib/api';
import { Button, Field } from '../ui/controls';
import { FormError } from '../ui/states';
import { Card, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';
import { space, useTheme } from '../ui/theme';

type Props = NativeStackScreenProps<RootParamList, 'SignIn'>;

/** Email + password against the main address; the server address can be changed (on-prem). */
export function SignInScreen({ navigation }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [server, setServer] = useState(session.server);
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const signIn = useMutation({
    mutationFn: async () => {
      const origin = normaliseServerUrl(server);
      if (!origin) {
        setServerError(t('ui.mobile.serverInvalid'));
        throw new Error('server');
      }
      if (origin !== session.server) await session.setServer(origin);
      return session.signIn(email.trim(), password);
    },
    onSuccess: (result) => {
      navigation.replace(result.status === 'signed_in' ? 'Companies' : 'TwoFactor');
    },
  });
  const formError = signIn.error && signIn.error.message !== 'server' ? signIn.error : null;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Stack gap={space.xl}>
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: theme.plum }]}>
              <Text level="heading" color={theme.onPlum}>
                U
              </Text>
            </View>
            <Text level="title" accessibilityRole="header">
              {t('ui.auth.signInTitle')}
            </Text>
            <Text tone="ink2">{t('ui.mobile.signInBody')}</Text>
          </View>
          <Card>
            <Field
              label={t('ui.auth.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              testID="email"
            />
            <Field
              label={t('ui.auth.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              testID="password"
              onSubmitEditing={() => {
                signIn.mutate();
              }}
            />
            {showServer ? (
              <Field
                label={t('ui.mobile.server')}
                value={server}
                onChangeText={(v) => {
                  setServer(v);
                  setServerError(undefined);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                error={serverError}
                hint={t('ui.mobile.serverHint')}
                testID="server"
              />
            ) : null}
            <FormError error={formError} />
            <Button
              label={t('ui.auth.signInSubmit')}
              loading={signIn.isPending}
              disabled={email.trim() === '' || password === ''}
              onPress={() => {
                signIn.mutate();
              }}
              testID="sign-in"
            />
            <Button
              label={showServer ? t('ui.common.close') : t('ui.mobile.server')}
              variant="ghost"
              onPress={() => {
                setShowServer((v) => !v);
              }}
            />
          </Card>
        </Stack>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { gap: space.sm, paddingTop: space.xxl },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
});
