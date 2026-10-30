import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { invoiceSchema } from '@ultimate-erp/contracts';
import { formatMoney, translate } from '@ultimate-erp/i18n';
import { Button, ErrorState, LoadingState } from '@ultimate-erp/ui';
import { Printer } from 'lucide-react';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { useTenant } from '../../lib/session.js';
import { dateOf } from './invoices.js';

/**
 * Print view of an invoice with English and Arabic labels side by side; the browser's
 * "Save as PDF" makes the PDF (docs/modules/billing.md §10).
 */
export function InvoicePrintPage() {
  const { t } = useI18n();
  const { invoiceId } = useParams({ from: '/invoices/$invoiceId/print' });
  const tenant = useTenant();
  const invoice = useQuery({
    queryKey: ['invoices', 'detail', invoiceId],
    queryFn: () => api(`/invoices/${invoiceId}`, { schema: invoiceSchema }),
  });
  if (invoice.isPending)
    return (
      <div className="p-8">
        <LoadingState label={t('ui.common.loading')} />
      </div>
    );
  if (invoice.isError)
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, invoice.error)}
          reference={errorReference(t, invoice.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void invoice.refetch()}
        />
      </div>
    );
  const i = invoice.data;
  const both = (key: Parameters<typeof translate>[1]) => (
    <>
      <span dir="ltr" lang="en">
        {translate('en', key)}
      </span>
      <span aria-hidden> / </span>
      <span dir="rtl" lang="ar">
        {translate('ar', key)}
      </span>
    </>
  );
  const money = (v: string) => formatMoney('en', v, i.currency);
  return (
    <main className="mx-auto grid max-w-[900px] gap-6 bg-card p-8 text-ink print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button
          icon={<Printer aria-hidden className="size-4" />}
          onClick={() => {
            window.print();
          }}
        >
          {t('ui.billing.print')}
        </Button>
        <small className="text-ink-3">{t('ui.contracts.printHint')}</small>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div className="grid gap-1">
          <b className="text-[15px]">{tenant.data?.name.en}</b>
          <b className="text-[15px]" dir="rtl" lang="ar">
            {tenant.data?.name.ar}
          </b>
        </div>
        <div className="grid gap-1 text-end">
          <h1 className="text-2xl font-bold">
            {i.status === 'draft' ? both('ui.billing.draftLabel') : both('ui.billing.invoiceWord')}
          </h1>
          <p dir="ltr" className="text-[15px] font-semibold">
            {i.number ?? ''}
          </p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">{both('ui.billing.client')}</dt>
          <dd>
            {i.client.name.en}
            <br />
            <span dir="rtl" lang="ar">
              {i.client.name.ar}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{both('ui.billing.col.number')}</dt>
          <dd dir="ltr">{i.number ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{both('ui.billing.issueDate')}</dt>
          <dd>{dateOf('en', i.issueDate)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{both('ui.billing.col.due')}</dt>
          <dd>{dateOf('en', i.dueDate)}</dd>
        </div>
      </dl>
      <table className="w-full text-[13px]">
        <thead className="text-[12px] text-ink-3">
          <tr className="border-b border-line">
            <th scope="col" className="py-2 text-start font-semibold">
              {both('ui.billing.line.description')}
            </th>
            <th scope="col" className="py-2 text-end font-semibold">
              {both('ui.billing.line.quantity')}
            </th>
            <th scope="col" className="py-2 text-end font-semibold">
              {both('ui.billing.line.unitPrice')}
            </th>
            <th scope="col" className="py-2 text-end font-semibold">
              {both('ui.billing.line.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l) => (
            <tr key={l.id} className="border-b border-line">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-end tabular-nums">{l.quantity}</td>
              <td className="py-2 text-end tabular-nums">{money(l.unitPrice)}</td>
              <td className="py-2 text-end tabular-nums">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto grid w-full max-w-sm gap-1 text-[13.5px]">
        {(
          [
            ['subtotal', i.subtotal],
            ['discount', i.discountTotal],
            ['tax', i.taxTotal],
            ['total', i.total],
            ['outstanding', i.outstanding],
          ] as const
        ).map(([k, v]) => (
          <div
            key={k}
            className={`flex justify-between gap-2 ${k === 'total' ? 'border-t border-line pt-1 font-bold' : ''}`}
          >
            <dt>{both(`ui.billing.totals.${k}`)}</dt>
            <dd className="tabular-nums">{money(v)}</dd>
          </div>
        ))}
      </dl>
      {i.notes && <p className="whitespace-pre-line text-[13px] text-ink-2">{i.notes}</p>}
    </main>
  );
}
