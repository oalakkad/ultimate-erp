import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { compareMoney, moneyRatio, type ReportKey, reportSchema } from '@ultimate-erp/contracts';
import { formatDate, formatMoney, formatNumber } from '@ultimate-erp/i18n';
import {
  BarChart,
  budgetTone,
  Card,
  DistributionBar,
  LoadingState,
  Progress,
  StatCard,
} from '@ultimate-erp/ui';
import { ArrowUpRight, Banknote, Gauge, ListChecks, PiggyBank, ReceiptText } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { api } from '../lib/api.js';

// Reports analytics landing (redesign 2026-11-08). Every figure is a total or row of the
// server's own report (`/reports/:key`, the same numbers as the report tables and CSV
// exports); this page only arranges them. Floats are used to size marks, never as figures.

type Period = 'ytd' | 'quarter' | '12m';
const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
function range(period: Period): { from: string; to: string } {
  const to = today();
  const [y, m] = to.split('-').map(Number) as [number, number];
  if (period === 'ytd') return { from: `${String(y)}-01-01`, to };
  if (period === 'quarter') {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: `${String(y)}-${String(q).padStart(2, '0')}-01`, to };
  }
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return { from: d.toISOString().slice(0, 10), to };
}

function useReport(key: ReportKey, enabled: boolean, period: { from: string; to: string }) {
  return useQuery({
    queryKey: ['reports', 'overview', key, period.from, period.to],
    queryFn: () =>
      api(`/reports/${key}?from=${period.from}&to=${period.to}`, { schema: reportSchema }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

function Drill({ to, children }: { to: ReportKey; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Link
      to="/reports/$reportKey"
      params={{ reportKey: to }}
      className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-2 hover:text-ink"
      aria-label={t('ui.ws.reports.open', { name: t(`ui.reports.names.${to}`) })}
    >
      {children}
      <ArrowUpRight aria-hidden className="mirror size-3.5" />
    </Link>
  );
}

const pct = (locale: 'en' | 'ar', ratio: number) =>
  formatNumber(locale, ratio, { style: 'percent', maximumFractionDigits: 0 });

export function ReportsOverview({ keys }: { keys: Set<ReportKey> }) {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<Period>('ytd');
  const p = range(period);
  const has = (k: ReportKey) => keys.has(k);
  const revenue = useReport('revenue', has('revenue'), p);
  const profit = useReport('profitability', has('profitability'), p);
  const util = useReport('utilization', has('utilization'), p);
  const projects = useReport('projects', has('projects'), p);
  const tasks = useReport('tasks', has('tasks'), p);
  const receivables = useReport('receivables', has('receivables'), p);
  if (
    !['revenue', 'profitability', 'utilization', 'projects', 'tasks'].some((k) =>
      has(k as ReportKey),
    )
  )
    return null;
  const money = (v: string) => formatMoney(locale, v, 'KWD');
  const rev = revenue.data?.totals;
  const pr = profit.data?.totals;
  const ut = util.data?.totals;
  const tk = tasks.data?.totals;
  const utilRatio =
    ut && Number(ut.capacityHours) > 0 ? Number(ut.approvedHours) / Number(ut.capacityHours) : null;
  const billRatio =
    ut && Number(ut.approvedHours) > 0 ? Number(ut.billableHours) / Number(ut.approvedHours) : null;
  const margin =
    pr?.invoiced && compareMoney(pr.invoiced, '0') > 0 && pr.contribution
      ? moneyRatio(pr.contribution, pr.invoiced)
      : null;
  const done = tk ? Number(tk.completed) : 0;
  return (
    <section aria-label={t('ui.ws.reports.analytics')} className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-bold tracking-tight">{t('ui.ws.reports.analytics')}</h2>
        <span className="text-[12.5px] text-ink-3">
          {formatDate(locale, new Date(`${p.from}T12:00:00Z`), { dateStyle: 'medium' })} –{' '}
          {formatDate(locale, new Date(`${p.to}T12:00:00Z`), { dateStyle: 'medium' })}
        </span>
        <div
          role="group"
          aria-label={t('ui.ws.reports.period')}
          className="ui-glass ms-auto inline-flex gap-0.5 rounded-full p-[3px]"
        >
          {(['quarter', 'ytd', '12m'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={period === k}
              onClick={() => {
                setPeriod(k);
              }}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink aria-pressed:bg-plum aria-pressed:text-on-plum"
            >
              {t(`ui.ws.reports.periods.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="ui-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {has('revenue') && (
          <StatCard
            tone="lilac"
            icon={<ReceiptText />}
            label={t('ui.ws.reports.invoiced')}
            value={rev?.invoiced ? money(rev.invoiced) : '—'}
            hint={
              rev?.received
                ? t('ui.ws.reports.received', { amount: money(rev.received) })
                : undefined
            }
          />
        )}
        {has('profitability') && (
          <StatCard
            tone="mint"
            icon={<PiggyBank />}
            label={t('ui.ws.reports.contribution')}
            value={pr?.contribution ? money(pr.contribution) : '—'}
            hint={
              margin !== null ? t('ui.ws.reports.margin', { pct: pct(locale, margin) }) : undefined
            }
          />
        )}
        {has('utilization') && (
          <StatCard
            tone="sky"
            icon={<Gauge />}
            label={t('ui.ws.reports.utilization')}
            value={utilRatio !== null ? pct(locale, utilRatio) : '—'}
            hint={
              billRatio !== null
                ? t('ui.ws.reports.billableShare', { pct: pct(locale, billRatio) })
                : undefined
            }
          />
        )}
        {has('tasks') && (
          <StatCard
            tone="butter"
            icon={<ListChecks />}
            label={t('ui.ws.reports.tasksDone')}
            value={tk ? formatNumber(locale, done) : '—'}
            hint={
              tk
                ? t('ui.ws.reports.tasksHint', {
                    onTime: tk.onTime ?? '0',
                    overdue: tk.openOverdue ?? '0',
                  })
                : undefined
            }
          />
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {has('revenue') && (
          <Card>
            {revenue.data ? (
              <BarChart
                title={t('ui.ws.reports.revenueTrend')}
                description={t('ui.ws.billing.trendBody', {
                  invoiced: money(rev?.invoiced ?? '0'),
                  received: money(rev?.received ?? '0'),
                })}
                series={[
                  { key: 'invoiced', label: t('ui.billing.invoiced') },
                  { key: 'received', label: t('ui.billing.received') },
                ]}
                data={revenue.data.rows.map((r) => ({
                  label: formatDate(locale, new Date(`${r.month ?? ''}-15T12:00:00Z`), {
                    month: 'short',
                  }),
                  values: { invoiced: Number(r.invoiced ?? 0), received: Number(r.received ?? 0) },
                }))}
                format={(v) => formatMoney(locale, v.toFixed(3), 'KWD')}
                formatTick={(v) => formatNumber(locale, v, { notation: 'compact' })}
                showTableLabel={t('ui.common.showTable')}
                showChartLabel={t('ui.common.showChart')}
                highlight={t('ui.ws.billing.bestMonth')}
              />
            ) : (
              <LoadingState label={t('ui.common.loading')} lines={4} />
            )}
            <Drill to="revenue">{t('ui.ws.reports.fullReport')}</Drill>
          </Card>
        )}
        {has('receivables') && receivables.data?.totals && (
          <Card title={t('ui.ws.billing.agingTitle')}>
            {compareMoney(receivables.data.totals.total ?? '0', '0') > 0 ? (
              <DistributionBar
                label={t('ui.ws.billing.agingTitle')}
                segments={(
                  [
                    ['notDue', 'current', 'var(--mint-solid)'],
                    ['days1to30', 'd1_30', 'var(--butter-solid)'],
                    ['days31to60', 'd31_60', 'var(--series-2)'],
                    ['days61to90', 'd61_90', 'var(--blush-solid)'],
                    ['over90', 'd90_plus', 'var(--bad)'],
                  ] as const
                ).map(([col, bucket, color]) => {
                  const v = receivables.data.totals?.[col] ?? '0';
                  return {
                    key: col,
                    label: t(`ui.billing.bucket.${bucket}`),
                    value: moneyRatio(v, receivables.data.totals?.total ?? '1'),
                    display: money(v),
                    color,
                  };
                })}
              />
            ) : (
              <p className="text-[13px] text-ink-2">{t('ui.billing.nothingOutstanding')}</p>
            )}
            <Drill to="receivables">{t('ui.ws.reports.fullReport')}</Drill>
          </Card>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {has('projects') && projects.data && (
          <Card title={t('ui.ws.reports.budgetVsActual')}>
            <ul className="grid gap-3.5">
              {projects.data.rows
                .filter((r) => Number(r.budgetHours ?? 0) > 0)
                .sort((a, b) => Number(b.consumption ?? 0) - Number(a.consumption ?? 0))
                .slice(0, 6)
                .map((r) => {
                  const budget = Number(r.budgetHours ?? 0);
                  const used = Number(r.approvedHours ?? 0);
                  return (
                    <li key={r.number} className="grid gap-1.5">
                      <span className="flex items-baseline gap-2 text-[13px]">
                        <b className="min-w-0 flex-1 truncate font-semibold">{r.project}</b>
                        <span className="num text-[12px] text-ink-2">
                          {t('ui.ws.reports.hoursOf', {
                            used: formatNumber(locale, used),
                            budget: formatNumber(locale, budget),
                          })}
                        </span>
                      </span>
                      <Progress
                        label={t('ui.ws.reports.hoursOf', {
                          used: formatNumber(locale, used),
                          budget: formatNumber(locale, budget),
                        })}
                        value={used}
                        max={budget}
                        tone={budgetTone(used, budget)}
                      />
                    </li>
                  );
                })}
            </ul>
            <Drill to="projects">{t('ui.ws.reports.fullReport')}</Drill>
          </Card>
        )}
        {has('utilization') && util.data && (
          <Card title={t('ui.ws.reports.byPerson')}>
            <ul className="grid gap-3">
              {util.data.rows
                .filter((r) => Number(r.approvedHours ?? 0) > 0)
                .sort((a, b) => Number(b.utilization ?? 0) - Number(a.utilization ?? 0))
                .slice(0, 6)
                .map((r) => {
                  const ratio = Number(r.utilization ?? 0) / 100;
                  return (
                    <li
                      key={r.person}
                      className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-[13px]"
                    >
                      <span className="truncate font-semibold">{r.person}</span>
                      <Progress
                        label={`${r.person ?? ''}: ${pct(locale, ratio)}`}
                        value={ratio}
                        max={1}
                        tone="info"
                      />
                      <span className="num text-end text-[12px] font-bold">
                        {pct(locale, ratio)}
                      </span>
                    </li>
                  );
                })}
            </ul>
            {util.data.rows.every((r) => Number(r.approvedHours ?? 0) === 0) && (
              <p className="text-[13px] text-ink-2">{t('ui.ws.reports.noHours')}</p>
            )}
            <Drill to="utilization">{t('ui.ws.reports.fullReport')}</Drill>
          </Card>
        )}
      </div>
      {has('profitability') && profit.data && profit.data.rows.length > 0 && (
        <Card title={t('ui.ws.reports.profitByProject')}>
          <ul className="grid gap-3 md:grid-cols-2">
            {[...profit.data.rows]
              .sort((a, b) => compareMoney(b.contribution ?? '0', a.contribution ?? '0'))
              .slice(0, 6)
              .map((r) => (
                <li
                  key={r.number}
                  className="flex items-center gap-3 rounded-tile border border-line bg-frame p-3"
                >
                  <Banknote aria-hidden className="size-4 shrink-0 text-mint-ink" />
                  <span className="grid min-w-0 flex-1">
                    <b className="truncate text-[13px] font-semibold">{r.project}</b>
                    <span className="truncate text-[12px] text-ink-3">{r.client}</span>
                  </span>
                  <span className="grid text-end">
                    <b className="num text-[13px]">{money(r.contribution ?? '0')}</b>
                    <span className="num text-[11.5px] text-ink-3">
                      {t('ui.ws.reports.margin', {
                        pct: pct(locale, Number(r.margin ?? 0) / 100),
                      })}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
          <Drill to="profitability">{t('ui.ws.reports.fullReport')}</Drill>
        </Card>
      )}
    </section>
  );
}
