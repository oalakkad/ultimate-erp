import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  agingSchema,
  billingSettingsSchema,
  INVOICE_STATUSES,
  type InvoiceStatus,
  invoiceListResponseSchema,
  revenueSchema,
} from '@ultimate-erp/contracts';
import { formatDate, formatMoney } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
  Tabs,
  TextField,
} from '@ultimate-erp/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { useSearchParam } from '../../lib/use-search-param.js';

export const INVOICE_CHIP: Record<InvoiceStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  draft: 'info',
  issued: 'warn',
  partially_paid: 'warn',
  paid: 'good',
  void: 'bad',
};
export const dateOf = (locale: 'en' | 'ar', iso: string | null) =>
  iso ? formatDate(locale, new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' }) : '—';

/** Invoices (brief Module K): register, receivables aging, revenue and settings. */
export function InvoicesPage() {
  const { t } = useI18n();
  const access = useAccess(true);
  const company = can(access.data, 'billing.invoice.read');
  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.billing.title')}
        actions={
          can(access.data, 'billing.invoice.issue') && (
            <Link
              to="/invoices/new"
              className="inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover"
            >
              <Plus aria-hidden className="size-4" />
              {t('ui.billing.new')}
            </Link>
          )
        }
      />
      <Tabs
        label={t('ui.billing.title')}
        items={[
          { value: 'list', label: t('ui.billing.tabs.list'), content: <InvoiceList /> },
          ...(company
            ? [{ value: 'aging', label: t('ui.billing.tabs.aging'), content: <Aging /> }]
            : []),
          ...(company
            ? [{ value: 'revenue', label: t('ui.billing.tabs.revenue'), content: <Revenue /> }]
            : []),
          ...(can(access.data, 'billing.invoice.issue')
            ? [{ value: 'settings', label: t('ui.billing.tabs.settings'), content: <Settings /> }]
            : []),
        ]}
      />
    </div>
  );
}

export function InvoiceList({ clientId }: { clientId?: string }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [overdue, setOverdue] = useState(useSearchParam('overdue') === '1');
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (overdue) params.set('overdue', 'true');
  if (term) params.set('search', term);
  if (clientId) params.set('clientId', clientId);
  const list = useQuery({
    queryKey: ['invoices', 'list', params.toString()],
    queryFn: () => api(`/invoices?${params.toString()}`, { schema: invoiceListResponseSchema }),
    placeholderData: (previous) => previous,
  });
  return (
    <Card>
      {!clientId && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <TextField
              label={t('ui.billing.search')}
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
          <div className="w-48">
            <SelectField
              label={t('ui.billing.status')}
              placeholder={t('ui.billing.allStatuses')}
              value={status}
              onValueChange={(v) => {
                setStatus(v as InvoiceStatus | 'all');
              }}
              options={[
                { value: 'all', label: t('ui.billing.allStatuses') },
                ...INVOICE_STATUSES.map((s) => ({
                  value: s,
                  label: t(`ui.billing.statusName.${s}`),
                })),
              ]}
            />
          </div>
          <div className="pb-2.5">
            <Checkbox
              label={t('ui.billing.overdueOnly')}
              checked={overdue}
              onCheckedChange={setOverdue}
            />
          </div>
        </div>
      )}
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, list.error)}
          reference={errorReference(t, list.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data?.items.length === 0 && (
        <EmptyState title={t('ui.billing.empty')} body={t('ui.billing.emptyBody')} />
      )}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="text-[12px] text-ink-3">
              <tr>
                {(['number', 'client', 'status', 'due', 'total', 'outstanding'] as const).map(
                  (c) => (
                    <th
                      key={c}
                      scope="col"
                      className={`py-2 font-semibold ${c === 'total' || c === 'outstanding' ? 'text-end' : 'text-start'}`}
                    >
                      {t(`ui.billing.col.${c}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="py-3">
                    <Link
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: i.id }}
                      className="font-semibold hover:underline"
                      dir="ltr"
                    >
                      {i.number ?? t('ui.billing.draftLabel')}
                    </Link>
                  </td>
                  <td className="py-3">{locale === 'ar' ? i.client.name.ar : i.client.name.en}</td>
                  <td className="py-3">
                    <span className="flex flex-wrap gap-1.5">
                      <StatusChip
                        status={INVOICE_CHIP[i.status]}
                        label={t(`ui.billing.statusName.${i.status}`)}
                      />
                      {i.overdue && <StatusChip status="bad" label={t('ui.billing.overdue')} />}
                    </span>
                  </td>
                  <td className="py-3 text-ink-2">{dateOf(locale, i.dueDate)}</td>
                  <td className="py-3 text-end tabular-nums">
                    {formatMoney(locale, i.total, i.currency)}
                  </td>
                  <td className="py-3 text-end tabular-nums">
                    {formatMoney(locale, i.outstanding, i.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Aging() {
  const { t, locale } = useI18n();
  const aging = useQuery({
    queryKey: ['invoices', 'aging'],
    queryFn: () => api('/billing/aging', { schema: agingSchema }),
  });
  if (!aging.data) return <LoadingState label={t('ui.common.loading')} lines={3} />;
  const money = (v: string) => formatMoney(locale, v, aging.data.currency);
  return (
    <div className="grid gap-4">
      <Card title={t('ui.billing.agingTitle', { total: money(aging.data.total) })}>
        <dl className="grid gap-3 sm:grid-cols-5">
          {aging.data.buckets.map((b) => (
            <div key={b.key} className="grid gap-0.5 rounded-tile bg-frame p-3">
              <dt className="text-[12px] font-semibold text-ink-3">
                {t(`ui.billing.bucket.${b.key}`)}
              </dt>
              <dd className="text-[15px] font-bold tabular-nums">{money(b.amount)}</dd>
              <dd className="text-[12px] text-ink-3">
                {t('ui.billing.invoiceCount', { count: b.count })}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title={t('ui.billing.byClient')}>
        {aging.data.clients.length === 0 && (
          <EmptyState title={t('ui.billing.nothingOutstanding')} body={t('ui.states.emptyBody')} />
        )}
        <ul className="grid gap-1.5 text-[13.5px]">
          {aging.data.clients.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-tile bg-frame p-2.5"
            >
              <span>{locale === 'ar' ? c.name.ar : c.name.en}</span>
              <span className="tabular-nums">
                {t('ui.billing.clientLine', {
                  outstanding: money(c.outstanding),
                  overdue: money(c.overdue),
                })}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Revenue() {
  const { t, locale } = useI18n();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const data = useQuery({
    queryKey: ['invoices', 'revenue', year],
    queryFn: () => api(`/billing/revenue?year=${year}`, { schema: revenueSchema }),
  });
  const money = (v: string) => formatMoney(locale, v, 'KWD');
  return (
    <Card
      title={t('ui.billing.revenueTitle', { year })}
      action={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setYear(year - 1);
            }}
          >
            {year - 1}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setYear(year + 1);
            }}
          >
            {year + 1}
          </Button>
        </div>
      }
    >
      {data.isPending && <LoadingState label={t('ui.common.loading')} lines={3} />}
      {data.data && (
        <table className="w-full text-[13.5px]">
          <thead className="text-[12px] text-ink-3">
            <tr>
              <th scope="col" className="py-1.5 text-start font-semibold">
                {t('ui.billing.month')}
              </th>
              <th scope="col" className="py-1.5 text-end font-semibold">
                {t('ui.billing.invoiced')}
              </th>
              <th scope="col" className="py-1.5 text-end font-semibold">
                {t('ui.billing.received')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.data.months.map((m) => (
              <tr key={m.month} className="border-t border-line">
                <td className="py-1.5">
                  {formatDate(locale, new Date(`${m.month}-15T12:00:00Z`), { month: 'long' })}
                </td>
                <td className="py-1.5 text-end tabular-nums">{money(m.invoiced)}</td>
                <td className="py-1.5 text-end tabular-nums">{money(m.received)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line font-bold">
              <td className="py-1.5">{t('ui.billing.yearTotal')}</td>
              <td className="py-1.5 text-end tabular-nums">{money(data.data.totals.invoiced)}</td>
              <td className="py-1.5 text-end tabular-nums">{money(data.data.totals.received)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Settings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['billing', 'settings'],
    queryFn: () => api('/billing/settings', { schema: billingSettingsSchema }),
  });
  const [terms, setTerms] = useState<string | null>(null);
  const [tax, setTax] = useState({ code: '', label: '', ratePercent: '' });
  const save = useMutation({
    mutationFn: (body: object) =>
      api('/billing/settings', { method: 'PATCH', body, schema: billingSettingsSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(['billing', 'settings'], data);
      setTerms(null);
      setTax({ code: '', label: '', ratePercent: '' });
    },
  });
  if (!settings.data) return <LoadingState label={t('ui.common.loading')} lines={2} />;
  const s = settings.data;
  return (
    <Card title={t('ui.billing.settingsTitle')}>
      {s.toVerify && (
        <p role="note" className="rounded-tile bg-butter p-3 text-[13px] text-butter-ink">
          {t('ui.billing.taxNote')}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <TextField
            label={t('ui.billing.terms')}
            type="number"
            min={0}
            max={365}
            value={terms ?? String(s.paymentTermsDays)}
            onChange={(e) => {
              setTerms(e.target.value);
            }}
          />
        </div>
        <Button
          size="sm"
          disabled={terms === null}
          onClick={() => {
            save.mutate({ paymentTermsDays: Number(terms) });
          }}
        >
          {t('ui.common.save')}
        </Button>
      </div>
      <h3 className="text-[13px] font-bold">{t('ui.billing.taxes')}</h3>
      {s.taxes.length === 0 && <small className="text-ink-3">{t('ui.billing.noTaxes')}</small>}
      <ul className="grid gap-1.5 text-[13.5px]">
        {s.taxes.map((x) => (
          <li
            key={x.code}
            className="flex flex-wrap items-center justify-between gap-2 rounded-tile bg-frame p-2.5"
          >
            <span>
              {x.label} · {x.ratePercent}% <span dir="ltr">({x.code})</span>
            </span>
            <Checkbox
              label={t('ui.billing.taxActive')}
              checked={x.active}
              onCheckedChange={(on) => {
                save.mutate({
                  taxes: s.taxes.map((y) => (y.code === x.code ? { ...y, active: on } : y)),
                });
              }}
            />
          </li>
        ))}
      </ul>
      <form
        noValidate
        className="grid gap-2 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ taxes: [...s.taxes, { ...tax, active: false }] });
        }}
      >
        <TextField
          label={t('ui.billing.taxCode')}
          dir="ltr"
          value={tax.code}
          onChange={(e) => {
            setTax({ ...tax, code: e.target.value });
          }}
        />
        <TextField
          label={t('ui.billing.taxLabel')}
          value={tax.label}
          onChange={(e) => {
            setTax({ ...tax, label: e.target.value });
          }}
        />
        <TextField
          label={t('ui.billing.taxRate')}
          inputMode="decimal"
          dir="ltr"
          value={tax.ratePercent}
          onChange={(e) => {
            setTax({ ...tax, ratePercent: e.target.value });
          }}
        />
        <Button type="submit" disabled={!tax.code || !tax.label || !tax.ratePercent}>
          {t('ui.billing.addTax')}
        </Button>
      </form>
      {s.toVerify && (
        <Button
          variant="secondary"
          className="w-fit"
          onClick={() => {
            save.mutate({ confirmVerified: true });
          }}
        >
          {t('ui.billing.confirmTaxes')}
        </Button>
      )}
      <FormError error={save.error} />
    </Card>
  );
}
