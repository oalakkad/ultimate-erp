import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { UiProvider } from '@ultimate-erp/ui';
import { AppLayout } from '../components/app-layout.js';
import { AccountPage } from '../routes/account.js';
import { CheckEmailPage, VerifyEmailPage } from '../routes/auth/email-pages.js';
import { ForgotPasswordPage, ResetPasswordPage } from '../routes/auth/password-pages.js';
import { SignInPage } from '../routes/auth/sign-in.js';
import { SignUpPage } from '../routes/auth/sign-up.js';
import { CompaniesPage } from '../routes/companies.js';
import { DashboardPage } from '../routes/dashboard.js';
import { GalleryPage } from '../routes/gallery.js';
import { HandoffPage } from '../routes/handoff.js';
import { InvitationPage } from '../routes/invitation.js';
import { MembersPage } from '../routes/members.js';
import { useI18n } from './i18n.js';

function RootLayout() {
  const { dir, t } = useI18n();
  return (
    <UiProvider dir={dir} closeLabel={t('ui.common.close')}>
      <Outlet />
    </UiProvider>
  );
}

/**
 * Declares which query-string values a page accepts (for typed links). Values are only ever
 * strings; pages still validate them (e.g. safeReturnTo) before use.
 */
function searchOf<K extends string>(...keys: K[]) {
  return (search: Record<string, unknown>): Partial<Record<K, string>> => {
    const out: Partial<Record<K, string>> = {};
    for (const key of keys) {
      const value = search[key];
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  };
}

const rootRoute = createRootRoute({ component: RootLayout });
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: SignInPage,
  validateSearch: searchOf('returnTo'),
});
const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  component: SignUpPage,
  validateSearch: searchOf('returnTo'),
});
const checkEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/check-email',
  component: CheckEmailPage,
  validateSearch: searchOf('email', 'returnTo'),
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  component: VerifyEmailPage,
  validateSearch: searchOf('token'),
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
  validateSearch: searchOf('token'),
});
const companiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/companies',
  component: CompaniesPage,
});
const handoffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/handoff',
  component: HandoffPage,
  validateSearch: searchOf('ticket'),
});
const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitations/accept',
  component: InvitationPage,
  validateSearch: searchOf('token'),
});
const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gallery',
  component: GalleryPage,
});

/** The signed-in company app (guards live in AppLayout). */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppLayout });
const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: DashboardPage,
});
const membersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/members',
  component: MembersPage,
});
const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: AccountPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    signInRoute,
    signUpRoute,
    checkEmailRoute,
    verifyEmailRoute,
    forgotRoute,
    resetRoute,
    companiesRoute,
    handoffRoute,
    invitationRoute,
    galleryRoute,
    appRoute.addChildren([dashboardRoute, membersRoute, accountRoute]),
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
