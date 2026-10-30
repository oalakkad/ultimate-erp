import { useQuery } from '@tanstack/react-query';
import { payslipListResponseSchema } from '@ultimate-erp/contracts';
import { Card, EmptyState, ErrorState, LoadingState } from '@ultimate-erp/ui';
import { useI18n } from '../../app/i18n.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { PayrollWarning } from './payroll.js';
import { PayslipRow } from './run.js';

/** My payslips (only approved runs). */
export function MyPayslipsPage() {
  const { t } = useI18n();
  const list = useQuery({
    queryKey: ['payroll', 'payslips', 'mine'],
    queryFn: () => api('/payroll/payslips/mine', { schema: payslipListResponseSchema }),
  });
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.payroll.myPayslips')} />
      {list.data?.items.some((p) => p.run.testRun) && <PayrollWarning />}
      <Card>
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
          <EmptyState title={t('ui.payroll.noPayslips')} body={t('ui.payroll.noPayslipsBody')} />
        )}
        <ul className="grid gap-2">
          {list.data?.items.map((p) => (
            <PayslipRow key={p.id} payslip={p} showPerson={false} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
