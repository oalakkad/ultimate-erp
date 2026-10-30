import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { contractSchema, contractVersionListResponseSchema } from '@ultimate-erp/contracts';
import { Button, ErrorState, LoadingState } from '@ultimate-erp/ui';
import { Printer } from 'lucide-react';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { useTenant } from '../../lib/session.js';
import { dateText, kindLabel, moneyText } from './shared.js';

/**
 * Print view of the current version, English and Arabic side by side. The browser's
 * "Save as PDF" produces the PDF (it shapes Arabic correctly). docs/modules/contracts.md §9.
 */
export function ContractPrintPage() {
  const { t, locale } = useI18n();
  const { contractId } = useParams({ from: '/contracts/$contractId/print' });
  const tenant = useTenant();
  const contract = useQuery({
    queryKey: ['contracts', 'detail', contractId],
    queryFn: () => api(`/contracts/${contractId}`, { schema: contractSchema }),
  });
  const versions = useQuery({
    queryKey: ['contracts', contractId, 'versions', 'print'],
    queryFn: () =>
      api(`/contracts/${contractId}/versions`, { schema: contractVersionListResponseSchema }),
  });

  if (contract.isPending || versions.isPending)
    return (
      <div className="p-8">
        <LoadingState label={t('ui.common.loading')} />
      </div>
    );
  if (contract.isError || versions.isError) {
    const err = contract.error ?? versions.error;
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, err)}
          reference={errorReference(t, err)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => {
            void contract.refetch();
            void versions.refetch();
          }}
        />
      </div>
    );
  }
  const c = contract.data;
  const v = versions.data.items[0];
  return (
    <main className="mx-auto grid max-w-[900px] gap-6 bg-card p-8 text-ink print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button
          icon={<Printer aria-hidden className="size-4" />}
          onClick={() => {
            window.print();
          }}
        >
          {t('ui.contracts.print')}
        </Button>
        <small className="text-ink-3">{t('ui.contracts.printHint')}</small>
      </div>
      <header className="grid gap-1 border-b border-line pb-4">
        <b className="text-[13px] text-ink-3">
          {tenant.data ? (locale === 'ar' ? tenant.data.name.ar : tenant.data.name.en) : ''}
        </b>
        <h1 className="text-2xl font-bold">{locale === 'ar' ? c.title.ar : c.title.en}</h1>
        <p className="text-[13px] text-ink-2">
          <span dir="ltr">{c.number}</span> · {kindLabel(t, c.kind)}
          {v ? ` · ${t('ui.contracts.versionLabel', { n: v.versionNo })}` : ''}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-ink-3">{t('ui.contracts.fields.client')}</dt>
            <dd>{locale === 'ar' ? c.client.name.ar : c.client.name.en}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t('ui.contracts.fields.startDate')}</dt>
            <dd>{dateText(locale, c.startDate)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t('ui.contracts.fields.endDate')}</dt>
            <dd>{dateText(locale, c.endDate)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{t('ui.contracts.fields.valueAmount')}</dt>
            <dd>{moneyText(locale, c)}</dd>
          </div>
        </dl>
      </header>
      {v ? (
        <div className="grid gap-8 md:grid-cols-2 print:grid-cols-2">
          <section dir="ltr" lang="en" className="text-[14px] leading-relaxed whitespace-pre-wrap">
            {v.bodyEn}
          </section>
          <section dir="rtl" lang="ar" className="text-[14px] leading-relaxed whitespace-pre-wrap">
            {v.bodyAr}
          </section>
        </div>
      ) : (
        <p className="text-ink-2">{t('ui.contracts.noText')}</p>
      )}
      {c.paymentTerms && (
        <section className="border-t border-line pt-4 text-[13px]">
          <b>{t('ui.contracts.fields.paymentTerms')}</b>
          <p className="whitespace-pre-wrap">{c.paymentTerms}</p>
        </section>
      )}
    </main>
  );
}
