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
import { radius, space, type ToneName, useTheme } from '../ui/theme';

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
          <View style={[styles.showcase, { backgroundColor: theme.plum }]}>
            <View style={[styles.blob, styles.blobTop, { backgroundColor: theme.lilac.solid }]} />
            <View style={[styles.blob, styles.blobBottom, { backgroundColor: theme.mint.solid }]} />
            <View style={styles.logoRow}>
              <View style={styles.mark}>
                <View
                  style={[styles.markSquare, styles.markBack, { backgroundColor: theme.onPlum }]}
                />
                <View
                  style={[
                    styles.markSquare,
                    styles.markFront,
                    { backgroundColor: theme.lilac.solid },
                  ]}
                />
              </View>
              <Text level="label" color={theme.onPlum}>
                Ultimate
              </Text>
            </View>
            <Text level="display" color={theme.onPlum} accessibilityRole="header">
              {t('ui.auth.showcaseTitle')}
            </Text>
            <Text level="caption" color={theme.onPlum} style={styles.showcaseBody}>
              {t('ui.auth.showcaseBody')}
            </Text>
            <View style={styles.chips} accessibilityLabel={t('ui.auth.showcaseModules')}>
              {SHOWCASE.map(({ key, tone }) => (
                <View key={key} style={[styles.chip, { backgroundColor: theme[tone].bg }]}>
                  <Text level="caption" color={theme[tone].ink}>
                    {t(`ui.shell.${key}`)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <Text level="title" accessibilityRole="header">
            {t('ui.auth.signInTitle')}
          </Text>
          <Text tone="ink2">{t('ui.mobile.signInBody')}</Text>
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

/** The modules named on the welcome panel: real module names, a pastel tone each. */
const SHOWCASE: {
  key: 'clients' | 'projects' | 'time' | 'attendance' | 'leave';
  tone: ToneName;
}[] = [
  { key: 'clients', tone: 'sky' },
  { key: 'projects', tone: 'mint' },
  { key: 'time', tone: 'butter' },
  { key: 'attendance', tone: 'mint' },
  { key: 'leave', tone: 'lilac' },
];

const styles = StyleSheet.create({
  showcase: {
    borderRadius: radius.card,
    padding: space.xl,
    gap: space.md,
    overflow: 'hidden',
    marginTop: space.sm,
  },
  blob: { position: 'absolute', borderRadius: 999, opacity: 0.22 },
  blobTop: { width: 220, height: 220, top: -110, end: -70 },
  blobBottom: { width: 160, height: 160, bottom: -90, start: -50, opacity: 0.16 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 30, height: 30 },
  markSquare: { position: 'absolute', width: 20, height: 20, borderRadius: 7 },
  markBack: { top: 0, start: 0 },
  markFront: { bottom: 0, end: 0 },
  showcaseBody: { opacity: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
});
