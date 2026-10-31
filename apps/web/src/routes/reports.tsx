import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  clientListResponseSchema,
  projectListResponseSchema,
  type Report,
  reportCatalogSchema,
  type ReportKey,
  reportSchema,
} from '@ultimate-erp/contracts';
import { formatDate, formatMoney, formatNumber } from '@ultimate-erp/i18n';
import {
  BarChart,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
} from '@ultimate-erp/ui';
import { ChevronRight, Download } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { AppPageHeader } from '../components/page-header.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';

const GROUPS: { key: 'finance' | 'work' | 'people'; reports: ReportKey[] }[] = [
  {
    key: 'finance',
    reports: [
      'revenue',
      'receivables',
      'invoices',
      'payments',
      'clients',
      'profitability',
      'payroll',
    ],
  },
  { key: 'work', reports: ['projects', 'tasks', 'timesheets'] },
  { key: 'people', reports: ['utilization', 'attendance', 'leave'] },
];
const kuwaitToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** Reports catalogue (brief Module M): only the reports this person may run. */
export function ReportsPage() {
  const { t } = useI18n();
  const catalog = useQuery({
    queryKey: ['reports', 'catalog'],
    queryFn: () => api('/reports', { schema: reportCatalogSchema }),
  });
  const mine = new Set(catalog.data?.items.map((i) => i.key));
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.reports.title')} />
      {catalog.isPending && <LoadingState label={t('ui.common.loading')} lines={4} />}
      {catalog.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, catalog.error)}
          reference={errorReference(t, catalog.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void catalog.refetch()}
        />
      )}
      {catalog.data?.items.length === 0 && (
        <Card>
          <EmptyState title={t('ui.reports.none')} body={t('ui.reports.noneBody')} />
        </Card>
      )}
      {GROUPS.map((group) => {
        const keys = group.reports.filter((k) => mine.has(k));
        if (keys.length === 0) return null;
        return (
          <Card key={group.key} title={t(`ui.reports.groups.${group.key}`)}>
            <ul className="ui-stagger -mx-2 grid">
              {keys.map((key) => (
                <li key={key}>
                  <Link
                    to="/reports/$reportKey"
                    params={{ reportKey: key }}
                    className="group flex items-center gap-3 rounded-ctl px-2 py-2.5 hover:bg-frame"
                  >
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <b className="text-[14px] font-bold">{t(`ui.reports.names.${key}`)}</b>
                      <small className="text-[12.5px] text-ink-2">
                        {t(`ui.reports.summaries.${key}`)}
                      </small>
                    </span>
                    <ChevronRight aria-hidden className="mirror size-4 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

/** One report: filters, its definition, the table with totals, CSV export. */
export function ReportPage() {
  const { t, locale } = useI18n();
  const { reportKey } = useParams({ from: '/app/reports/$reportKey' });
  const key = reportKey as ReportKey;
  const catalog = useQuery({
    queryKey: ['reports', 'catalog'],
    queryFn: () => api('/reports', { schema: reportCatalogSchema }),
  });
  const entry = catalog.data?.items.find((i) => i.key === key);
  const filters = entry?.filters ?? [];
  const [from, setFrom] = useState(`${kuwaitToday().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(kuwaitToday());
  const [clientId, setClientId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const params = new URLSearchParams({ locale });
  if (filters.includes('period')) {
    params.set('from', from);
    params.set('to', to);
  }
  if (clientId !== 'all') params.set('clientId', clientId);
  if (projectId !== 'all') params.set('projectId', projectId);
  const report = useQuery({
    queryKey: ['reports', key, params.toString()],
    enabled: Boolean(entry) && (!filters.includes('period') || (Boolean(from) && Boolean(to))),
    queryFn: () => api(`/reports/${key}?${params.toString()}`, { schema: reportSchema }),
    placeholderData: (previous) => previous,
  });
  const clients = useQuery({
    queryKey: ['clients', 'picker'],
    enabled: filters.includes('client'),
    queryFn: () => api('/clients?limit=100&sort=name', { schema: clientListResponseSchema }),
  });
  const projects = useQuery({
    queryKey: ['projects', 'picker', 'all'],
    enabled: filters.includes('project'),
    queryFn: () => api('/projects?limit=100', { schema: projectListResponseSchema }),
  });

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t(`ui.reports.names.${key}`)}
        actions={
          entry && (
            <a
              href={`/api/v1/reports/${key}/export.csv?${params.toString()}`}
              className="inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame"
              download
            >
              <Download aria-hidden className="size-4" />
              {t('ui.reports.exportCsv')}
            </a>
          )
        }
      />
      <Card>
        <p className="text-[13.5px] text-ink-2">{t(`ui.reports.definitions.${key}`)}</p>
        {entry?.scoped && (
          <p role="note" className="rounded-tile bg-sky p-3 text-[13px] text-sky-ink">
            {t('ui.reports.scopedNote')}
          </p>
        )}
        {filters.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            {filters.includes('period') && (
              <>
                <TextField
                  label={t('ui.reports.from')}
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                  }}
                />
                <TextField
                  label={t('ui.reports.to')}
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                  }}
                />
              </>
            )}
            {filters.includes('client') && (
              <SelectField
                label={t('ui.reports.client')}
                placeholder={t('ui.reports.allClients')}
                value={clientId}
                onValueChange={setClientId}
                options={[
                  { value: 'all', label: t('ui.reports.allClients') },
                  ...(clients.data?.items ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.number} · ${locale === 'ar' ? c.legalName.ar : c.legalName.en}`,
                  })),
                ]}
              />
            )}
            {filters.includes('project') && (
              <SelectField
                label={t('ui.reports.project')}
                placeholder={t('ui.reports.allProjects')}
                value={projectId}
                onValueChange={setProjectId}
                options={[
                  { value: 'all', label: t('ui.reports.allProjects') },
                  ...(projects.data?.items ?? []).map((p) => ({
                    value: p.id,
                    label: `${p.number} · ${locale === 'ar' ? p.name.ar : p.name.en}`,
                  })),
                ]}
              />
            )}
          </div>
        )}
      </Card>
      {(catalog.isPending || report.isPending) && !report.isError && (
        <LoadingState label={t('ui.common.loading')} lines={5} />
      )}
      {catalog.data && !entry && (
        <Card>
          <EmptyState
            title={t('ui.reports.notAvailable')}
            body={t('ui.reports.notAvailableBody')}
          />
        </Card>
      )}
      {report.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, report.error)}
          reference={errorReference(t, report.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void report.refetch()}
        />
      )}
      {report.data && key === 'revenue' && report.data.rows.length > 0 && (
        <Card>
          <BarChart
            title={t('ui.reports.names.revenue')}
            series={[
              { key: 'invoiced', label: t('ui.reports.col.invoiced') },
              { key: 'received', label: t('ui.reports.col.received') },
            ]}
            data={report.data.rows.map((r) => ({
              label: formatDate(locale, new Date(`${r.month ?? ''}-01T12:00:00Z`), {
                month: 'short',
              }),
              values: { invoiced: Number(r.invoiced), received: Number(r.received) },
            }))}
            format={(v) => formatMoney(locale, v.toFixed(3), 'KWD')}
            formatTick={(v) => formatNumber(locale, v, { notation: 'compact' })}
            highlight={t('ui.dashboard.bestMonth')}
            showTableLabel={t('ui.common.showTable')}
            showChartLabel={t('ui.common.showChart')}
          />
        </Card>
      )}
      {report.data && <ReportTable report={report.data} />}
    </div>
  );
}

function ReportTable({ report }: { report: Report }) {
  const { t, locale } = useI18n();
  const show = (type: string, value: string | null | undefined, column: string) => {
    if (value === null || value === undefined || value === '') return '—';
    switch (type) {
      case 'money':
        return formatMoney(locale, value, 'KWD');
      case 'hours':
        return formatNumber(locale, Number(value), { maximumFractionDigits: 2 });
      case 'number':
        return formatNumber(locale, Number(value));
      case 'percent':
        return `${formatNumber(locale, Number(value), { maximumFractionDigits: 1 })}%`;
      case 'date':
        return formatDate(locale, new Date(`${value}T12:00:00Z`), { dateStyle: 'medium' });
      case 'status':
        return t(
          `ui.reports.values.${column === 'method' ? 'method' : 'status'}.${value}` as 'ui.reports.title',
        );
      default:
        // Months ("2026-10") read as month and year.
        return /^\d{4}-\d{2}$/.test(value)
          ? formatDate(locale, new Date(`${value}-01T12:00:00Z`), {
              month: 'long',
              year: 'numeric',
            })
          : value;
    }
  };
  const numeric = (type: string) => ['money', 'hours', 'number', 'percent'].includes(type);
  return (
    <Card>
      {report.rows.length === 0 ? (
        <EmptyState title={t('ui.reports.noRows')} body={t('ui.reports.noRowsBody')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">{t(`ui.reports.names.${report.key}`)}</caption>
            <thead className="text-[12px] text-ink-3">
              <tr>
                {report.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`py-2 font-semibold whitespace-nowrap ${numeric(c.type) ? 'text-end' : 'text-start'}`}
                  >
                    {t(`ui.reports.col.${c.key}` as 'ui.reports.col.client')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {report.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`py-2 ${numeric(c.type) ? 'text-end tabular-nums' : ''}`}
                    >
                      {show(c.type, row[c.key], c.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {report.totals && (
              <tfoot>
                <tr className="border-t-2 border-line-2 font-bold">
                  {report.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={`py-2 ${numeric(c.type) ? 'text-end tabular-nums' : ''}`}
                    >
                      {i === 0
                        ? t('ui.reports.total')
                        : report.totals?.[c.key] !== undefined
                          ? show(c.type, report.totals[c.key], c.key)
                          : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {report.truncated && <small className="text-ink-3">{t('ui.reports.truncated')}</small>}
    </Card>
  );
}
