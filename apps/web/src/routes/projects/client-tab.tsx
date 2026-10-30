import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { projectListResponseSchema } from '@ultimate-erp/contracts';
import { Card, EmptyState, ErrorState, LoadingState } from '@ultimate-erp/ui';
import { Plus } from 'lucide-react';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { dateText } from '../contracts/shared.js';
import { hoursText, ProjectStatusChip } from './shared.js';

/** "Projects" tab on a client page: that client's engagements. */
export function ClientProjectsTab({
  clientId,
  canCreate,
}: {
  clientId: string;
  canCreate: boolean;
}) {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ['projects', 'client', clientId],
    queryFn: () =>
      api(`/projects?clientId=${clientId}&limit=100`, { schema: projectListResponseSchema }),
  });
  return (
    <Card
      action={
        canCreate ? (
          <Link
            to="/projects/new"
            search={{ clientId }}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-plum hover:underline"
          >
            <Plus aria-hidden className="size-4" />
            {t('ui.projects.newForClient')}
          </Link>
        ) : undefined
      }
    >
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
        <EmptyState title={t('ui.projects.empty')} body={t('ui.projects.emptyBody')} />
      )}
      <ul className="grid gap-2">
        {list.data?.items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3">
            <div className="grid min-w-0 flex-1">
              <Link
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                className="font-semibold hover:underline"
              >
                {locale === 'ar' ? p.name.ar : p.name.en}
              </Link>
              <small className="text-ink-3">
                <span dir="ltr">{p.number}</span> · {hoursText(locale, t, p.budgetHours)} ·{' '}
                {dateText(locale, p.endDate)}
              </small>
            </div>
            <ProjectStatusChip status={p.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
