import { useMutation, useQuery } from '@tanstack/react-query';
import { acceptedResponseSchema, okResponseSchema } from '@ultimate-erp/contracts';
import { Button, LoadingState } from '@ultimate-erp/ui';
import { CircleCheck } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useI18n } from '../../app/i18n.js';
import { AuthLayout, FormError, LINK_CLASS } from '../../components/auth-layout.js';
import { api } from '../../lib/api.js';
import { useSearchParam } from '../../lib/use-search-param.js';

/** After sign-up: the answer is the same whether or not the address already had an account. */
export function CheckEmailPage() {
  const { t } = useI18n();
  const email = useSearchParam('email') ?? '';
  const returnTo = useSearchParam('returnTo');
  const resend = useMutation({
    mutationFn: () =>
      api('/auth/verify-email/resend', {
        method: 'POST',
        body: { email },
        schema: acceptedResponseSchema,
      }),
  });
  return (
    <AuthLayout
      title={t('ui.auth.checkEmailTitle')}
      footer={
        <Link className={LINK_CLASS} to="/sign-in" search={returnTo ? { returnTo } : {}}>
          {t('ui.auth.backToSignIn')}
        </Link>
      }
    >
      <p className="text-ink-2">{t('ui.auth.checkEmailBody', { email })}</p>
      {resend.isSuccess ? (
        <p role="status" className="text-[13px] font-medium text-mint-ink">
          {t('ui.auth.resent')}
        </p>
      ) : (
        <Button
          variant="secondary"
          loading={resend.isPending}
          onClick={() => {
            resend.mutate();
          }}
          disabled={!email}
        >
          {t('ui.auth.resend')}
        </Button>
      )}
      <FormError error={resend.error} />
    </AuthLayout>
  );
}

/** The link from the confirmation email lands here. */
export function VerifyEmailPage() {
  const { t } = useI18n();
  const token = useSearchParam('token') ?? '';
  const verification = useQuery({
    queryKey: ['verify-email', token],
    retry: false,
    queryFn: () =>
      api(`/auth/verify-email?token=${encodeURIComponent(token)}`, { schema: okResponseSchema }),
  });
  return (
    <AuthLayout
      title={verification.isSuccess ? t('ui.auth.verifiedTitle') : t('ui.auth.verifyingTitle')}
      footer={
        <Link className={LINK_CLASS} to="/sign-in">
          {t('ui.auth.signInSubmit')}
        </Link>
      }
    >
      {verification.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {verification.isSuccess && (
        <p role="status" className="flex items-center gap-2 text-ink-2">
          <CircleCheck aria-hidden className="size-5 text-mint-ink" />
          {t('ui.auth.verifiedBody')}
        </p>
      )}
      <FormError error={verification.error} />
    </AuthLayout>
  );
}
