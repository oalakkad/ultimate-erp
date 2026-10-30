import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { myAttendanceSchema } from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { Button, Card } from '@ultimate-erp/ui';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { useSearchParam } from '../../lib/use-search-param.js';

/** Opened by scanning the kiosk QR code: one tap records the check-in or check-out. */
export function ScanPage() {
  const { t, locale } = useI18n();
  const code = useSearchParam('code') ?? '';
  const check = useMutation({
    mutationFn: () =>
      api('/attendance/check', { method: 'POST', body: { code }, schema: myAttendanceSchema }),
  });
  const last = check.data?.events.at(-1);
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.attendance.scanTitle')} />
      <Card>
        {last ? (
          <p
            role="status"
            className="rounded-tile bg-mint p-4 text-[15px] font-semibold text-mint-ink"
          >
            {t(last.kind === 'in' ? 'ui.attendance.recordedIn' : 'ui.attendance.recordedOut', {
              time: formatDate(locale, new Date(last.at), { timeStyle: 'short' }),
            })}
          </p>
        ) : (
          <>
            <p className="text-[13.5px] text-ink-2">{t('ui.attendance.scanHint')}</p>
            <Button
              className="w-fit"
              loading={check.isPending}
              disabled={!code}
              onClick={() => {
                check.mutate();
              }}
            >
              {t('ui.attendance.confirmScan')}
            </Button>
          </>
        )}
        <FormError error={check.error} />
        <Link to="/attendance" className="text-[13px] font-semibold text-plum hover:underline">
          {t('ui.attendance.myAttendance')}
        </Link>
      </Card>
    </div>
  );
}
