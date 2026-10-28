import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { invitationPreviewResponseSchema, okResponseSchema } from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { Button, LoadingState } from '@ultimate-erp/ui';
import { useI18n } from '../app/i18n.js';
import { AuthLayout, FormError, LINK_CLASS } from '../components/auth-layout.js';
import { api } from '../lib/api.js';
import { useMe } from '../lib/session.js';
import { useSearchParam } from '../lib/use-search-param.js';

/** The link from an invitation email (on the company address). */
export function InvitationPage() {
  const { t, locale } = useI18n();
  const token = useSearchParam('token') ?? '';
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['invitation', token],
    retry: false,
    queryFn: () =>
      api(`/invitations/preview?token=${encodeURIComponent(token)}`, {
        schema: invitationPreviewResponseSchema,
      }),
  });
  const accept = useMutation({
    mutationFn: () =>
      api('/invitations/accept', { method: 'POST', body: { token }, schema: okResponseSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/' });
    },
  });
  const returnTo = `/invitations/accept?token=${encodeURIComponent(token)}`;
  const invite = preview.data;
  const company = invite ? (locale === 'ar' ? invite.company.ar : invite.company.en) : '';

  return (
    <AuthLayout title={t('ui.invitation.title')}>
      {preview.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      <FormError error={preview.error} />
      {invite && (
        <>
          <p className="text-[15px]">
            {t('ui.invitation.body', { company, role: t(`roles.${invite.role}`) })}
          </p>
          <p className="text-[13px] text-ink-2">
            {t('ui.invitation.forEmail', { email: invite.emailHint })}{' '}
            {t('ui.invitation.expires', {
              date: formatDate(locale, new Date(invite.expiresAt), { dateStyle: 'medium' }),
            })}
          </p>
          {me.data ? (
            <>
              <FormError error={accept.error} />
              <Button
                loading={accept.isPending}
                onClick={() => {
                  accept.mutate();
                }}
              >
                {t('ui.invitation.accept')}
              </Button>
            </>
          ) : (
            <div className="grid gap-2">
              <Link
                to="/sign-in"
                search={{ returnTo }}
                className="inline-flex h-10 items-center justify-center rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover"
              >
                {t('ui.invitation.signInToAccept')}
              </Link>
              <Link
                className={`${LINK_CLASS} text-center text-[13px]`}
                to="/sign-up"
                search={{ returnTo }}
              >
                {t('ui.invitation.createToAccept')}
              </Link>
            </div>
          )}
        </>
      )}
    </AuthLayout>
  );
}
