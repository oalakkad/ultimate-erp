import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  agingSchema,
  billingSettingsSchema,
  compareMoney,
  INVOICE_STATUSES,
  type InvoiceStatus,
  type InvoiceSummary,
  invoiceListResponseSchema,
  moneyRatio,
  revenueSchema,
  subtractMoney,
  sumMoney,
} from '@ultimate-erp/contracts';
import { formatDate, formatMoney, formatNumber } from '@ultimate-erp/i18n';
import {
  Avatar,
  BarChart,
  Button,
  Card,
  CardGrid,
  Checkbox,
  DistributionBar,
  EmptyState,
  EntityCard,
  ErrorState,
  initialsOf,
  LoadingState,
  Progress,
  SectionTitle,
  SelectField,
  StatCard,
  StatusChip,
  Tabs,
  TextField,
  ViewToggle,
} from '@ultimate-erp/ui';
import { AlarmClock, Banknote, CalendarClock, Plus, ReceiptText, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { daysFromToday, useViewMode } from '../../lib/use-view-mode.js';

export const INVOICE_CHIP: Record<InvoiceStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  draft: 'info',
  issued: 'warn',
  partially_paid: 'warn',
  paid: 'good',
  void: 'bad',
};
export const dateOf = (locale: 'en' | 'ar', iso: string | null) =>
  iso ? formatDate(locale, new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' }) : '—';

const ACCENT: Record<InvoiceStatus, 'sky' | 'butter' | 'mint' | 'blush' | 'lilac'> = {
  draft: 'sky',
  issued: 'butter',
  partially_paid: 'lilac',
  paid: 'mint',
  void: 'blush',
};
const BUCKET_COLOR: Record<string, string> = {
  current: 'var(--mint-solid)',
  d1_30: 'var(--butter-solid)',
  d31_60: 'var(--series-2)',
  d61_90: 'var(--blush-solid)',
  d90_plus: 'var(--bad)',
};

export const PRIMARY_LINK =
  'inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum shadow-[0_8px_18px_-8px_rgb(59_31_62/0.7)] transition-transform hover:-translate-y-px hover:bg-plum-hover active:translate-y-0';

/**
 * Invoices workspace (brief Module K, redesign 2026-11-08): the money picture first — invoiced
 * and collected this year, outstanding and overdue (all computed by the server, totals added
 * exactly), the monthly trend and receivables by age — then the register as cards or a table.
 */
export function InvoicesPage() {
  const { t } = useI18n();
  const access = useAccess(true);
  const company = can(access.data, 'billing.invoice.read');
  const [overdueOnly, setOverdueOnly] = useState(useSearchParam('overdue') === '1');
  return (
    <div className="grid gap-5">
      <AppPageHeader
        title={t('ui.billing.title')}
        actions={
          can(access.data, 'billing.invoice.issue') && (
            <Link to="/invoices/new" className={PRIMARY_LINK}>
              <Plus aria-hidden className="size-4" />
              {t('ui.billing.new')}
            </Link>
          )
        }
      />
      <Tabs
        label={t('ui.billing.title')}
        items={[
          {
            value: 'list',
            label: t('ui.ws.overview'),
            content: (
              <div className="grid gap-5">
                {company && (
                  <MoneyOverview
                    onOverdue={() => {
                      setOverdueOnly(true);
                    }}
                  />
                )}
                <InvoiceList views overdue={overdueOnly} onOverdueChange={setOverdueOnly} />
              </div>
            ),
          },
          ...(can(access.data, 'billing.invoice.issue')
            ? [{ value: 'settings', label: t('ui.billing.tabs.settings'), content: <Settings /> }]
            : []),
        ]}
      />
    </div>
  );
}

function MoneyOverview({ onOverdue }: { onOverdue: () => void }) {
  const { t, locale } = useI18n();
  const year = new Date().getUTCFullYear();
  const [shownYear, setShownYear] = useState(year);
  const aging = useQuery({
    queryKey: ['invoices', 'aging'],
    queryFn: () => api('/billing/aging', { schema: agingSchema }),
  });
  const revenue = useQuery({
    queryKey: ['invoices', 'revenue', shownYear],
    queryFn: () => api(`/billing/revenue?year=${String(shownYear)}`, { schema: revenueSchema }),
    placeholderData: (previous) => previous,
  });
  if (aging.isError || revenue.isError) {
    const error = aging.error ?? revenue.error;
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, error)}
        reference={errorReference(t, error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => {
          void aging.refetch();
          void revenue.refetch();
        }}
      />
    );
  }
  if (!aging.data || !revenue.data)
    return <LoadingState label={t('ui.common.loading')} lines={4} />;
  const a = aging.data;
  const r = revenue.data;
  const money = (v: string) => formatMoney(locale, v, a.currency);
  const overdueBuckets = a.buckets.filter((b) => b.key !== 'current');
  const overdue = sumMoney(overdueBuckets.map((b) => b.amount));
  const overdueCount = overdueBuckets.reduce((n, b) => n + b.count, 0);
  const openCount = a.buckets.reduce((n, b) => n + b.count, 0);
  const collectedPct =
    compareMoney(r.totals.invoiced, '0') > 0
      ? formatNumber(locale, moneyRatio(r.totals.received, r.totals.invoiced), {
          style: 'percent',
          maximumFractionDigits: 0,
        })
      : null;
  // Chart marks are drawn from floats (visual only); every figure shown is the server's string.
  const months = r.months.map((m) => ({
    label: formatDate(locale, new Date(`${m.month}-15T12:00:00Z`), { month: 'short' }),
    values: { invoiced: Number(m.invoiced), received: Number(m.received) },
  }));
  const anyAging = compareMoney(a.total, '0') > 0;
  return (
    <div className="grid gap-5">
      <div className="ui-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          tone="lilac"
          icon={<ReceiptText />}
          label={t('ui.ws.billing.invoicedYear', { year: shownYear })}
          value={money(r.totals.invoiced)}
        />
        <StatCard
          tone="mint"
          icon={<Banknote />}
          label={t('ui.ws.billing.collectedYear', { year: shownYear })}
          value={money(r.totals.received)}
          hint={collectedPct ? t('ui.ws.billing.collectionRate', { pct: collectedPct }) : undefined}
        />
        <StatCard
          tone="butter"
          icon={<Wallet />}
          label={t('ui.ws.billing.outstanding')}
          value={money(a.total)}
          hint={t('ui.billing.invoiceCount', { count: openCount })}
        />
        <StatCard
          tone="blush"
          icon={<AlarmClock />}
          label={t('ui.ws.billing.overdue')}
          value={money(overdue)}
          hint={t('ui.billing.invoiceCount', { count: overdueCount })}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card>
          <BarChart
            title={t('ui.billing.revenueTitle', { year: shownYear })}
            description={t('ui.ws.billing.trendBody', {
              invoiced: money(r.totals.invoiced),
              received: money(r.totals.received),
            })}
            series={[
              { key: 'invoiced', label: t('ui.billing.invoiced') },
              { key: 'received', label: t('ui.billing.received') },
            ]}
            data={months}
            format={(v) => formatMoney(locale, v.toFixed(3), a.currency)}
            formatTick={(v) => formatNumber(locale, v, { notation: 'compact' })}
            showTableLabel={t('ui.common.showTable')}
            showChartLabel={t('ui.common.showChart')}
            highlight={t('ui.ws.billing.bestMonth')}
          />
          <div className="flex justify-end gap-1.5">
            {[year - 1, year].map((y) => (
              <Button
                key={y}
                size="sm"
                variant={y === shownYear ? 'primary' : 'secondary'}
                aria-pressed={y === shownYear}
                onClick={() => {
                  setShownYear(y);
                }}
              >
                {y}
              </Button>
            ))}
          </div>
        </Card>
        <Card title={t('ui.ws.billing.agingTitle')}>
          <p className="-mt-2 text-[12.5px] text-ink-2">
            {anyAging
              ? t('ui.billing.agingTitle', { total: money(a.total) })
              : t('ui.billing.nothingOutstanding')}
          </p>
          {anyAging && (
            <DistributionBar
              label={t('ui.ws.billing.agingTitle')}
              segments={a.buckets.map((b) => ({
                key: b.key,
                label: t(`ui.billing.bucket.${b.key}`),
                value: moneyRatio(b.amount, a.total),
                display: money(b.amount),
                color: BUCKET_COLOR[b.key] ?? 'var(--series-1)',
              }))}
              onSelect={(key) => {
                if (key !== 'current') onOverdue();
              }}
            />
          )}
          {a.clients.length > 0 && (
            <div className="grid gap-2 border-t border-line pt-3">
              <span className="text-[12px] font-semibold text-ink-3">
                {t('ui.ws.billing.topDebtors')}
              </span>
              <ul className="grid gap-2.5">
                {[...a.clients]
                  .sort((x, y) => compareMoney(y.outstanding, x.outstanding))
                  .slice(0, 4)
                  .map((c) => {
                    const name = locale === 'ar' ? c.name.ar : c.name.en;
                    return (
                      <li key={c.id} className="flex items-center gap-2.5">
                        <Avatar name={name} initials={initialsOf(name)} size={30} />
                        <span className="grid min-w-0 flex-1">
                          <Link
                            to="/clients/$clientId"
                            params={{ clientId: c.id }}
                            className="truncate text-[13px] font-semibold hover:underline"
                          >
                            {name}
                          </Link>
                          {compareMoney(c.overdue, '0') > 0 && (
                            <span className="text-[11.5px] text-blush-ink">
                              {t('ui.ws.billing.overdueAmount', { amount: money(c.overdue) })}
                            </span>
                          )}
                        </span>
                        <b className="num text-[13px]">{money(c.outstanding)}</b>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export function InvoiceList({
  clientId,
  views = false,
  overdue: overdueProp,
  onOverdueChange,
}: {
  clientId?: string;
  views?: boolean;
  overdue?: boolean;
  onOverdueChange?: (value: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const [overdueLocal, setOverdueLocal] = useState(false);
  const overdue = overdueProp ?? overdueLocal;
  const setOverdue = onOverdueChange ?? setOverdueLocal;
  const [search, setSearch] = useState('');
  const [mode, setMode] = useViewMode('invoices');
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
  const items = list.data?.items ?? [];
  const showCards = views && mode === 'cards';
  const body = (
    <>
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
      {items.length > 0 && showCards && (
        <CardGrid className={list.isPlaceholderData ? 'opacity-60' : ''}>
          {items.map((i) => (
            <InvoiceCard key={i.id} invoice={i} />
          ))}
        </CardGrid>
      )}
      {items.length > 0 && !showCards && (
        <div
          className={`overflow-x-auto transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}
        >
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
              {items.map((i) => {
                const name = locale === 'ar' ? i.client.name.ar : i.client.name.en;
                return (
                  <tr key={i.id} className="border-t border-line transition-colors hover:bg-frame">
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
                    <td className="py-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={name} initials={initialsOf(name)} size={26} />
                        {name}
                      </span>
                    </td>
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
                    <td className="py-3 text-end font-semibold tabular-nums">
                      {formatMoney(locale, i.outstanding, i.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
  if (clientId) return <Card>{body}</Card>;
  return (
    <section className="grid gap-3">
      <SectionTitle
        title={t('ui.ws.billing.register')}
        count={list.data?.items.length}
        action={
          views && (
            <ViewToggle
              label={t('ui.ws.view')}
              value={mode}
              onChange={setMode}
              cardsLabel={t('ui.ws.cards')}
              tableLabel={t('ui.ws.table')}
            />
          )
        }
      />
      <div className="ui-glass flex flex-wrap items-end gap-3 rounded-tile p-3">
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
      {showCards ? body : <Card>{body}</Card>}
    </section>
  );
}

/** One invoice as a card: client, amount, how much is paid, and when it is (or was) due. */
function InvoiceCard({ invoice: i }: { invoice: InvoiceSummary }) {
  const { t, locale } = useI18n();
  const name = locale === 'ar' ? i.client.name.ar : i.client.name.en;
  const paid = subtractMoney(i.total, i.outstanding);
  const open = i.status === 'issued' || i.status === 'partially_paid';
  const days = i.dueDate ? daysFromToday(i.dueDate) : null;
  return (
    <Link to="/invoices/$invoiceId" params={{ invoiceId: i.id }} className="block rounded-tile">
      <EntityCard
        accent={i.overdue ? 'blush' : ACCENT[i.status]}
        header={
          <div className="flex items-start gap-3">
            <Avatar name={name} initials={initialsOf(name)} size={38} />
            <div className="grid min-w-0 flex-1">
              <span className="truncate text-[13.5px] font-bold">{name}</span>
              <span className="text-[12px] text-ink-3" dir="ltr">
                {i.number ?? t('ui.billing.draftLabel')}
              </span>
            </div>
            <span className="flex flex-col items-end gap-1">
              <StatusChip
                status={INVOICE_CHIP[i.status]}
                label={t(`ui.billing.statusName.${i.status}`)}
              />
              {i.overdue && <StatusChip status="bad" label={t('ui.billing.overdue')} />}
            </span>
          </div>
        }
        footer={
          <span className={`flex items-center gap-1.5 ${i.overdue ? 'text-blush-ink' : ''}`}>
            <CalendarClock aria-hidden className="size-3.5" />
            {open && days !== null
              ? days < 0
                ? t('ui.ws.billing.lateBy', { count: -days })
                : t('ui.ws.billing.dueIn', { count: days })
              : i.dueDate
                ? t('ui.ws.billing.dueOn', { date: dateOf(locale, i.dueDate) })
                : t('ui.ws.billing.notIssued')}
          </span>
        }
      >
        <div className="grid gap-2">
          <b className="num text-[22px] leading-none font-extrabold tracking-tight">
            {formatMoney(locale, i.total, i.currency)}
          </b>
          {i.status !== 'draft' && i.status !== 'void' && (
            <>
              <Progress
                size="sm"
                label={t('ui.ws.billing.paidOf', { paid: formatMoney(locale, paid, i.currency) })}
                value={moneyRatio(paid, i.total)}
                max={1}
                tone={i.overdue ? 'bad' : i.status === 'paid' ? 'good' : 'warn'}
              />
              <span className="flex justify-between gap-2 text-[12px] text-ink-2">
                <span>
                  {t('ui.ws.billing.paidOf', { paid: formatMoney(locale, paid, i.currency) })}
                </span>
                {compareMoney(i.outstanding, '0') > 0 && (
                  <b className="num text-ink">
                    {t('ui.ws.billing.left', {
                      amount: formatMoney(locale, i.outstanding, i.currency),
                    })}
                  </b>
                )}
              </span>
            </>
          )}
        </div>
      </EntityCard>
    </Link>
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
