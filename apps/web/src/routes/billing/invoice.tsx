import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  billingSettingsSchema,
  clientListResponseSchema,
  type Invoice,
  invoiceSchema,
  PAYMENT_METHODS,
  projectListResponseSchema,
} from '@ultimate-erp/contracts';
import { formatMoney } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { dateOf, INVOICE_CHIP } from './invoices.js';

type Line = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxCode: string;
};
const blank = (): Line => ({
  description: '',
  quantity: '1',
  unitPrice: '',
  discountPercent: '0',
  taxCode: 'none',
});
const kuwaitToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function LinesEditor({ lines, onChange }: { lines: Line[]; onChange: (l: Line[]) => void }) {
  const { t } = useI18n();
  const settings = useQuery({
    queryKey: ['billing', 'settings'],
    queryFn: () => api('/billing/settings', { schema: billingSettingsSchema }),
  });
  const taxes = (settings.data?.taxes ?? []).filter((x) => x.active);
  const update = (i: number, patch: Partial<Line>) => {
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  return (
    <div className="grid gap-3">
      {lines.map((l, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-tile bg-frame p-3 sm:grid-cols-[3fr_1fr_1.3fr_1fr_1.2fr_auto] sm:items-end"
        >
          <TextField
            label={t('ui.billing.line.description')}
            value={l.description}
            onChange={(e) => {
              update(i, { description: e.target.value });
            }}
          />
          <TextField
            label={t('ui.billing.line.quantity')}
            inputMode="decimal"
            dir="ltr"
            value={l.quantity}
            onChange={(e) => {
              update(i, { quantity: e.target.value });
            }}
          />
          <TextField
            label={t('ui.billing.line.unitPrice')}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.000"
            value={l.unitPrice}
            onChange={(e) => {
              update(i, { unitPrice: e.target.value });
            }}
          />
          <TextField
            label={t('ui.billing.line.discount')}
            inputMode="decimal"
            dir="ltr"
            value={l.discountPercent}
            onChange={(e) => {
              update(i, { discountPercent: e.target.value });
            }}
          />
          <SelectField
            label={t('ui.billing.line.tax')}
            placeholder={t('ui.billing.noTax')}
            value={l.taxCode}
            onValueChange={(v) => {
              update(i, { taxCode: v });
            }}
            options={[
              { value: 'none', label: t('ui.billing.noTax') },
              ...taxes.map((x) => ({ value: x.code, label: `${x.label} ${x.ratePercent}%` })),
            ]}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(lines.filter((_, j) => j !== i));
            }}
          >
            {t('ui.people.remove')}
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={() => {
          onChange([...lines, blank()]);
        }}
      >
        {t('ui.billing.addLine')}
      </Button>
    </div>
  );
}
const toBody = (lines: Line[]) =>
  lines
    .filter((l) => l.description.trim() && l.unitPrice.trim())
    .map((l) => ({
      description: l.description.trim(),
      quantity: l.quantity.trim() || '1',
      unitPrice: l.unitPrice.trim(),
      discountPercent: l.discountPercent.trim() || '0',
      taxCode: l.taxCode === 'none' ? null : l.taxCode,
    }));

/** New invoice: lines by hand, or a draft from a project's approved billable time. */
export function NewInvoicePage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(useSearchParam('clientId') ?? '');
  const [projectId, setProjectId] = useState('none');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState({
    from: daysAgo(30),
    to: kuwaitToday(),
    rate: '',
    expenses: true,
  });
  const clients = useQuery({
    queryKey: ['clients', 'picker'],
    queryFn: () => api('/clients?limit=100&sort=name', { schema: clientListResponseSchema }),
  });
  const projects = useQuery({
    queryKey: ['projects', 'client', clientId],
    enabled: Boolean(clientId),
    queryFn: () =>
      api(`/projects?clientId=${clientId}&limit=100`, { schema: projectListResponseSchema }),
  });
  const done = async (inv: Invoice) => {
    await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: inv.id } });
  };
  const create = useMutation({
    mutationFn: () =>
      api('/invoices', {
        method: 'POST',
        body: {
          clientId,
          projectId: projectId === 'none' ? null : projectId,
          notes,
          lines: toBody(lines),
        },
        schema: invoiceSchema,
      }),
    onSuccess: done,
  });
  const fromTime = useMutation({
    mutationFn: () =>
      api('/invoices/from-time', {
        method: 'POST',
        body: {
          projectId,
          from: time.from,
          to: time.to,
          hourlyRate: time.rate.trim(),
          includeExpenses: time.expenses,
        },
        schema: invoiceSchema,
      }),
    onSuccess: done,
  });
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.billing.new')} />
      <Card>
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            label={t('ui.billing.client')}
            placeholder={t('ui.billing.client')}
            value={clientId}
            onValueChange={(v) => {
              setClientId(v);
              setProjectId('none');
            }}
            options={(clients.data?.items ?? []).map((c) => ({
              value: c.id,
              label: `${c.number} · ${locale === 'ar' ? c.legalName.ar : c.legalName.en}`,
            }))}
          />
          <SelectField
            label={t('ui.billing.project')}
            placeholder={t('ui.billing.noProject')}
            value={projectId}
            onValueChange={setProjectId}
            options={[
              { value: 'none', label: t('ui.billing.noProject') },
              ...(projects.data?.items ?? []).map((p) => ({
                value: p.id,
                label: `${p.number} · ${locale === 'ar' ? p.name.ar : p.name.en}`,
              })),
            ]}
          />
        </div>
      </Card>
      {projectId !== 'none' && (
        <Card title={t('ui.billing.fromTimeTitle')}>
          <small className="text-ink-3">{t('ui.billing.fromTimeHint')}</small>
          <form
            noValidate
            className="grid gap-2 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              fromTime.mutate();
            }}
          >
            <TextField
              label={t('ui.billing.from')}
              type="date"
              value={time.from}
              onChange={(e) => {
                setTime({ ...time, from: e.target.value });
              }}
            />
            <TextField
              label={t('ui.billing.to')}
              type="date"
              value={time.to}
              onChange={(e) => {
                setTime({ ...time, to: e.target.value });
              }}
            />
            <TextField
              label={t('ui.billing.hourlyRate')}
              inputMode="decimal"
              dir="ltr"
              placeholder="0.000"
              value={time.rate}
              onChange={(e) => {
                setTime({ ...time, rate: e.target.value });
              }}
            />
            <Button type="submit" loading={fromTime.isPending} disabled={!time.rate.trim()}>
              {t('ui.billing.draftFromTime')}
            </Button>
          </form>
          <Checkbox
            label={t('ui.billing.includeExpenses')}
            checked={time.expenses}
            onCheckedChange={(on) => {
              setTime({ ...time, expenses: on });
            }}
          />
          <FormError error={fromTime.error} />
        </Card>
      )}
      <Card title={t('ui.billing.linesTitle')}>
        <LinesEditor lines={lines} onChange={setLines} />
        <TextArea
          label={t('ui.billing.notes')}
          rows={2}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
        <FormError error={create.error} />
        <Button
          className="w-fit"
          loading={create.isPending}
          disabled={!clientId || toBody(lines).length === 0}
          onClick={() => {
            create.mutate();
          }}
        >
          {t('ui.billing.saveDraft')}
        </Button>
      </Card>
    </div>
  );
}

/** One invoice: lines, totals, workflow, payments and credit notes. */
export function InvoicePage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { invoiceId } = useParams({ from: '/app/invoices/$invoiceId' });
  const key = ['invoices', 'detail', invoiceId];
  const invoice = useQuery({
    queryKey: key,
    queryFn: () => api(`/invoices/${invoiceId}`, { schema: invoiceSchema }),
  });
  const [dialog, setDialog] = useState<'pay' | 'credit' | 'void' | 'reverse' | null>(null);
  const [form, setForm] = useState({
    amount: '',
    receivedOn: kuwaitToday(),
    method: 'bank_transfer',
    reference: '',
    reason: '',
    paymentId: '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
  };
  const act = useMutation({
    mutationFn: async (action: 'issue' | 'delete' | 'pay' | 'credit' | 'void' | 'reverse') => {
      if (action === 'delete') {
        await api(`/invoices/${invoiceId}`, { method: 'DELETE' });
        return null;
      }
      const path = {
        issue: `/invoices/${invoiceId}/issue`,
        pay: `/invoices/${invoiceId}/payments`,
        credit: `/invoices/${invoiceId}/credit-notes`,
        void: `/invoices/${invoiceId}/void`,
        reverse: `/payments/${form.paymentId}/reverse`,
      }[action];
      const body = {
        issue: {},
        pay: {
          amount: form.amount.trim(),
          receivedOn: form.receivedOn,
          method: form.method,
          reference: form.reference,
        },
        credit: { amount: form.amount.trim(), reason: form.reason },
        void: { reason: form.reason },
        reverse: { reason: form.reason },
      }[action];
      return api(path, { method: 'POST', body, schema: invoiceSchema });
    },
    onSuccess: async (data, action) => {
      toast({ tone: 'good', title: t(`ui.billing.done.${action}`) });
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (data) queryClient.setQueryData(key, data);
      else await navigate({ to: '/invoices' });
    },
  });
  if (invoice.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (invoice.isError)
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, invoice.error)}
        reference={errorReference(t, invoice.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void invoice.refetch()}
      />
    );
  const i = invoice.data;
  const money = (v: string) => formatMoney(locale, v, i.currency);
  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={i.number ?? t('ui.billing.draftLabel')}
        actions={
          <a
            href={`/invoices/${i.id}/print`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame"
          >
            <Printer aria-hidden className="size-4" />
            {t('ui.billing.print')}
          </a>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <Link
          to="/clients/$clientId"
          params={{ clientId: i.client.id }}
          className="font-semibold text-plum hover:underline"
        >
          {locale === 'ar' ? i.client.name.ar : i.client.name.en}
        </Link>
        {i.project && (
          <span>
            · <span dir="ltr">{i.project.number}</span>
          </span>
        )}
        <StatusChip
          status={INVOICE_CHIP[i.status]}
          label={t(`ui.billing.statusName.${i.status}`)}
        />
        {i.overdue && <StatusChip status="bad" label={t('ui.billing.overdue')} />}
        {i.issueDate && (
          <span>· {t('ui.billing.issuedOn', { date: dateOf(locale, i.issueDate) })}</span>
        )}
        {i.dueDate && <span>· {t('ui.billing.dueOn', { date: dateOf(locale, i.dueDate) })}</span>}
      </div>
      {i.voidReason && (
        <p role="status" className="rounded-tile bg-blush p-3 text-[13.5px] text-blush-ink">
          {t('ui.billing.voidedBecause', { reason: i.voidReason })}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <Card title={t('ui.billing.linesTitle')}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead className="text-[12px] text-ink-3">
                  <tr>
                    {(
                      ['description', 'quantity', 'unitPrice', 'discount', 'tax', 'amount'] as const
                    ).map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={`py-2 font-semibold ${c === 'description' ? 'text-start' : 'text-end'}`}
                      >
                        {t(`ui.billing.line.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {i.lines.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="py-2">{l.description}</td>
                      <td className="py-2 text-end tabular-nums">{l.quantity}</td>
                      <td className="py-2 text-end tabular-nums">{money(l.unitPrice)}</td>
                      <td className="py-2 text-end tabular-nums">
                        {l.discountPercent === '0' ? '—' : `${l.discountPercent}%`}
                      </td>
                      <td className="py-2 text-end tabular-nums">
                        {l.tax === '0.000' ? '—' : money(l.tax)}
                      </td>
                      <td className="py-2 text-end tabular-nums">{money(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {i.timeEntries > 0 && (
              <small className="text-ink-3">
                {t('ui.billing.fromEntries', { count: i.timeEntries })}
              </small>
            )}
            {i.expenseLines > 0 && (
              <small className="text-ink-3">
                {t('ui.billing.fromExpenses', { count: i.expenseLines })}
              </small>
            )}
            {i.notes && <p className="whitespace-pre-line text-[13.5px] text-ink-2">{i.notes}</p>}
          </Card>
          {(i.payments.length > 0 || i.creditNotes.length > 0) && (
            <Card title={t('ui.billing.paymentsTitle')}>
              <ul className="grid gap-2 text-[13.5px]">
                {i.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
                  >
                    <span className="min-w-0 flex-1">
                      {dateOf(locale, p.receivedOn)} · {t(`ui.billing.method.${p.method}`)}
                      {p.reference ? ` · ${p.reference}` : ''}
                      <small className="block text-ink-3">
                        {t(
                          p.source === 'provider'
                            ? 'ui.billing.providerConfirmed'
                            : 'ui.billing.recordedByStaff',
                        )}
                        {p.reverseReason
                          ? ` · ${t('ui.billing.reversedBecause', { reason: p.reverseReason })}`
                          : ''}
                      </small>
                    </span>
                    <b
                      className={`tabular-nums ${p.status === 'reversed' ? 'line-through text-ink-3' : ''}`}
                    >
                      {money(p.amount)}
                    </b>
                    {p.status === 'recorded' && i.actions.includes('pay') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          act.reset();
                          setForm({ ...form, paymentId: p.id, reason: '' });
                          setDialog('reverse');
                        }}
                      >
                        {t('ui.billing.reverse')}
                      </Button>
                    )}
                  </li>
                ))}
                {i.creditNotes.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span dir="ltr">{c.number}</span> · {dateOf(locale, c.issuedOn)} · {c.reason}
                    </span>
                    <b className="tabular-nums">−{money(c.amount)}</b>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card title={t('ui.billing.totalsTitle')}>
          <dl className="grid gap-1.5 text-[13.5px]">
            {(
              [
                ['subtotal', i.subtotal],
                ['discount', i.discountTotal],
                ['tax', i.taxTotal],
                ['total', i.total],
                ['paid', i.paidTotal],
                ['credited', i.creditedTotal],
                ['outstanding', i.outstanding],
              ] as const
            ).map(([k, v]) => (
              <div
                key={k}
                className={`flex justify-between gap-2 ${k === 'total' || k === 'outstanding' ? 'font-bold' : ''}`}
              >
                <dt>{t(`ui.billing.totals.${k}`)}</dt>
                <dd className="tabular-nums">{money(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-2">
            {i.actions.includes('issue') && (
              <Button
                loading={act.isPending && act.variables === 'issue'}
                onClick={() => {
                  act.mutate('issue');
                }}
              >
                {t('ui.billing.issue')}
              </Button>
            )}
            {i.actions.includes('pay') && (
              <Button
                onClick={() => {
                  act.reset();
                  setForm({ ...form, amount: i.outstanding, reason: '' });
                  setDialog('pay');
                }}
              >
                {t('ui.billing.recordPayment')}
              </Button>
            )}
            {i.actions.includes('credit') && (
              <Button
                variant="secondary"
                onClick={() => {
                  act.reset();
                  setForm({ ...form, amount: '', reason: '' });
                  setDialog('credit');
                }}
              >
                {t('ui.billing.creditNote')}
              </Button>
            )}
            {i.actions.includes('void') && (
              <Button
                variant="secondary"
                onClick={() => {
                  act.reset();
                  setForm({ ...form, reason: '' });
                  setDialog('void');
                }}
              >
                {t('ui.billing.voidInvoice')}
              </Button>
            )}
            {i.actions.includes('delete') && (
              <Button
                variant="ghost"
                onClick={() => {
                  act.mutate('delete');
                }}
              >
                {t('ui.billing.deleteDraft')}
              </Button>
            )}
          </div>
          {!dialog && <FormError error={act.error} />}
        </Card>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        title={dialog ? t(`ui.billing.dialog.${dialog}`) : ''}
        description={dialog === 'pay' ? t('ui.billing.recordedHint') : undefined}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (dialog) act.mutate(dialog);
          }}
        >
          {(dialog === 'pay' || dialog === 'credit') && (
            <TextField
              label={t('ui.billing.amount')}
              inputMode="decimal"
              dir="ltr"
              value={form.amount}
              onChange={set('amount')}
            />
          )}
          {dialog === 'pay' && (
            <>
              <TextField
                label={t('ui.billing.receivedOn')}
                type="date"
                max={kuwaitToday()}
                value={form.receivedOn}
                onChange={set('receivedOn')}
              />
              <SelectField
                label={t('ui.billing.methodLabel')}
                placeholder={t('ui.billing.methodLabel')}
                value={form.method}
                onValueChange={(v) => {
                  setForm({ ...form, method: v });
                }}
                options={PAYMENT_METHODS.map((m) => ({
                  value: m,
                  label: t(`ui.billing.method.${m}`),
                }))}
              />
              <TextField
                label={t('ui.billing.reference')}
                value={form.reference}
                onChange={set('reference')}
              />
            </>
          )}
          {(dialog === 'credit' || dialog === 'void' || dialog === 'reverse') && (
            <TextArea
              label={t('ui.billing.reason')}
              rows={2}
              value={form.reason}
              onChange={set('reason')}
            />
          )}
          <FormError error={act.error} />
          <Button
            type="submit"
            className="w-fit"
            loading={act.isPending}
            disabled={
              (dialog !== 'pay' && !form.reason.trim()) ||
              ((dialog === 'pay' || dialog === 'credit') && !form.amount.trim())
            }
          >
            {dialog ? t(`ui.billing.dialog.${dialog}`) : ''}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
