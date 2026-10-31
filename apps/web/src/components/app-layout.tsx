import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import {
  clientListResponseSchema,
  memberListResponseSchema,
  okResponseSchema,
} from '@ultimate-erp/contracts';
import {
  AppFrame,
  Avatar,
  Button,
  Drawer,
  ErrorState,
  IconButton,
  LoadingState,
  Logo,
  Menu,
  NavGroup,
  NavItem,
  ProfileCard,
  SearchBox,
  Sidebar,
  Topbar,
} from '@ultimate-erp/ui';
import {
  Briefcase,
  Building2,
  FileSignature,
  FolderKanban,
  ListChecks,
  Clock,
  ClipboardCheck,
  Contact,
  Plane,
  Fingerprint,
  Megaphone,
  HandCoins,
  ChartColumn,
  ScrollText,
  Wallet,
  ReceiptText,
  FileText as InvoiceIcon,
  ChevronsUpDown,
  LayoutGrid,
  LogOut,
  MenuIcon,
  UserRound,
  Users,
} from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch, ThemeSwitch, useChangeLocale } from '../app/switches.js';
import { api } from '../lib/api.js';
import { type Command } from '../lib/commands.js';
import { errorReference, errorText } from '../lib/errors.js';
import { mainAppUrl, openCompany } from '../lib/handoff.js';
import { can, canAny, useAccess, useMe, useMyCompanies, useTenant } from '../lib/session.js';
import { CommandPalette } from './command-palette.js';
import { NotificationBell } from './notification-bell.js';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

/** Key names are the same in every language; Apple keyboards show ⌘ instead of Ctrl. */
const SHORTCUT_LABEL = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘ K' : 'Ctrl K';

/**
 * Leaves this page exactly once (replace, so Back does not return here). Used instead of the
 * router's <Navigate> inside this layout, which re-fired on every render while the layout's own
 * queries settled and could loop ("Maximum update depth exceeded" on the signed-out home page).
 */
function RedirectOnce({ href }: { href: string }) {
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void navigate({ href, replace: true });
  }, [navigate, href]);
  return null;
}

/** A plain left click (not ctrl/⌘/shift/middle — those open a new tab, which the href handles). */
const isPlainClick = (e: MouseEvent) =>
  !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * The signed-in company app. Requires: a company address, a session, membership. Sensitive
 * roles without two-factor are sent to the security page (the server also refuses everything
 * else with MFA_REQUIRED). The sidebar lists only modules that exist (owner decision).
 * On phones the sidebar becomes a drawer behind a menu button.
 */
export function AppLayout() {
  const { t, locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const changeLocale = useChangeLocale();
  const tenant = useTenant();
  const me = useMe();
  const access = useAccess(Boolean(tenant.data && me.data));
  const ready = Boolean(access.data && !access.data.twoFactorRequired);
  const companies = useMyCompanies(ready);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const canReadMembers = can(access.data, 'access.members.read');
  const canReadClients = can(access.data, 'clients.client.read');
  const canReadContracts = can(access.data, 'contracts.contract.read');
  // Team leaders and employees see the projects they work on.
  const canReadProjects = canAny(access.data, 'projects.project.read');
  const canReadTasks = canAny(access.data, 'tasks.task.read');
  const canLogTime = canAny(access.data, 'time.entry.create');
  const canApproveTime = canAny(access.data, 'time.timesheet.approve');
  const canReadPeople = canAny(access.data, 'people.employee.read');
  const canLeave = canAny(access.data, 'leave.request.create');
  const canAttend = canAny(access.data, 'attendance.check');
  const payrollStaff =
    can(access.data, 'payroll.run.prepare') ||
    can(access.data, 'payroll.run.approve') ||
    can(access.data, 'payroll.payslip.read');
  const canPayslips = canAny(access.data, 'payroll.payslip.read');
  const canInvoices = canAny(access.data, 'billing.invoice.read');
  const canExpenses = canAny(access.data, 'expenses.claim.create');
  // Navigation hint only — the server decides which reports and rows each person gets.
  const canReports =
    [
      'clients.client.read',
      'billing.invoice.read',
      'projects.project.read',
      'tasks.task.read',
      'payroll.run.prepare',
      'payroll.run.approve',
    ].some((p) => can(access.data, p)) ||
    ['people.employee.read', 'attendance.read', 'leave.request.read', 'time.entry.read'].some((p) =>
      (access.data?.permissions[p] ?? []).some((s) => s !== 'own'),
    );
  const canAudit = can(access.data, 'audit.event.read');
  // Recent clients for the palette (its text filter then narrows them).
  const recentClients = useQuery({
    queryKey: ['clients', 'palette'],
    enabled: paletteOpen && ready && canReadClients,
    queryFn: () =>
      api('/clients?sort=updated&dir=desc&limit=50', { schema: clientListResponseSchema }),
  });
  const people = useQuery({
    queryKey: ['members'],
    enabled: paletteOpen && ready && canReadMembers,
    queryFn: () => api('/members', { schema: memberListResponseSchema }),
  });
  const signOut = useMutation({
    mutationFn: () => api('/auth/sign-out', { method: 'POST', schema: okResponseSchema }),
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: '/sign-in' });
    },
  });

  // Ctrl K / ⌘ K opens the palette from anywhere in the app.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [ready]);

  const go = (href: string) => {
    setMenuOpen(false);
    void navigate({ href });
  };
  const link = (href: string) => ({
    href,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(e)) return;
      e.preventDefault();
      go(href);
    },
  });

  const commands = useMemo<Command[]>(() => {
    if (!access.data || !me.data) return [];
    const list: Command[] = [
      {
        id: 'page:dashboard',
        group: 'pages',
        label: t('ui.shell.dashboard'),
        run: () => {
          go('/');
        },
      },
      {
        id: 'page:account',
        group: 'pages',
        label: t('ui.shell.myAccount'),
        run: () => {
          go('/account');
        },
      },
    ];
    if (canReadMembers) {
      list.push({
        id: 'page:members',
        group: 'pages',
        label: t('ui.shell.members'),
        run: () => {
          go('/members');
        },
      });
    }
    if (canReadContracts) {
      list.push({
        id: 'page:contracts',
        group: 'pages',
        label: t('ui.shell.contracts'),
        run: () => {
          go('/contracts');
        },
      });
    }
    if (canReadProjects) {
      list.push({
        id: 'page:projects',
        group: 'pages',
        label: t('ui.shell.projects'),
        run: () => {
          go('/projects');
        },
      });
    }
    if (canReadTasks) {
      list.push({
        id: 'page:tasks',
        group: 'pages',
        label: t('ui.shell.tasks'),
        run: () => {
          go('/tasks');
        },
      });
    }
    if (canReadPeople) {
      list.push({
        id: 'page:people',
        group: 'pages',
        label: t('ui.shell.people'),
        run: () => {
          go('/people');
        },
      });
      list.push({
        id: 'page:organisation',
        group: 'pages',
        label: t('ui.people.organisation'),
        run: () => {
          go('/organisation');
        },
      });
    }
    list.push({
      id: 'page:announcements',
      group: 'pages',
      label: t('ui.shell.announcements'),
      run: () => {
        go('/announcements');
      },
    });
    if (canReports) {
      list.push({
        id: 'page:reports',
        group: 'pages',
        label: t('ui.shell.reports'),
        run: () => {
          go('/reports');
        },
      });
    }
    if (canAudit) {
      list.push({
        id: 'page:audit',
        group: 'pages',
        label: t('ui.shell.auditLog'),
        run: () => {
          go('/audit');
        },
      });
    }
    if (canExpenses) {
      list.push({
        id: 'page:expenses',
        group: 'pages',
        label: t('ui.shell.expenses'),
        run: () => {
          go('/expenses');
        },
      });
    }
    if (canInvoices) {
      list.push({
        id: 'page:invoices',
        group: 'pages',
        label: t('ui.shell.invoices'),
        run: () => {
          go('/invoices');
        },
      });
    }
    if (can(access.data, 'billing.invoice.issue')) {
      list.push({
        id: 'action:new-invoice',
        group: 'actions',
        label: t('ui.billing.new'),
        run: () => {
          go('/invoices/new');
        },
      });
    }
    if (payrollStaff) {
      list.push({
        id: 'page:payroll',
        group: 'pages',
        label: t('ui.shell.payroll'),
        run: () => {
          go('/payroll');
        },
      });
    }
    if (canPayslips) {
      list.push({
        id: 'page:payslips',
        group: 'pages',
        label: t('ui.shell.payslips'),
        run: () => {
          go('/payroll/payslips');
        },
      });
    }
    if (canAttend) {
      list.push({
        id: 'page:attendance',
        group: 'pages',
        label: t('ui.shell.attendance'),
        run: () => {
          go('/attendance');
        },
      });
    }
    if (canLeave) {
      list.push({
        id: 'page:leave',
        group: 'pages',
        label: t('ui.shell.leave'),
        run: () => {
          go('/leave');
        },
      });
    }
    if (canLogTime) {
      list.push({
        id: 'page:time',
        group: 'pages',
        label: t('ui.shell.time'),
        run: () => {
          go('/time');
        },
      });
    }
    if (canApproveTime) {
      list.push({
        id: 'page:time-approvals',
        group: 'pages',
        label: t('ui.shell.timeApprovals'),
        run: () => {
          go('/time/approvals');
        },
      });
    }
    if (canAny(access.data, 'tasks.task.manage')) {
      list.push({
        id: 'action:new-task',
        group: 'actions',
        label: t('ui.tasks.new'),
        run: () => {
          go('/tasks/new');
        },
      });
    }
    if (can(access.data, 'projects.project.create')) {
      list.push({
        id: 'action:new-project',
        group: 'actions',
        label: t('ui.projects.new'),
        run: () => {
          go('/projects/new');
        },
      });
    }
    if (can(access.data, 'contracts.contract.manage')) {
      list.push({
        id: 'action:new-contract',
        group: 'actions',
        label: t('ui.contracts.new'),
        run: () => {
          go('/contracts/new');
        },
      });
    }
    if (canReadClients) {
      list.push({
        id: 'page:clients',
        group: 'pages',
        label: t('ui.shell.clients'),
        run: () => {
          go('/clients');
        },
      });
    }
    if (can(access.data, 'clients.client.create')) {
      list.push({
        id: 'action:new-client',
        group: 'actions',
        label: t('ui.clients.new'),
        run: () => {
          go('/clients/new');
        },
      });
    }
    for (const c of recentClients.data?.items ?? []) {
      list.push({
        id: `client:${c.id}`,
        group: 'members',
        label: locale === 'ar' ? c.legalName.ar : c.legalName.en,
        hint: c.number,
        keywords: [c.legalName.en, c.legalName.ar, c.commercialRegistration ?? ''],
        run: () => {
          go(`/clients/${c.id}`);
        },
      });
    }
    if (can(access.data, 'access.members.invite')) {
      list.push({
        id: 'action:invite',
        group: 'actions',
        label: t('ui.palette.inviteColleague'),
        run: () => {
          go('/members?invite=1');
        },
      });
    }
    if (!me.data.user.twoFactorEnabled) {
      list.push({
        id: 'action:2fa',
        group: 'actions',
        label: t('ui.palette.setUpTwoFactor'),
        run: () => {
          go('/account#security');
        },
      });
    }
    const other = locale === 'ar' ? 'en' : 'ar';
    list.push(
      {
        id: 'action:password',
        group: 'actions',
        label: t('ui.palette.changePassword'),
        run: () => {
          go('/account#password');
        },
      },
      {
        id: 'action:language',
        group: 'actions',
        label: t('ui.palette.switchLanguage', {
          language: other === 'ar' ? t('ui.common.arabic') : t('ui.common.english'),
        }),
        keywords: ['language', 'لغة', 'english', 'عربي'],
        run: () => {
          changeLocale(other);
        },
      },
      {
        id: 'action:sign-out',
        group: 'actions',
        label: t('ui.palette.signOut'),
        run: () => {
          signOut.mutate();
        },
      },
    );
    for (const member of people.data?.members ?? []) {
      list.push({
        id: `member:${member.membershipId}`,
        group: 'members',
        label: member.name,
        hint: member.email,
        run: () => {
          go('/members');
        },
      });
    }
    return list;
    // `go`, `changeLocale` and `signOut` are stable in behaviour; recompute on data/language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    access.data,
    me.data,
    people.data,
    recentClients.data,
    locale,
    canReadMembers,
    canReadClients,
    canReadContracts,
    canReadProjects,
    canReadTasks,
    canLogTime,
    canApproveTime,
    canReadPeople,
    canLeave,
    canAttend,
    payrollStaff,
    canPayslips,
    canInvoices,
    canExpenses,
    canReports,
    canAudit,
  ]);

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
  if (!tenant.data) return <RedirectOnce href={me.data ? '/companies' : '/sign-in'} />;
  if (!me.data)
    return <RedirectOnce href={`/sign-in?returnTo=${encodeURIComponent(location.pathname)}`} />;
  if (!access.data) return <RedirectOnce href="/sign-in" />;
  if (access.data.twoFactorRequired && location.pathname !== '/account') {
    return <RedirectOnce href="/account" />;
  }

  const user = me.data.user;
  const tenantId = access.data.tenantId;
  const company = locale === 'ar' ? tenant.data.name.ar : tenant.data.name.en;
  const path = location.pathname;

  const switcher = (
    <Menu
      label={t('ui.shell.switchCompany')}
      trigger={
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-ctl text-start hover:bg-frame"
        >
          <Logo subtitle={company} />
          {/* Spoken after the visible text, so the accessible name still contains it. */}
          <span className="sr-only">{t('ui.shell.switchCompany')}</span>
          <ChevronsUpDown aria-hidden className="ms-auto size-4 shrink-0 text-ink-3" />
        </button>
      }
      items={(companies.data?.companies ?? []).map((c) => ({
        key: c.tenantId,
        label: locale === 'ar' ? c.name.ar : c.name.en,
        hint: c.url.replace(/^https?:\/\//, ''),
        icon: <Building2 aria-hidden />,
        current: c.tenantId === tenantId,
        onSelect: () => {
          if (c.tenantId !== tenantId) void openCompany(c.tenantId);
        },
      }))}
      footer={[
        {
          key: 'all',
          label: t('ui.shell.allCompanies'),
          onSelect: () => {
            window.location.assign(`${mainAppUrl()}/companies`);
          },
        },
      ]}
    />
  );

  const navigation = (
    <>
      <NavGroup title={t('ui.shell.groupMain')}>
        <NavItem
          {...link('/')}
          icon={<LayoutGrid aria-hidden />}
          label={t('ui.shell.dashboard')}
          current={path === '/'}
        />
        <NavItem
          {...link('/announcements')}
          icon={<Megaphone aria-hidden />}
          label={t('ui.shell.announcements')}
          current={path === '/announcements'}
        />
      </NavGroup>
      {(canReadClients ||
        canReadContracts ||
        canReadProjects ||
        canReadTasks ||
        canLogTime ||
        canApproveTime) && (
        <NavGroup title={t('ui.shell.groupWork')}>
          {canReadClients && (
            <NavItem
              {...link('/clients')}
              icon={<Briefcase aria-hidden />}
              label={t('ui.shell.clients')}
              current={path.startsWith('/clients')}
            />
          )}
          {canReadContracts && (
            <NavItem
              {...link('/contracts')}
              icon={<FileSignature aria-hidden />}
              label={t('ui.shell.contracts')}
              current={path.startsWith('/contracts')}
            />
          )}
          {canReadProjects && (
            <NavItem
              {...link('/projects')}
              icon={<FolderKanban aria-hidden />}
              label={t('ui.shell.projects')}
              current={path.startsWith('/projects')}
            />
          )}
          {canReadTasks && (
            <NavItem
              {...link('/tasks')}
              icon={<ListChecks aria-hidden />}
              label={t('ui.shell.tasks')}
              current={path.startsWith('/tasks')}
            />
          )}
          {canLogTime && (
            <NavItem
              {...link('/time')}
              icon={<Clock aria-hidden />}
              label={t('ui.shell.time')}
              current={path === '/time'}
            />
          )}
          {canApproveTime && (
            <NavItem
              {...link('/time/approvals')}
              icon={<ClipboardCheck aria-hidden />}
              label={t('ui.shell.timeApprovals')}
              current={path === '/time/approvals'}
            />
          )}
        </NavGroup>
      )}
      {(canReadPeople || canLeave || canAttend || canReadMembers) && (
        <NavGroup title={t('ui.shell.groupPeople')}>
          {canReadPeople && (
            <NavItem
              {...link('/people')}
              icon={<Contact aria-hidden />}
              label={t('ui.shell.people')}
              current={path.startsWith('/people') || path === '/organisation'}
            />
          )}
          {canLeave && (
            <NavItem
              {...link('/leave')}
              icon={<Plane aria-hidden />}
              label={t('ui.shell.leave')}
              current={path === '/leave'}
            />
          )}
          {canAttend && (
            <NavItem
              {...link('/attendance')}
              icon={<Fingerprint aria-hidden />}
              label={t('ui.shell.attendance')}
              current={path.startsWith('/attendance')}
            />
          )}
          {canReadMembers && (
            <NavItem
              {...link('/members')}
              icon={<Users aria-hidden />}
              label={t('ui.shell.members')}
              current={path === '/members'}
            />
          )}
        </NavGroup>
      )}
      {(canInvoices || canExpenses || payrollStaff || canPayslips) && (
        <NavGroup title={t('ui.shell.groupFinance')}>
          {canInvoices && (
            <NavItem
              {...link('/invoices')}
              icon={<InvoiceIcon aria-hidden />}
              label={t('ui.shell.invoices')}
              current={path.startsWith('/invoices')}
            />
          )}
          {canExpenses && (
            <NavItem
              {...link('/expenses')}
              icon={<HandCoins aria-hidden />}
              label={t('ui.shell.expenses')}
              current={path.startsWith('/expenses')}
            />
          )}
          {payrollStaff && (
            <NavItem
              {...link('/payroll')}
              icon={<Wallet aria-hidden />}
              label={t('ui.shell.payroll')}
              current={path === '/payroll' || path.startsWith('/payroll/runs')}
            />
          )}
          {canPayslips && (
            <NavItem
              {...link('/payroll/payslips')}
              icon={<ReceiptText aria-hidden />}
              label={t('ui.shell.payslips')}
              current={path === '/payroll/payslips'}
            />
          )}
        </NavGroup>
      )}
      {(canReports || canAudit) && (
        <NavGroup title={t('ui.shell.groupInsights')}>
          {canReports && (
            <NavItem
              {...link('/reports')}
              icon={<ChartColumn aria-hidden />}
              label={t('ui.shell.reports')}
              current={path.startsWith('/reports')}
            />
          )}
          {canAudit && (
            <NavItem
              {...link('/audit')}
              icon={<ScrollText aria-hidden />}
              label={t('ui.shell.auditLog')}
              current={path === '/audit'}
            />
          )}
        </NavGroup>
      )}
    </>
  );
  const accountLink = (
    <NavItem
      {...link('/account')}
      icon={<UserRound aria-hidden />}
      label={t('ui.shell.myAccount')}
      current={path === '/account'}
    />
  );
  const profile = (
    <ProfileCard
      avatar={<Avatar name={user.name} initials={initialsOf(user.name)} size={48} />}
      name={user.name}
      subtitle={access.data.roles.map((role) => t(`roles.${role}`)).join(' · ')}
    />
  );

  return (
    <div className="min-h-screen p-3 md:p-4">
      <AppFrame
        sidebar={
          <Sidebar
            label={t('ui.shell.mainNavigation')}
            header={ready ? switcher : <Logo subtitle={company} />}
            profile={profile}
            footer={accountLink}
          >
            {navigation}
          </Sidebar>
        }
      >
        <Topbar
          search={
            <>
              <Drawer
                side="start"
                open={menuOpen}
                onOpenChange={setMenuOpen}
                trigger={
                  <IconButton label={t('ui.shell.openMenu')} className="md:hidden">
                    <MenuIcon aria-hidden />
                  </IconButton>
                }
                title={company}
                closeLabel={t('ui.common.close')}
              >
                {profile}
                <nav aria-label={t('ui.shell.mainNavigation')} className="grid gap-3.5">
                  {navigation}
                  {accountLink}
                </nav>
              </Drawer>
              {ready && (
                <SearchBox
                  label={t('ui.shell.search')}
                  shortcut={SHORTCUT_LABEL}
                  onClick={() => {
                    setPaletteOpen(true);
                  }}
                />
              )}
            </>
          }
          actions={
            <>
              {/* Hidden until two-factor is set up: the server refuses it with MFA_REQUIRED. */}
              {ready && <NotificationBell />}
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
      {ready && (
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      )}
    </div>
  );
}
