import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { taskTimeSchema } from '@ultimate-erp/contracts';
import { Card, ErrorState, LoadingState } from '@ultimate-erp/ui';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { hoursText } from '../projects/shared.js';

/** Planned (allocated) vs actual (logged / approved) per person on one task. */
export function TaskTimeCard({ taskId, canLog }: { taskId: string; canLog: boolean }) {
  const { t, locale } = useI18n();
  const time = useQuery({
    queryKey: ['time', 'task', taskId],
    queryFn: () => api(`/tasks/${taskId}/time`, { schema: taskTimeSchema }),
  });
  return (
    <Card
      title={t('ui.time.plannedVsActual')}
      action={
        canLog ? (
          <Link
            to="/time"
            search={{ taskId }}
            className="text-[13px] font-semibold text-plum hover:underline"
          >
            {t('ui.time.logTime')}
          </Link>
        ) : undefined
      }
    >
      {time.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {time.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, time.error)}
          reference={errorReference(t, time.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void time.refetch()}
        />
      )}
      {time.data && time.data.items.length > 0 && (
        <table className="w-full text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr>
              <th scope="col" className="py-1 text-start font-semibold">
                {t('ui.time.person')}
              </th>
              <th scope="col" className="py-1 text-end font-semibold">
                {t('ui.time.planned')}
              </th>
              <th scope="col" className="py-1 text-end font-semibold">
                {t('ui.time.logged')}
              </th>
              <th scope="col" className="py-1 text-end font-semibold">
                {t('ui.time.approved')}
              </th>
            </tr>
          </thead>
          <tbody>
            {time.data.items.map((r) => (
              <tr key={r.membershipId} className="border-t border-line">
                <td className="py-1.5">{r.name}</td>
                <td className="py-1.5 text-end tabular-nums">
                  {hoursText(locale, t, r.allocated)}
                </td>
                <td className="py-1.5 text-end tabular-nums">{hoursText(locale, t, r.logged)}</td>
                <td className="py-1.5 text-end tabular-nums">{hoursText(locale, t, r.approved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
