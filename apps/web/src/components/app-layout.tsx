import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { okResponseSchema } from '@ultimate-erp/contracts';
import {
  AppFrame,
  Avatar,
  Button,
  ErrorState,
  LoadingState,
  Logo,
  NavGroup,
  NavItem,
  ProfileCard,
  Sidebar,
  Topbar,
} from '@ultimate-erp/ui';
import { LayoutGrid, LogOut, UserRound, Users } from 'lucide-react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch, ThemeSwitch } from '../app/switches.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { can, useAccess, useMe, useTenant } from '../lib/session.js';
import { NotificationBell } from './notification-bell.js';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

/**
 * The signed-in company app. Requires: a company address, a session, membership. Sensitive
 * roles without two-factor are sent to the security page (the server also refuses everything
 * else with MFA_REQUIRED). The sidebar lists only modules that exist (owner decision).
 */
export function AppLayout() {
  const { t, locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tenant = useTenant();
  const me = useMe();
  const access = useAccess(Boolean(tenant.data && me.data));
  const signOut = useMutation({
    mutationFn: () => api('/auth/sign-out', { method: 'POST', schema: okResponseSchema }),
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: '/sign-in' });
    },
  });

  const failed = tenant.error ?? me.error ?? access.error;
  if (failed) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, failed)}
          reference={errorReference(t, failed)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void queryClient.invalidateQueries()}
        />
      </div>
    );
  }
  if (tenant.isPending || me.isPending || (tenant.data && me.data && access.isPending)) {
    return (
      <div className="mx-auto max-w-md p-6">
        <LoadingState label={t('ui.common.loading')} />
      </div>
    );
  }
  if (!tenant.data) return <Navigate to={me.data ? '/companies' : '/sign-in'} />;
  if (!me.data) return <Navigate to="/sign-in" search={{ returnTo: location.pathname }} />;
  if (!access.data) return <Navigate to="/sign-in" />;
  if (access.data.twoFactorRequired && location.pathname !== '/account') {
    return <Navigate to="/account" />;
  }

  const user = me.data.user;
  const company = locale === 'ar' ? tenant.data.name.ar : tenant.data.name.en;
  const path = location.pathname;

  return (
    <div className="min-h-screen p-3 md:p-4">
      <AppFrame
        sidebar={
          <Sidebar
            label={t('ui.shell.mainNavigation')}
            header={<Logo subtitle={company} />}
            profile={
              <ProfileCard
                avatar={<Avatar name={user.name} initials={initialsOf(user.name)} size={48} />}
                name={user.name}
                subtitle={access.data.roles.map((role) => t(`roles.${role}`)).join(' · ')}
              />
            }
            footer={
              <NavItem
                href="/account"
                icon={<UserRound aria-hidden />}
                label={t('ui.shell.myAccount')}
                current={path === '/account'}
              />
            }
          >
            <NavGroup title={t('ui.shell.groupMain')}>
              <NavItem
                href="/"
                icon={<LayoutGrid aria-hidden />}
                label={t('ui.shell.dashboard')}
                current={path === '/'}
              />
              {can(access.data, 'access.members.read') && (
                <NavItem
                  href="/members"
                  icon={<Users aria-hidden />}
                  label={t('ui.shell.members')}
                  current={path === '/members'}
                />
              )}
            </NavGroup>
          </Sidebar>
        }
      >
        <Topbar
          actions={
            <>
              {/* Hidden until two-factor is set up: the server refuses it with MFA_REQUIRED. */}
              {!access.data.twoFactorRequired && <NotificationBell />}
              <ThemeSwitch />
              <LanguageSwitch />
              <Button
                variant="secondary"
                icon={<LogOut aria-hidden className="mirror size-4" />}
                loading={signOut.isPending}
                onClick={() => {
                  signOut.mutate();
                }}
              >
                {t('ui.auth.signOut')}
              </Button>
            </>
          }
        />
        <Outlet />
      </AppFrame>
    </div>
  );
}
