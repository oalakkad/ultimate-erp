import { useQuery } from '@tanstack/react-query';
import { Link, type LinkProps } from '@tanstack/react-router';
import {
  type ActivityItem,
  type DashboardSummary,
  dashboardSummarySchema,
  revenueSchema,
} from '@ultimate-erp/contracts';
import { formatDate, formatMoney, formatNumber } from '@ultimate-erp/i18n';
import {
  BarChart,
  Card,
  DisplayName,
  ErrorState,
  LoadingState,
  Meter,
  StatCard,
  type Tone,
} from '@ultimate-erp/ui';
import {
  AlarmClock,
  Banknote,
  Building2,
  CalendarClock,
  ChevronRight,
  Circle,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Fingerprint,
  FolderKanban,
  HandCoins,
  ListChecks,
  MailPlus,
  Plane,
  UserRound,
  Users,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useI18n } from '../app/i18n.js';
import { api } from '../lib/api.js';
import { Away, MyTasks, MyWeek, ProjectHealth } from './dashboard-sections.js';
import { errorReference, errorText } from '../lib/errors.js';
import { can, useAccess, useMe } from '../lib/session.js';

const ACTION_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame';

type Severity = 'bad' | 'warn' | 'info';
const SEVERITY: Record<Severity, string> = {
  bad: 'bg-blush text-blush-ink',
  warn: 'bg-butter text-butter-ink',
  info: 'bg-lilac text-lilac-ink',
};

interface AttentionItem {
  key: string;
  severity: Severity;
  icon: ReactNode;
  text: string;
  detail?: string;
  link: LinkProps;
}

/**
 * Executive dashboard (brief Module A; design-system.md §6). Three layers, most urgent first:
 * what needs me (only items that are not zero), the few numbers that describe the firm today,
 * and how money moved this year. Every value comes from the summary API, which includes a
 * section only when the person may see it — nothing is estimated.
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
  if (summary.isPending) body = <LoadingState label={t('ui.common.loading')} lines={5} />;
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
    const s = summary.data;
    const steps = s.setup
      ? [
          { label: t('ui.dashboard.stepCompany'), done: true },
          { label: t('ui.dashboard.stepTwoFactor'), done: me.data?.user.twoFactorEnabled ?? false },
          { label: t('ui.dashboard.stepInvite'), done: s.setup.invitationSent },
          { label: t('ui.dashboard.stepJoined'), done: s.setup.colleagueJoined },
        ]
      : [];
    const done = steps.filter((step) => step.done).length;

    body = (
      <div className="grid gap-4">
        <KeyNumbers s={s} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
            <Attention s={s} />
            {s.myWeek && <MyWeek section={s.myWeek} />}
            {s.projectHealth && <ProjectHealth section={s.projectHealth} />}
            {s.billing && <Revenue />}
          </div>

          <div className="grid content-start gap-4">
            {s.myTasks && <MyTasks section={s.myTasks} />}
            {s.away && <Away section={s.away} />}
            {s.setup && done < steps.length && (
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

            {s.activity && (
              <Card title={t('ui.dashboard.activity')}>
                {s.activity.items.length === 0 ? (
                  <p className="text-[13.5px] text-ink-2">{t('ui.dashboard.noActivity')}</p>
                ) : (
                  <ol className="grid gap-3">
                    {s.activity.items.map((item) => (
                      <li key={item.id} className="grid gap-0.5 border-s-2 border-line-2 ps-3">
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
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h1 className="sr-only">{t('ui.dashboard.title')}</h1>
      <Greeting name={me.data?.user.name ?? ''} />
      {body}
    </div>
  );
}

/** The handful of numbers that describe the firm today; each opens its module. */
function KeyNumbers({ s }: { s: DashboardSummary }) {
  const { t, locale } = useI18n();
  const n = (v: number) => formatNumber(locale, v);
  const items: {
    key: string;
    label: string;
    value: string;
    link: LinkProps;
    tone: Tone;
    icon: ReactNode;
    hint?: string | undefined;
  }[] = [];
  if (s.billing)
    items.push({
      key: 'outstanding',
      tone: 'butter',
      icon: <Banknote />,
      hint: s.billing.overdueCount
        ? t('ui.dashboard.hintOverdue', { amount: formatMoney(locale, s.billing.overdue, 'KWD') })
        : undefined,
      label: t('ui.dashboard.outstanding'),
      value: formatMoney(locale, s.billing.outstanding, 'KWD'),
      link: { to: '/invoices' },
    });
  if (s.projects)
    items.push({
      key: 'projects',
      tone: 'mint',
      icon: <FolderKanban />,
      hint: s.projects.endingSoon
        ? t('ui.dashboard.hintEndingSoon', { count: s.projects.endingSoon })
        : undefined,
      label: t('ui.dashboard.activeProjects'),
      value: n(s.projects.active),
      link: { to: '/projects' },
    });
  if (s.clients)
    items.push({
      key: 'clients',
      tone: 'sky',
      icon: <Building2 />,
      hint: s.clients.newThisMonth
        ? t('ui.dashboard.hintNewThisMonth', { count: s.clients.newThisMonth })
        : undefined,
      label: t('ui.dashboard.activeClients'),
      value: n(s.clients.active),
      link: { to: '/clients' },
    });
  if (s.tasks)
    items.push({
      key: 'tasks',
      tone: 'lilac',
      icon: <ListChecks />,
      hint: s.tasks.mineOverdue
        ? t('ui.dashboard.hintOverdueTasks', { count: s.tasks.mineOverdue })
        : undefined,
      label: t('ui.dashboard.myOpenTasks'),
      value: n(s.tasks.mineOpen),
      link: { to: '/tasks', search: { mine: '1' } },
    });
  if (s.time)
    items.push({
      key: 'time',
      tone: 'sky',
      icon: <Clock />,
      label: t('ui.dashboard.hoursThisWeek'),
      value: formatNumber(locale, Number(s.time.thisWeekHours), { maximumFractionDigits: 2 }),
      link: { to: '/time' },
    });
  if (s.attendance)
    items.push({
      key: 'in',
      tone: 'mint',
      icon: <Fingerprint />,
      label: t('ui.dashboard.inNow'),
      value: n(s.attendance.inNow),
      link: { to: '/attendance' },
    });
  if (s.team)
    items.push({
      key: 'team',
      tone: 'lilac',
      icon: <Users />,
      label: t('ui.dashboard.activeMembers'),
      value: n(s.team.activeMembers),
      link: { to: '/members' },
    });
  if (items.length === 0) return null;
  // Four at most, in priority order: a full row reads as a deliberate summary, not a dump.
  const shown = items.slice(0, 4);
  return (
    <section aria-label={t('ui.dashboard.keyNumbers')}>
      <ul className="ui-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {shown.map((item) => (
          <li key={item.key} className="grid">
            <Link {...item.link} className="grid rounded-tile">
              <StatCard
                label={item.label}
                value={item.value}
                tone={item.tone}
                icon={item.icon}
                hint={item.hint}
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One list of things that need a person's action, worst first; empty when all is well. */
function Attention({ s }: { s: DashboardSummary }) {
  const { t, locale } = useI18n();
  const money = (v: string) => formatMoney(locale, v, 'KWD');
  const items: AttentionItem[] = [];
  const add = (
    count: number | null | undefined,
    item: Omit<AttentionItem, 'text'>,
    text: string,
  ) => {
    if (count) items.push({ ...item, text });
  };
  add(
    s.billing?.overdueCount,
    {
      key: 'overdue-invoices',
      severity: 'bad',
      icon: <Banknote />,
      detail: s.billing ? money(s.billing.overdue) : '',
      link: { to: '/invoices', search: { overdue: '1' } },
    },
    t('ui.dashboard.attention.overdueInvoices', { count: s.billing?.overdueCount ?? 0 }),
  );
  add(
    s.tasks?.mineOverdue,
    {
      key: 'my-overdue',
      severity: 'bad',
      icon: <AlarmClock />,
      link: { to: '/tasks', search: { mine: '1' } },
    },
    t('ui.dashboard.attention.myOverdueTasks', { count: s.tasks?.mineOverdue ?? 0 }),
  );
  add(
    s.projects?.overBudget,
    { key: 'over-budget', severity: 'bad', icon: <FolderKanban />, link: { to: '/projects' } },
    t('ui.dashboard.attention.overBudget', { count: s.projects?.overBudget ?? 0 }),
  );
  add(
    s.attendance?.lateToday,
    { key: 'late', severity: 'bad', icon: <Fingerprint />, link: { to: '/attendance' } },
    t('ui.dashboard.attention.lateToday', { count: s.attendance?.lateToday ?? 0 }),
  );
  add(
    s.leave?.waitingForMe,
    {
      key: 'leave',
      severity: 'warn',
      icon: <Plane />,
      link: { to: '/leave', search: { view: 'approvals' } },
    },
    t('ui.dashboard.attention.leaveWaiting', { count: s.leave?.waitingForMe ?? 0 }),
  );
  add(
    s.time?.waitingForMe,
    { key: 'time', severity: 'warn', icon: <ClipboardCheck />, link: { to: '/time/approvals' } },
    t('ui.dashboard.attention.timeWaiting', { count: s.time?.waitingForMe ?? 0 }),
  );
  add(
    s.expenses?.waitingForMe,
    { key: 'claims', severity: 'warn', icon: <HandCoins />, link: { to: '/expenses' } },
    t('ui.dashboard.attention.claimsWaiting', { count: s.expenses?.waitingForMe ?? 0 }),
  );
  add(
    s.expenses?.toReimburse?.count,
    {
      key: 'reimburse',
      severity: 'warn',
      icon: <HandCoins />,
      detail: s.expenses?.toReimburse ? money(s.expenses.toReimburse.amount) : '',
      link: { to: '/expenses' },
    },
    t('ui.dashboard.toReimburse', { count: s.expenses?.toReimburse?.count ?? 0 }),
  );
  add(
    s.tasks?.companyOverdue,
    {
      key: 'company-overdue',
      severity: 'warn',
      icon: <AlarmClock />,
      link: { to: '/tasks', search: { overdue: '1' } },
    },
    t('ui.dashboard.attention.companyOverdue', { count: s.tasks?.companyOverdue ?? 0 }),
  );
  add(
    s.contracts?.expiringSoon,
    {
      key: 'contracts',
      severity: 'warn',
      icon: <CalendarClock />,
      link: { to: '/contracts', search: { expiring: '1' } },
    },
    t('ui.dashboard.attention.contractsEnding', { count: s.contracts?.expiringSoon ?? 0 }),
  );
  add(
    s.projects?.endingSoon,
    { key: 'projects-ending', severity: 'info', icon: <FolderKanban />, link: { to: '/projects' } },
    t('ui.dashboard.attention.projectsEnding', { count: s.projects?.endingSoon ?? 0 }),
  );
  add(
    s.team?.pendingInvitations,
    { key: 'invitations', severity: 'info', icon: <MailPlus />, link: { to: '/members' } },
    t('ui.dashboard.attention.invitations', { count: s.team?.pendingInvitations ?? 0 }),
  );
  add(
    s.leave?.onLeaveToday,
    { key: 'away', severity: 'info', icon: <Plane />, link: { to: '/leave' } },
    t('ui.dashboard.attention.awayToday', { count: s.leave?.onLeaveToday ?? 0 }),
  );

  return (
    <Card title={t('ui.dashboard.attention.title')}>
      {items.length === 0 ? (
        <p className="flex items-center gap-2.5 text-[13.5px] text-ink-2">
          <CircleCheck aria-hidden className="size-[18px] text-mint-ink" />
          {t('ui.dashboard.attention.clear')}
        </p>
      ) : (
        <ul className="ui-stagger -mx-2 grid">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                {...item.link}
                className="group flex items-center gap-3 rounded-ctl px-2 py-2.5 hover:bg-frame"
              >
                <span
                  aria-hidden
                  className={`grid size-8 shrink-0 place-items-center rounded-[10px] [&_svg]:size-4 ${SEVERITY[item.severity]}`}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{item.text}</span>
                {item.detail && (
                  <span className="num text-[13.5px] font-bold text-ink">{item.detail}</span>
                )}
                <ChevronRight
                  aria-hidden
                  className="mirror size-4 text-ink-3 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Invoiced vs received by month this year, up to the current month (invoice readers). */
function Revenue() {
  const { t, locale } = useI18n();
  const year = new Date().getFullYear();
  const revenue = useQuery({
    queryKey: ['billing', 'revenue', year],
    queryFn: () => api(`/billing/revenue?year=${year}`, { schema: revenueSchema }),
  });
  if (!revenue.data) return null;
  const thisMonth = new Date().getMonth();
  const months = revenue.data.months.slice(0, thisMonth + 1);
  if (!months.some((m) => Number(m.invoiced) > 0 || Number(m.received) > 0)) return null;
  return (
    <Card>
      <BarChart
        title={t('ui.dashboard.revenueTitle', { year: String(year) })}
        description={t('ui.dashboard.revenueBody', {
          invoiced: formatMoney(locale, revenue.data.totals.invoiced, 'KWD'),
          received: formatMoney(locale, revenue.data.totals.received, 'KWD'),
        })}
        series={[
          { key: 'invoiced', label: t('ui.dashboard.seriesInvoiced') },
          { key: 'received', label: t('ui.dashboard.seriesReceived') },
        ]}
        // Plotting needs numbers; amounts are KWD with 3 decimals, exact well inside 2^53.
        data={months.map((m) => ({
          label: formatDate(locale, new Date(`${m.month}-01T12:00:00Z`), { month: 'short' }),
          values: { invoiced: Number(m.invoiced), received: Number(m.received) },
        }))}
        format={(v) => formatMoney(locale, v.toFixed(3), 'KWD')}
        formatTick={(v) => formatNumber(locale, v, { notation: 'compact' })}
        highlight={t('ui.dashboard.bestMonth')}
        showTableLabel={t('ui.common.showTable')}
        showChartLabel={t('ui.common.showChart')}
      />
    </Card>
  );
}

/** "Good afternoon," + the person's first name in the display face, and today's date. */
function Greeting({ name }: { name: string }) {
  const { t, locale } = useI18n();
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12
      ? t('ui.shell.greetingMorning')
      : hour < 17
        ? t('ui.shell.greetingAfternoon')
        : t('ui.shell.greetingEvening');
  const first = name.trim();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
      <div className="grid gap-0.5">
        <span className="text-[15px] font-medium text-ink-2">{greeting}</span>
        {first && <DisplayName>{first}</DisplayName>}
      </div>
      <p className="ui-glass rounded-full px-4 py-2 text-[13px] font-semibold text-ink-2">
        {formatDate(locale, now, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </p>
    </div>
  );
}
