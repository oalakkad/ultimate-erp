import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ActivityItem, dashboardSummarySchema } from '@ultimate-erp/contracts';
import { formatDate, formatMoney, formatNumber } from '@ultimate-erp/i18n';
import { Card, ErrorState, LoadingState, Meter, Tile } from '@ultimate-erp/ui';
import {
  Briefcase,
  CalendarClock,
  CircleCheck,
  FileSignature,
  FolderKanban,
  ListChecks,
  Clock,
  Plane,
  Fingerprint,
  Banknote,
  HandCoins,
  ClipboardCheck,
  AlarmClock,
  Circle,
  Hourglass,
  MailPlus,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useI18n } from '../app/i18n.js';
import { AppPageHeader } from '../components/page-header.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { can, useAccess, useMe } from '../lib/session.js';

const ACTION_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame';

/**
 * Executive dashboard (brief Module A). Only real numbers: every card comes from the summary
 * API, which includes a section only when the person may see it. Modules add cards as they
 * are delivered; until then the "company is ready" card says so honestly.
 */
export function DashboardPage() {
  const { t, locale } = useI18n();
  const access = useAccess(true);
  const me = useMe();
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api('/dashboard/summary', { schema: dashboardSummarySchema }),
  });
  const canInvite = can(access.data, 'access.members.invite');
  const canReadMembers = can(access.data, 'access.members.read');

  const activityText = (item: ActivityItem) =>
    t(`ui.dashboard.activityText.${item.action.replace(/\./g, '_') as 'access_company_created'}`, {
      actor: item.actorName ?? t('ui.dashboard.system'),
    });

  let body: ReactNode;
  if (summary.isPending) body = <LoadingState label={t('ui.common.loading')} />;
  else if (summary.isError) {
    body = (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, summary.error)}
        reference={errorReference(t, summary.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void summary.refetch()}
      />
    );
  } else {
    const {
      setup,
      team,
      clients,
      contracts,
      projects,
      tasks,
      time,
      leave,
      attendance,
      billing,
      expenses,
      activity,
    } = summary.data;
    const steps = setup
      ? [
          { label: t('ui.dashboard.stepCompany'), done: true },
          { label: t('ui.dashboard.stepTwoFactor'), done: me.data?.user.twoFactorEnabled ?? false },
          { label: t('ui.dashboard.stepInvite'), done: setup.invitationSent },
          { label: t('ui.dashboard.stepJoined'), done: setup.colleagueJoined },
        ]
      : [];
    const done = steps.filter((s) => s.done).length;

    body = (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          {setup && done < steps.length && (
            <Card title={t('ui.dashboard.gettingStarted')}>
              <div className="grid gap-1.5">
                <small className="text-ink-2">
                  {t('ui.dashboard.progress', { done, total: steps.length })}
                </small>
                <Meter label={t('ui.dashboard.gettingStarted')} value={done} max={steps.length} />
              </div>
              <ul className="grid gap-2">
                {steps.map((step) => (
                  <li key={step.label} className="flex items-center gap-2.5 text-[13.5px]">
                    {step.done ? (
                      <CircleCheck aria-hidden className="size-[18px] text-mint-ink" />
                    ) : (
                      <Circle aria-hidden className="size-[18px] text-ink-3" />
                    )}
                    <span className={step.done ? 'text-ink-2 line-through' : 'font-semibold'}>
                      {step.label}
                    </span>
                    {step.done && <span className="sr-only">{t('ui.dashboard.stepDone')}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {billing && (
            <Card
              title={t('ui.dashboard.billing')}
              action={
                <Link
                  to="/invoices"
                  className="text-[13px] font-semibold text-plum hover:underline"
                >
                  {t('ui.shell.invoices')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="sky"
                  label={t('ui.dashboard.outstanding')}
                  value={formatMoney(locale, billing.outstanding, 'KWD')}
                  icon={<Banknote />}
                />
                <Link
                  to="/invoices"
                  search={{ overdue: '1' }}
                  className="rounded-tile focus-visible:outline-2"
                >
                  <Tile
                    tone="blush"
                    label={t('ui.dashboard.overdueInvoices', { count: billing.overdueCount })}
                    value={formatMoney(locale, billing.overdue, 'KWD')}
                    icon={<Banknote />}
                  />
                </Link>
              </div>
            </Card>
          )}

          {expenses &&
          (expenses.mineOpen > 0 || expenses.waitingForMe || expenses.toReimburse?.count) ? (
            <Card
              title={t('ui.dashboard.expenses')}
              action={
                <Link
                  to="/expenses"
                  className="text-[13px] font-semibold text-plum hover:underline"
                >
                  {t('ui.shell.expenses')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Tile
                  tone="lilac"
                  label={t('ui.dashboard.myOpenClaims')}
                  value={formatNumber(locale, expenses.mineOpen)}
                  icon={<HandCoins />}
                />
                {expenses.waitingForMe !== null && (
                  <Tile
                    tone="butter"
                    label={t('ui.dashboard.claimsWaiting')}
                    value={formatNumber(locale, expenses.waitingForMe)}
                    icon={<HandCoins />}
                  />
                )}
                {expenses.toReimburse && (
                  <Tile
                    tone="mint"
                    label={t('ui.dashboard.toReimburse', { count: expenses.toReimburse.count })}
                    value={formatMoney(locale, expenses.toReimburse.amount, 'KWD')}
                    icon={<Banknote />}
                  />
                )}
              </div>
            </Card>
          ) : null}

          {attendance && (
            <Card
              title={t('ui.dashboard.attendance')}
              action={
                <Link
                  to="/attendance"
                  className="text-[13px] font-semibold text-plum hover:underline"
                >
                  {t('ui.shell.attendance')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="mint"
                  label={t('ui.dashboard.inNow')}
                  value={formatNumber(locale, attendance.inNow)}
                  icon={<Fingerprint />}
                />
                <Tile
                  tone="blush"
                  label={t('ui.dashboard.lateToday')}
                  value={formatNumber(locale, attendance.lateToday)}
                  icon={<Fingerprint />}
                />
              </div>
            </Card>
          )}

          {leave && (
            <Card
              title={t('ui.dashboard.leave')}
              action={
                <Link to="/leave" className="text-[13px] font-semibold text-plum hover:underline">
                  {t('ui.shell.leave')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="sky"
                  label={t('ui.dashboard.onLeaveToday')}
                  value={formatNumber(locale, leave.onLeaveToday)}
                  icon={<Plane />}
                />
                {leave.waitingForMe !== null && (
                  <Link
                    to="/leave"
                    search={{ view: 'approvals' }}
                    className="rounded-tile focus-visible:outline-2"
                  >
                    <Tile
                      tone="butter"
                      label={t('ui.dashboard.leaveWaiting')}
                      value={formatNumber(locale, leave.waitingForMe)}
                      icon={<Plane />}
                    />
                  </Link>
                )}
              </div>
            </Card>
          )}

          {time && (
            <Card
              title={t('ui.dashboard.time')}
              action={
                <Link to="/time" className="text-[13px] font-semibold text-plum hover:underline">
                  {t('ui.shell.time')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="mint"
                  label={t('ui.dashboard.hoursThisWeek')}
                  value={formatNumber(locale, Number(time.thisWeekHours), {
                    maximumFractionDigits: 2,
                  })}
                  icon={<Clock />}
                />
                {time.waitingForMe !== null && (
                  <Link to="/time/approvals" className="rounded-tile focus-visible:outline-2">
                    <Tile
                      tone="lilac"
                      label={t('ui.dashboard.waitingApproval')}
                      value={formatNumber(locale, time.waitingForMe)}
                      icon={<ClipboardCheck />}
                    />
                  </Link>
                )}
              </div>
            </Card>
          )}

          {tasks && (
            <Card
              title={t('ui.dashboard.tasks')}
              action={
                <Link
                  to="/tasks"
                  search={{ mine: '1' }}
                  className="text-[13px] font-semibold text-plum hover:underline"
                >
                  {t('ui.dashboard.myTasks')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Tile
                  tone="sky"
                  label={t('ui.dashboard.myOpenTasks')}
                  value={formatNumber(locale, tasks.mineOpen)}
                  icon={<ListChecks />}
                />
                <Tile
                  tone="blush"
                  label={t('ui.dashboard.myOverdueTasks')}
                  value={formatNumber(locale, tasks.mineOverdue)}
                  icon={<AlarmClock />}
                />
                {tasks.companyOverdue !== null && (
                  <Link
                    to="/tasks"
                    search={{ overdue: '1' }}
                    className="rounded-tile focus-visible:outline-2"
                  >
                    <Tile
                      tone="butter"
                      label={t('ui.dashboard.companyOverdueTasks')}
                      value={formatNumber(locale, tasks.companyOverdue)}
                      icon={<AlarmClock />}
                    />
                  </Link>
                )}
              </div>
            </Card>
          )}

          {projects && (
            <Card
              title={t('ui.dashboard.projects')}
              action={
                <Link
                  to="/projects"
                  className="text-[13px] font-semibold text-plum hover:underline"
                >
                  {t('ui.projects.title')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="lilac"
                  label={t('ui.dashboard.activeProjects')}
                  value={formatNumber(locale, projects.active)}
                  icon={<FolderKanban />}
                />
                <Tile
                  tone="butter"
                  label={t('ui.dashboard.endingProjects')}
                  value={formatNumber(locale, projects.endingSoon)}
                  icon={<Hourglass />}
                />
              </div>
            </Card>
          )}

          {contracts && (
            <Card
              title={t('ui.dashboard.contracts')}
              action={
                <Link
                  to="/contracts"
                  className="text-[13px] font-semibold text-plum hover:underline"
                >
                  {t('ui.contracts.title')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="sky"
                  label={t('ui.dashboard.activeContracts')}
                  value={formatNumber(locale, contracts.active)}
                  icon={<FileSignature />}
                />
                <Link
                  to="/contracts"
                  search={{ expiring: '1' }}
                  className="rounded-tile focus-visible:outline-2"
                >
                  <Tile
                    tone="butter"
                    label={t('ui.dashboard.expiringContracts')}
                    value={formatNumber(locale, contracts.expiringSoon)}
                    icon={<CalendarClock />}
                  />
                </Link>
              </div>
            </Card>
          )}

          {clients && (
            <Card
              title={t('ui.dashboard.clients')}
              action={
                <Link to="/clients" className="text-[13px] font-semibold text-plum hover:underline">
                  {t('ui.clients.title')}
                </Link>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="mint"
                  label={t('ui.dashboard.activeClients')}
                  value={formatNumber(locale, clients.active)}
                  icon={<Briefcase />}
                />
                <Tile
                  tone="lilac"
                  label={t('ui.dashboard.newClients')}
                  value={formatNumber(locale, clients.newThisMonth)}
                  icon={<Sparkles />}
                />
              </div>
            </Card>
          )}

          {team && (
            <Card title={t('ui.dashboard.team')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Tile
                  tone="sky"
                  label={t('ui.dashboard.activeMembers')}
                  value={formatNumber(locale, team.activeMembers)}
                  icon={<Users />}
                />
                {team.pendingInvitations !== null && (
                  <Tile
                    tone="butter"
                    label={t('ui.dashboard.pendingInvitations')}
                    value={formatNumber(locale, team.pendingInvitations)}
                    icon={<MailPlus />}
                  />
                )}
              </div>
            </Card>
          )}

          <Card>
            <div className="grid gap-1">
              <b className="text-[15px]">{t('ui.dashboard.emptyTitle')}</b>
              <p className="text-[13.5px] text-ink-2">{t('ui.dashboard.emptyBody')}</p>
            </div>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title={t('ui.dashboard.quickActions')}>
            <div className="flex flex-wrap gap-2">
              {canInvite && (
                <Link to="/members" search={{ invite: '1' }} className={ACTION_LINK}>
                  <MailPlus aria-hidden className="size-4" />
                  {t('ui.dashboard.inviteCta')}
                </Link>
              )}
              {canReadMembers && (
                <Link to="/members" className={ACTION_LINK}>
                  <Users aria-hidden className="size-4" />
                  {t('ui.dashboard.actionMembers')}
                </Link>
              )}
              <Link to="/account" className={ACTION_LINK}>
                <UserRound aria-hidden className="size-4" />
                {t('ui.dashboard.actionAccount')}
              </Link>
            </div>
          </Card>

          {activity && (
            <Card title={t('ui.dashboard.activity')}>
              {activity.items.length === 0 ? (
                <p className="text-[13.5px] text-ink-2">{t('ui.dashboard.noActivity')}</p>
              ) : (
                <ol className="grid gap-3">
                  {activity.items.map((item) => (
                    <li key={item.id} className="grid gap-0.5 border-s-2 border-lilac ps-3">
                      <span className="text-[13.5px]">{activityText(item)}</span>
                      <small className="text-ink-3">
                        {formatDate(locale, new Date(item.occurredAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </small>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.dashboard.title')} home={false} />
      {body}
    </div>
  );
}
