import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  acceptedResponseSchema,
  emailOnlyRequestSchema,
  okResponseSchema,
  resetPasswordRequestSchema,
} from '@ultimate-erp/contracts';
import { Button, LoadingState, PasswordField, TextField } from '@ultimate-erp/ui';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Link } from '@tanstack/react-router';
import { useI18n } from '../../app/i18n.js';
import { AuthLayout, FormError, LINK_CLASS } from '../../components/auth-layout.js';
import { api } from '../../lib/api.js';
import { useSearchParam } from '../../lib/use-search-param.js';

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const form = useForm<z.input<typeof emailOnlyRequestSchema>>({
    resolver: zodResolver(emailOnlyRequestSchema),
    defaultValues: { email: '' },
  });
  const request = useMutation({
    mutationFn: (body: { email: string }) =>
      api('/auth/password/forgot', { method: 'POST', body, schema: acceptedResponseSchema }),
  });
  return (
    <AuthLayout
      title={t('ui.auth.forgotTitle')}
      footer={
        <Link className={LINK_CLASS} to="/sign-in">
          {t('ui.auth.backToSignIn')}
        </Link>
      }
    >
      {request.isSuccess ? (
        <p role="status" className="text-ink-2">
          {t('ui.auth.forgotSent', { email: form.getValues('email') })}
        </p>
      ) : (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) =>
            void form.handleSubmit((v) => {
              request.mutate(v);
            })(e)
          }
        >
          <p className="text-ink-2">{t('ui.auth.forgotBody')}</p>
          <TextField
            label={t('ui.auth.email')}
            type="email"
            autoComplete="email"
            error={form.formState.errors.email ? t('ui.validation.email') : undefined}
            {...form.register('email')}
          />
          <FormError error={request.error} />
          <Button type="submit" className="h-11" loading={request.isPending}>
            {t('ui.auth.forgotSubmit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

const resetFormSchema = z
  .object({ newPassword: resetPasswordRequestSchema.shape.newPassword, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'differs' });

/** The link from the reset email lands here; the link is checked before the form is shown. */
export function ResetPasswordPage() {
  const { t } = useI18n();
  const token = useSearchParam('token') ?? '';
  const check = useQuery({
    queryKey: ['reset-token', token],
    retry: false,
    queryFn: () =>
      api(`/auth/password/reset?token=${encodeURIComponent(token)}`, { schema: okResponseSchema }),
  });
  const form = useForm<z.input<typeof resetFormSchema>>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { newPassword: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (newPassword: string) =>
      api('/auth/password/reset', {
        method: 'POST',
        body: { token, newPassword },
        schema: okResponseSchema,
      }),
  });
  const errors = form.formState.errors;

  return (
    <AuthLayout
      title={t('ui.auth.resetTitle')}
      footer={
        <Link className={LINK_CLASS} to="/sign-in">
          {t('ui.auth.backToSignIn')}
        </Link>
      }
    >
      {check.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      <FormError error={check.error} />
      {reset.isSuccess && (
        <p role="status" className="text-ink-2">
          {t('ui.auth.resetDone')}
        </p>
      )}
      {check.isSuccess && !reset.isSuccess && (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) =>
            void form.handleSubmit((v) => {
              reset.mutate(v.newPassword);
            })(e)
          }
        >
          <PasswordField
            label={t('ui.auth.newPassword')}
            showLabel={t('ui.auth.showPassword')}
            hideLabel={t('ui.auth.hidePassword')}
            autoComplete="new-password"
            hint={t('ui.auth.passwordHint')}
            error={errors.newPassword ? t('ui.validation.passwordLength') : undefined}
            {...form.register('newPassword')}
          />
          <PasswordField
            label={t('ui.auth.confirmPassword')}
            showLabel={t('ui.auth.showPassword')}
            hideLabel={t('ui.auth.hidePassword')}
            autoComplete="new-password"
            error={errors.confirm ? t('ui.validation.passwordsDiffer') : undefined}
            {...form.register('confirm')}
          />
          <FormError error={reset.error} />
          <Button type="submit" className="h-11" loading={reset.isPending}>
            {t('ui.auth.resetSubmit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
