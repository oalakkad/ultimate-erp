import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type MyCompany, isRole } from '@ultimate-erp/contracts';
import { useI18n, useName } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { useSession } from '../core/session';
import { Button } from '../ui/controls';
import { Empty, ErrorView, FormError, Loading } from '../ui/states';
import { Card, Row, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';

type Props = NativeStackScreenProps<RootParamList, 'Companies'>;

/** The companies this person belongs to; choosing one performs the hand-off. */
export function CompaniesScreen({ navigation }: Props) {
  const { t } = useI18n();
  const name = useName();
  const session = useSession();
  const companies = useQuery({ queryKey: ['companies'], queryFn: session.listCompanies });
  const open = useMutation({
    mutationFn: (company: MyCompany) => session.openCompany(company),
    onSuccess: () => {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    },
  });
  const list = companies.data ?? [];
  const roleNames = (roles: string[]) =>
    roles
      .filter(isRole)
      .map((role) => t(`roles.${role}`))
      .join(' · ');

  return (
    <Screen onRefresh={() => void companies.refetch()} refreshing={companies.isRefetching}>
      <Stack>
        <Text level="title" accessibilityRole="header">
          {t('ui.mobile.companiesTitle')}
        </Text>
        <Text tone="ink2">{t('ui.mobile.companiesBody')}</Text>
        {session.user ? (
          <Text level="caption" tone="ink3">
            {t('ui.mobile.signedInAs', { email: session.user.email })}
          </Text>
        ) : null}
        <Card>
          {companies.isPending ? <Loading /> : null}
          {companies.isError ? (
            <ErrorView error={companies.error} onRetry={() => void companies.refetch()} />
          ) : null}
          {companies.data?.length === 0 ? (
            <Empty title={t('ui.mobile.noCompanies')} body={t('ui.mobile.noCompaniesBody')} />
          ) : null}
          {list.map((company, index) => (
            <Row
              key={company.tenantId}
              title={name(company.name)}
              subtitle={roleNames(company.roles)}
              last={index === list.length - 1}
              onPress={() => {
                open.mutate(company);
              }}
              testID={`company-${company.slug}`}
              trailing={
                open.isPending && open.variables.tenantId === company.tenantId ? (
                  <Text level="caption" tone="ink3">
                    {t('ui.mobile.opening')}
                  </Text>
                ) : null
              }
            />
          ))}
          <FormError error={open.error} />
        </Card>
        <Button
          label={t('ui.auth.signOut')}
          variant="ghost"
          onPress={() => {
            void session.signOut().then(() => {
              navigation.reset({ index: 0, routes: [{ name: 'SignIn' }] });
            });
          }}
        />
      </Stack>
    </Screen>
  );
}
