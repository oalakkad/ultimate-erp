import { Link } from '@tanstack/react-router';
import { type DashboardSummary } from '@ultimate-erp/contracts';
import { formatDate, formatNumber, type Locale } from '@ultimate-erp/i18n';
import { Avatar, Card } from '@ultimate-erp/ui';
import { AlarmClock, CalendarDays, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../app/i18n.js';

/*
 * Dashboard sections that list real things (docs/modules/shell-dashboard.md §4): my next tasks,
 * my week, project budgets and who is away. Each renders only when the summary includes it —
 * the server decides who may see what. Design: design-system.md v0.4 (liquid glass).
 */

const day = (locale: Locale, iso: string, options: Intl.DateTimeFormatOptions) =>
  formatDate(locale, new Date(`${iso}T12:00:00Z`), { timeZone: 'UTC', ...options });

const hours = (locale: Locale, value: string | number) =>
  formatNumber(locale, Number(value), { maximumFractionDigits: 1 });

/** My next open tasks: overdue first, then soonest due. */
export function MyTasks({ section }: { section: NonNullable<DashboardSummary['myTasks']> }) {
  const { t, locale } = useI18n();
  return (
    <Card title={t('ui.dashboard.myTasksTitle')}>
      {section.items.length === 0 ? (
        <p className="text-[13.5px] text-ink-2">{t('ui.dashboard.myTasksEmpty')}</p>
      ) : (
        <ul className="ui-stagger -mx-2 grid">
          {section.items.map((task) => (
            <li key={task.id}>
              <Link
                to="/tasks/$taskId"
                params={{ taskId: task.id }}
                className="group flex items-center gap-3 rounded-ctl px-2 py-2.5 hover:bg-frame"
              >
                <span
                  aria-hidden
                  className={`grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-4 ${
                    task.overdue ? 'bg-blush text-blush-ink' : 'bg-lilac text-lilac-ink'
                  }`}
                >
                  {task.overdue ? <AlarmClock /> : <CalendarDays />}
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[13.5px] font-semibold">{task.title}</span>
                  <span className="truncate text-[12.5px] text-ink-2">
                    {locale === 'ar' ? task.projectNameAr : task.projectNameEn} ·{' '}
                    {t(`ui.tasks.status.${task.status}`)}
                  </span>
                </span>
                <span
                  className={`num shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${
                    task.overdue ? 'bg-blush text-blush-ink' : 'bg-frame text-ink-2'
                  }`}
                >
                  {task.dueDate
                    ? day(locale, task.dueDate, { day: 'numeric', month: 'short' })
                    : t('ui.dashboard.noDueDate')}
                </span>
                <ChevronRight aria-hidden className="mirror size-4 shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** My hours per day this week as capsule columns; today is marked in plum. */
export function MyWeek({ section }: { section: NonNullable<DashboardSummary['myWeek']> }) {
  const { t, locale } = useI18n();
  // Kuwait date (UTC+3), read once when the section mounts.
  const [today] = useState(() => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10));
  const total = section.days.reduce((sum, d) => sum + Number(d.hours), 0);
  const target = section.weeklyTarget ? Number(section.weeklyTarget) : null;
  const scaleMax = Math.max(
    8,
    target ? target / 5 : 0,
    ...section.days.map((d) => Number(d.hours)),
  );
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold">{t('ui.dashboard.myWeekTitle')}</h2>
        <p className="text-[13px] text-ink-2">
          {target
            ? t('ui.dashboard.myWeekOfTarget', {
                hours: hours(locale, total),
                target: hours(locale, target),
              })
            : t('ui.dashboard.myWeekTotal', { hours: hours(locale, total) })}
        </p>
      </div>
      <ol className="grid grid-cols-7 gap-2 sm:gap-3">
        {section.days.map((d) => {
          const value = Number(d.hours);
          const pct = Math.min(100, Math.round((value / scaleMax) * 100));
          const isToday = d.date === today;
          return (
            <li key={d.date} className="grid justify-items-center gap-2">
              <div
                role="img"
                aria-label={t('ui.dashboard.myWeekDay', {
                  day: day(locale, d.date, { weekday: 'long' }),
                  hours: hours(locale, value),
                })}
                className="relative h-36 w-full max-w-14 overflow-hidden rounded-full bg-[repeating-linear-gradient(135deg,var(--frame)_0_4px,var(--line)_4px_6px)]"
              >
                {value > 0 && (
                  <div
                    className={`ui-fill-y absolute inset-x-0 bottom-0 grid place-items-start justify-center rounded-full pt-2 ${
                      isToday ? 'bg-plum text-on-plum' : 'bg-lilac-solid text-white'
                    }`}
                    style={{ blockSize: `${Math.max(pct, 22)}%` }}
                  >
                    <span className="num text-[11px] font-bold">{hours(locale, value)}</span>
                  </div>
                )}
              </div>
              <span
                className={`text-[12px] ${isToday ? 'font-bold text-ink' : 'font-medium text-ink-2'}`}
              >
                {day(locale, d.date, { weekday: 'short' })}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Open projects by budget use: hours logged against the budget, coloured by state. */
export function ProjectHealth({
  section,
}: {
  section: NonNullable<DashboardSummary['projectHealth']>;
}) {
  const { t, locale } = useI18n();
  return (
    <Card title={t('ui.dashboard.projectsTitle')}>
      {section.items.length === 0 ? (
        <p className="text-[13.5px] text-ink-2">{t('ui.dashboard.projectsEmpty')}</p>
      ) : (
        <ul className="ui-stagger grid gap-1">
          {section.items.map((p) => {
            const budget = p.budgetHours ? Number(p.budgetHours) : null;
            const logged = Number(p.loggedHours);
            const ratio = budget ? logged / budget : 0;
            const state = !budget ? 'none' : ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok';
            const fill = {
              none: 'bg-line-2',
              ok: 'bg-mint-solid',
              near: 'bg-butter-solid',
              over: 'bg-blush-solid',
            }[state];
            return (
              <li key={p.id}>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="grid gap-2 rounded-ctl px-2 py-2.5 hover:bg-frame"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="grid min-w-0">
                      <span className="truncate text-[13.5px] font-semibold">
                        {locale === 'ar' ? p.nameAr : p.nameEn}
                      </span>
                      <span className="truncate text-[12.5px] text-ink-2">
                        {locale === 'ar' ? p.clientNameAr : p.clientNameEn}
                        {p.endDate &&
                          ` · ${t('ui.dashboard.endsOn', { date: day(locale, p.endDate, { day: 'numeric', month: 'short' }) })}`}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[12.5px] font-bold text-ink-2">
                      {budget
                        ? t('ui.dashboard.hoursOfBudget', {
                            logged: hours(locale, logged),
                            budget: hours(locale, budget),
                          })
                        : t('ui.dashboard.noBudget')}
                    </span>
                  </span>
                  <span
                    role="meter"
                    aria-label={locale === 'ar' ? p.nameAr : p.nameEn}
                    aria-valuemin={0}
                    aria-valuemax={budget ?? 0}
                    aria-valuenow={logged}
                    className="h-2.5 overflow-hidden rounded-full bg-frame"
                  >
                    <span
                      className={`ui-fill-x block h-full rounded-full ${fill}`}
                      style={{
                        inlineSize: `${budget ? Math.min(100, Math.round(ratio * 100)) : 0}%`,
                      }}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** People on approved leave today or in the coming week. */
export function Away({ section }: { section: NonNullable<DashboardSummary['away']> }) {
  const { t, locale } = useI18n();
  return (
    <Card title={t('ui.dashboard.awayTitle')}>
      {section.items.length === 0 ? (
        <p className="text-[13.5px] text-ink-2">{t('ui.dashboard.awayEmpty')}</p>
      ) : (
        <ul className="ui-stagger grid gap-3">
          {section.items.map((a) => {
            const initials = a.name
              .split(/\s+/)
              .map((part) => part[0] ?? '')
              .join('')
              .slice(0, 2)
              .toUpperCase();
            const range =
              a.startDate === a.endDate
                ? day(locale, a.startDate, { day: 'numeric', month: 'short' })
                : `${day(locale, a.startDate, { day: 'numeric', month: 'short' })} – ${day(locale, a.endDate, { day: 'numeric', month: 'short' })}`;
            return (
              <li key={`${a.membershipId}-${a.startDate}`} className="flex items-center gap-3">
                <Avatar name={a.name} initials={initials} size={36} />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[13.5px] font-semibold">{a.name}</span>
                  <span className="truncate text-[12.5px] text-ink-2">
                    {locale === 'ar' ? a.leaveTypeAr : a.leaveTypeEn}
                  </span>
                </span>
                <span className="num shrink-0 rounded-full bg-butter px-2.5 py-1 text-[12px] font-bold text-butter-ink">
                  {range}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
