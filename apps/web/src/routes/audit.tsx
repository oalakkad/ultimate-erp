import { useInfiniteQuery } from '@tanstack/react-query';
import { auditListResponseSchema } from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
} from '@ultimate-erp/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { AppPageHeader } from '../components/page-header.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { useDebounced } from '../lib/use-debounced.js';

/** Areas of the trail people filter by: the first part of each recorded action. */
const AREAS = [
  'access',
  'auth',
  'clients',
  'contracts',
  'projects',
  'tasks',
  'time',
  'people',
  'leave',
  'attendance',
  'payroll',
  'billing',
  'expenses',
  'announcements',
  'reports',
  'files',
] as const;

/** Audit log (brief Module N): who did what and when, with filters and an audited export. */
export function AuditLogPage() {
  const { t, locale } = useI18n();
  const [area, setArea] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [requestId, setRequestId] = useState('');
  const reference = useDebounced(requestId.trim());
  const params = new URLSearchParams();
  if (area !== 'all') params.set('action', `${area}.`);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (reference) params.set('requestId', reference);
  const list = useInfiniteQuery({
    queryKey: ['audit', params.toString()],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const page = new URLSearchParams(params);
      if (pageParam) page.set('cursor', pageParam);
      return api(`/audit-events?${page.toString()}`, { schema: auditListResponseSchema });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.audit.title')}
        actions={
          <a
            href={`/api/v1/audit-events/export.csv?${params.toString()}`}
            className="inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame"
            download
          >
            <Download aria-hidden className="size-4" />
            {t('ui.reports.exportCsv')}
          </a>
        }
      />
      <Card>
        <p className="text-[13.5px] text-ink-2">{t('ui.audit.intro')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <SelectField
            label={t('ui.audit.area')}
            placeholder={t('ui.audit.allAreas')}
            value={area}
            onValueChange={setArea}
            options={[
              { value: 'all', label: t('ui.audit.allAreas') },
              ...AREAS.map((a) => ({ value: a, label: t(`ui.audit.areas.${a}`) })),
            ]}
          />
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
          <TextField
            label={t('ui.audit.reference')}
            dir="ltr"
            value={requestId}
            onChange={(e) => {
              setRequestId(e.target.value);
            }}
          />
        </div>
      </Card>
      <Card>
        {list.isPending && <LoadingState label={t('ui.common.loading')} lines={5} />}
        {list.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, list.error)}
            reference={errorReference(t, list.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void list.refetch()}
          />
        )}
        {list.isSuccess && items.length === 0 && (
          <EmptyState title={t('ui.audit.empty')} body={t('ui.audit.emptyBody')} />
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">{t('ui.audit.title')}</caption>
              <thead className="text-[12px] text-ink-3">
                <tr>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.audit.when')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.audit.who')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.audit.action')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.audit.reference')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t border-line align-top">
                    <td className="py-2 whitespace-nowrap text-ink-2">
                      {formatDate(locale, new Date(e.occurredAt), {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}
                    </td>
                    <td className="py-2">{e.actorName ?? t('ui.dashboard.system')}</td>
                    <td className="py-2">
                      <code dir="ltr" className="text-[12.5px] font-semibold">
                        {e.action}
                      </code>
                      {Object.keys(e.details).length > 0 && (
                        <small dir="ltr" className="block max-w-[46ch] truncate text-ink-3">
                          {JSON.stringify(e.details)}
                        </small>
                      )}
                    </td>
                    <td className="py-2">
                      <code dir="ltr" className="text-[12px] text-ink-3">
                        {e.requestId ?? '—'}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
          <Button
            variant="secondary"
            className="w-fit"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('ui.audit.older')}
          </Button>
        )}
      </Card>
    </div>
  );
}
