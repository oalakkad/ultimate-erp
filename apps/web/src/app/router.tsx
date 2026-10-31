import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';
import { UiProvider } from '@ultimate-erp/ui';
import { AppLayout } from '../components/app-layout.js';
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
  component: lazyRouteComponent(() => import('../routes/auth/sign-in.js'), 'SignInPage'),
  validateSearch: searchOf('returnTo'),
});
const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  component: lazyRouteComponent(() => import('../routes/auth/sign-up.js'), 'SignUpPage'),
  validateSearch: searchOf('returnTo'),
});
const checkEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/check-email',
  component: lazyRouteComponent(() => import('../routes/auth/email-pages.js'), 'CheckEmailPage'),
  validateSearch: searchOf('email', 'returnTo'),
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  component: lazyRouteComponent(() => import('../routes/auth/email-pages.js'), 'VerifyEmailPage'),
  validateSearch: searchOf('token'),
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: lazyRouteComponent(
    () => import('../routes/auth/password-pages.js'),
    'ForgotPasswordPage',
  ),
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: lazyRouteComponent(
    () => import('../routes/auth/password-pages.js'),
    'ResetPasswordPage',
  ),
  validateSearch: searchOf('token'),
});
const companiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/companies',
  component: lazyRouteComponent(() => import('../routes/companies.js'), 'CompaniesPage'),
});
const handoffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/handoff',
  component: lazyRouteComponent(() => import('../routes/handoff.js'), 'HandoffPage'),
  validateSearch: searchOf('ticket'),
});
const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitations/accept',
  component: lazyRouteComponent(() => import('../routes/invitation.js'), 'InvitationPage'),
  validateSearch: searchOf('token'),
});
const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gallery',
  component: lazyRouteComponent(() => import('../routes/gallery.js'), 'GalleryPage'),
});

/** The signed-in company app (guards live in AppLayout). */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppLayout });
const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: lazyRouteComponent(() => import('../routes/dashboard.js'), 'DashboardPage'),
});
const membersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/members',
  component: lazyRouteComponent(() => import('../routes/members.js'), 'MembersPage'),
  validateSearch: searchOf('invite'),
});
const clientsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clients',
  component: lazyRouteComponent(() => import('../routes/clients/list.js'), 'ClientsPage'),
});
const newClientRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clients/new',
  component: lazyRouteComponent(() => import('../routes/clients/new.js'), 'NewClientPage'),
});
const clientRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clients/$clientId',
  component: lazyRouteComponent(() => import('../routes/clients/detail.js'), 'ClientDetailPage'),
});
const contractsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contracts',
  component: lazyRouteComponent(() => import('../routes/contracts/list.js'), 'ContractsPage'),
  validateSearch: searchOf('expiring'),
});
const newContractRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contracts/new',
  component: lazyRouteComponent(() => import('../routes/contracts/new.js'), 'NewContractPage'),
  validateSearch: searchOf('clientId'),
});
const contractTemplatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contracts/templates',
  component: lazyRouteComponent(
    () => import('../routes/contracts/templates.js'),
    'ContractTemplatesPage',
  ),
});
const contractRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/contracts/$contractId',
  component: lazyRouteComponent(
    () => import('../routes/contracts/detail.js'),
    'ContractDetailPage',
  ),
});
/** Print view: outside the app frame so it prints cleanly. */
const contractPrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/contracts/$contractId/print',
  component: lazyRouteComponent(() => import('../routes/contracts/print.js'), 'ContractPrintPage'),
});
const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: lazyRouteComponent(() => import('../routes/projects/list.js'), 'ProjectsPage'),
});
const newProjectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/new',
  component: lazyRouteComponent(() => import('../routes/projects/new.js'), 'NewProjectPage'),
  validateSearch: searchOf('clientId'),
});
const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectId',
  component: lazyRouteComponent(() => import('../routes/projects/detail.js'), 'ProjectDetailPage'),
});
const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks',
  component: lazyRouteComponent(() => import('../routes/tasks/list.js'), 'TasksPage'),
  validateSearch: searchOf('mine', 'overdue'),
});
const newTaskRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/new',
  component: lazyRouteComponent(() => import('../routes/tasks/new.js'), 'NewTaskPage'),
  validateSearch: searchOf('projectId'),
});
const taskRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tasks/$taskId',
  component: lazyRouteComponent(() => import('../routes/tasks/detail.js'), 'TaskDetailPage'),
});
const timeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/time',
  component: lazyRouteComponent(() => import('../routes/time/my-time.js'), 'MyTimePage'),
  validateSearch: searchOf('week', 'taskId'),
});
const timeApprovalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/time/approvals',
  component: lazyRouteComponent(() => import('../routes/time/approvals.js'), 'TimeApprovalsPage'),
});
const peopleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people',
  component: lazyRouteComponent(() => import('../routes/people/list.js'), 'PeoplePage'),
});
const personRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/people/$membershipId',
  component: lazyRouteComponent(() => import('../routes/people/detail.js'), 'PersonPage'),
});
const organisationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/organisation',
  component: lazyRouteComponent(
    () => import('../routes/people/organisation.js'),
    'OrganisationPage',
  ),
});
const leaveRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/leave',
  component: lazyRouteComponent(() => import('../routes/leave/leave.js'), 'LeavePage'),
  validateSearch: searchOf('view'),
});
const attendanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/attendance',
  component: lazyRouteComponent(
    () => import('../routes/attendance/attendance.js'),
    'AttendancePage',
  ),
});
const attendanceScanRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/attendance/scan',
  component: lazyRouteComponent(() => import('../routes/attendance/scan.js'), 'ScanPage'),
  validateSearch: searchOf('code'),
});
/** Kiosk display: outside the app frame, full screen at the office. */
const kioskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/attendance/kiosk/$siteId',
  component: lazyRouteComponent(() => import('../routes/attendance/kiosk.js'), 'KioskPage'),
});
const payrollRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/payroll',
  component: lazyRouteComponent(() => import('../routes/payroll/payroll.js'), 'PayrollPage'),
});
const payrollRunRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/payroll/runs/$runId',
  component: lazyRouteComponent(() => import('../routes/payroll/run.js'), 'PayrollRunPage'),
});
const payslipsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/payroll/payslips',
  component: lazyRouteComponent(() => import('../routes/payroll/payslips.js'), 'MyPayslipsPage'),
});
const invoicesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/invoices',
  component: lazyRouteComponent(() => import('../routes/billing/invoices.js'), 'InvoicesPage'),
  validateSearch: searchOf('overdue'),
});
const newInvoiceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/invoices/new',
  component: lazyRouteComponent(() => import('../routes/billing/invoice.js'), 'NewInvoicePage'),
  validateSearch: searchOf('clientId'),
});
const invoiceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/invoices/$invoiceId',
  component: lazyRouteComponent(() => import('../routes/billing/invoice.js'), 'InvoicePage'),
});
/** Print view: outside the app frame so it prints cleanly. */
const invoicePrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices/$invoiceId/print',
  component: lazyRouteComponent(() => import('../routes/billing/print.js'), 'InvoicePrintPage'),
});
const expensesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/expenses',
  component: lazyRouteComponent(() => import('../routes/expenses/expenses.js'), 'ExpensesPage'),
});
const expenseClaimRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/expenses/$claimId',
  component: lazyRouteComponent(() => import('../routes/expenses/claim.js'), 'ExpenseClaimPage'),
});
const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reports',
  component: lazyRouteComponent(() => import('../routes/reports.js'), 'ReportsPage'),
});
const reportRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reports/$reportKey',
  component: lazyRouteComponent(() => import('../routes/reports.js'), 'ReportPage'),
});
const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  component: lazyRouteComponent(() => import('../routes/audit.js'), 'AuditLogPage'),
});
const announcementsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/announcements',
  component: lazyRouteComponent(() => import('../routes/announcements.js'), 'AnnouncementsPage'),
});
const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: lazyRouteComponent(() => import('../routes/account.js'), 'AccountPage'),
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
    contractPrintRoute,
    kioskRoute,
    invoicePrintRoute,
    appRoute.addChildren([
      dashboardRoute,
      membersRoute,
      clientsRoute,
      newClientRoute,
      clientRoute,
      contractsRoute,
      newContractRoute,
      contractTemplatesRoute,
      contractRoute,
      projectsRoute,
      newProjectRoute,
      projectRoute,
      tasksRoute,
      newTaskRoute,
      taskRoute,
      timeRoute,
      timeApprovalsRoute,
      peopleRoute,
      personRoute,
      organisationRoute,
      leaveRoute,
      attendanceRoute,
      attendanceScanRoute,
      payrollRoute,
      payrollRunRoute,
      payslipsRoute,
      invoicesRoute,
      newInvoiceRoute,
      invoiceRoute,
      expensesRoute,
      expenseClaimRoute,
      reportsRoute,
      reportRoute,
      auditRoute,
      announcementsRoute,
      accountRoute,
    ]),
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
