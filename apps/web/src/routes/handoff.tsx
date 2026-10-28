import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { signInResponseSchema } from '@ultimate-erp/contracts';
import { LoadingState } from '@ultimate-erp/ui';
import { useEffect, useRef } from 'react';
import { useI18n } from '../app/i18n.js';
import { AuthLayout, FormError, LINK_CLASS } from '../components/auth-layout.js';
import { api } from '../lib/api.js';
import { useSearchParam } from '../lib/use-search-param.js';

/** Company address: exchanges the one-time ticket for a session here, then opens the app. */
export function HandoffPage() {
  const { t, locale, setLocale } = useI18n();
  const ticket = useSearchParam('ticket') ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const redeem = useMutation({
    mutationFn: () =>
      api('/auth/handoff/redeem', {
        method: 'POST',
        body: { ticket },
        schema: signInResponseSchema,
      }),
    onSuccess: async (result) => {
      if (result.status === 'signed_in' && result.user.locale !== locale)
        setLocale(result.user.locale);
      await queryClient.invalidateQueries();
      // replace: the ticket must not stay in the browser history.
      await navigate({ to: '/', replace: true });
    },
  });
  // Single use: StrictMode runs effects twice in development, so guard against a second call.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    redeem.mutate();
  }, [redeem]);

  if (redeem.isError) {
    return (
      <AuthLayout
        title={t('ui.handoff.failedTitle')}
        footer={
          <Link className={LINK_CLASS} to="/sign-in">
            {t('ui.auth.signInSubmit')}
          </Link>
        }
      >
        <p className="text-ink-2">{t('ui.handoff.failedBody')}</p>
        <FormError error={redeem.error} />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={t('ui.handoff.working')}>
      <LoadingState label={t('ui.handoff.working')} lines={2} />
    </AuthLayout>
  );
}
