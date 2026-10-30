import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { kioskCodeSchema, siteListResponseSchema } from '@ultimate-erp/contracts';
import { ErrorState, LoadingState } from '@ultimate-erp/ui';
import QRCode from 'qrcode';
import { useI18n } from '../../app/i18n.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';

/**
 * Kiosk screen for a site (shown on a display at the office, signed in as an administrator).
 * The code changes every rotation; scanning it opens the check-in page on the person's phone.
 */
export function KioskPage() {
  const { t, locale } = useI18n();
  const { siteId } = useParams({ from: '/attendance/kiosk/$siteId' });
  const code = useQuery({
    queryKey: ['attendance', 'kiosk', siteId],
    queryFn: async () => {
      const current = await api(`/attendance/sites/${siteId}/code`, { schema: kioskCodeSchema });
      const link = `${window.location.origin}/attendance/scan?code=${encodeURIComponent(current.code)}`;
      return {
        ...current,
        link,
        image: await QRCode.toDataURL(link, { margin: 1, width: 480, errorCorrectionLevel: 'M' }),
      };
    },
    // Fetch the next code a moment after the current one expires.
    refetchInterval: (q) => Math.max(2, (q.state.data?.expiresInSeconds ?? 5) + 1) * 1000,
  });
  const sites = useQuery({
    queryKey: ['attendance', 'sites'],
    queryFn: () => api('/attendance/sites', { schema: siteListResponseSchema }),
  });
  const site = sites.data?.items.find((s) => s.id === siteId);
  return (
    <main className="grid min-h-screen place-items-center bg-ground p-6">
      <div className="grid w-full max-w-md justify-items-center gap-4 rounded-card bg-card p-8 text-center shadow-sm">
        <h1 className="text-[22px] font-bold">{t('ui.attendance.kioskTitle')}</h1>
        {site && (
          <p className="text-[15px] text-ink-2">{locale === 'ar' ? site.name.ar : site.name.en}</p>
        )}
        {code.isPending && <LoadingState label={t('ui.common.loading')} />}
        {code.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, code.error)}
            reference={errorReference(t, code.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void code.refetch()}
          />
        )}
        {code.data && (
          <>
            <img
              src={code.data.image}
              alt={t('ui.attendance.qrLabel')}
              className="w-72 max-w-full rounded-tile bg-white p-3"
            />
            <p className="text-[13.5px] text-ink-2">
              {t('ui.attendance.kioskHint', { seconds: code.data.rotationSeconds })}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
