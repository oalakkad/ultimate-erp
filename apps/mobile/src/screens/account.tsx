import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation } from '@tanstack/react-query';
import { type Locale } from '@ultimate-erp/i18n';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useSession } from '../core/session';
import { APP_VERSION } from '../lib/config';
import { Button, Segments } from '../ui/controls';
import { FormError, Notice } from '../ui/states';
import { Card, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';

type Props = NativeStackScreenProps<RootParamList, 'Account'>;

/** Who I am, language, company switch, sign out. */
export function AccountScreen({ navigation }: Props) {
  const { t, locale, setLocale, restartNeeded } = useI18n();
  const name = useName();
  const session = useSession();
  const saveLocale = useMutation({
    mutationFn: (next: Locale) => {
      setLocale(next);
      return session.mainApi('/auth/me', { method: 'PATCH', body: { locale: next } });
    },
  });
  const signOut = useMutation({
    mutationFn: () => session.signOut(),
    onSuccess: () => {
      navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
    },
  });
  const leave = useMutation({
    mutationFn: () => session.leaveCompany(),
    onSuccess: () => {
      navigation.reset({ index: 0, routes: [{ name: 'Companies' }] });
    },
  });

  return (
    <Screen>
      <Card title={t('ui.account.profile')}>
        <Text level="heading">{session.user?.name ?? ''}</Text>
        <Text tone="ink2">{session.user?.email ?? ''}</Text>
        {session.company ? (
          <Text level="caption" tone="ink3">
            {name(session.company.name)} ·{' '}
            {session.access?.roles.map((r) => t(`roles.${r as 'owner'}`)).join(' · ')}
          </Text>
        ) : null}
        <Text level="caption" tone="ink3">
          {session.server}
        </Text>
      </Card>
      <Card title={t('ui.account.language')}>
        <Segments
          value={locale}
          onChange={(next) => {
            saveLocale.mutate(next);
          }}
          options={[
            { value: 'en', label: t('ui.common.english') },
            { value: 'ar', label: t('ui.common.arabic') },
          ]}
        />
        {restartNeeded ? <Notice tone="butter" text={t('ui.mobile.rtlRestart')} /> : null}
        <FormError error={saveLocale.error} />
      </Card>
      <Card>
        <Stack>
          <Button
            label={t('ui.mobile.switchCompany')}
            variant="ghost"
            loading={leave.isPending}
            onPress={() => {
              leave.mutate();
            }}
          />
          <Button
            label={t('ui.auth.signOut')}
            variant="danger"
            loading={signOut.isPending}
            onPress={() => {
              signOut.mutate();
            }}
            testID="sign-out"
          />
          <FormError error={signOut.error} />
        </Stack>
      </Card>
      <Text level="caption" tone="ink3">
        {t('ui.mobile.about')} · {APP_VERSION}
      </Text>
    </Screen>
  );
}
