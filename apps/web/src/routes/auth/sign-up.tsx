import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { acceptedResponseSchema, signUpRequestSchema } from '@ultimate-erp/contracts';
import { Button, PasswordField, TextField } from '@ultimate-erp/ui';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';
import { useI18n } from '../../app/i18n.js';
import { AuthLayout, FormError, LINK_CLASS } from '../../components/auth-layout.js';
import { api } from '../../lib/api.js';
import { safeReturnTo } from '../../lib/navigation.js';
import { useSearchParam } from '../../lib/use-search-param.js';

export function SignUpPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const returnTo = safeReturnTo(useSearchParam('returnTo'));
  const form = useForm<z.input<typeof signUpRequestSchema>>({
    resolver: zodResolver(signUpRequestSchema),
    defaultValues: { name: '', email: '', password: '', locale },
  });
  const signUp = useMutation({
    mutationFn: (body: z.input<typeof signUpRequestSchema>) =>
      api('/auth/sign-up', {
        method: 'POST',
        body: { ...body, locale },
        schema: acceptedResponseSchema,
      }),
    onSuccess: (_result, body) =>
      navigate({
        to: '/check-email',
        search: { email: body.email, ...(returnTo ? { returnTo } : {}) },
      }),
  });
  const errors = form.formState.errors;

  return (
    <AuthLayout
      title={t('ui.auth.signUpTitle')}
      footer={
        <span>
          {t('ui.auth.haveAccount')}{' '}
          <Link className={LINK_CLASS} to="/sign-in" search={returnTo ? { returnTo } : {}}>
            {t('ui.auth.signInSubmit')}
          </Link>
        </span>
      }
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) =>
          void form.handleSubmit((v) => {
            signUp.mutate(v);
          })(e)
        }
      >
        <TextField
          label={t('ui.auth.name')}
          autoComplete="name"
          error={errors.name ? t('ui.validation.required') : undefined}
          {...form.register('name')}
        />
        <TextField
          label={t('ui.auth.email')}
          type="email"
          autoComplete="email"
          error={errors.email ? t('ui.validation.email') : undefined}
          {...form.register('email')}
        />
        <PasswordField
          label={t('ui.auth.password')}
          showLabel={t('ui.auth.showPassword')}
          hideLabel={t('ui.auth.hidePassword')}
          autoComplete="new-password"
          hint={t('ui.auth.passwordHint')}
          error={errors.password ? t('ui.validation.passwordLength') : undefined}
          {...form.register('password')}
        />
        <FormError error={signUp.error} />
        <Button type="submit" className="h-11" loading={signUp.isPending}>
          {t('ui.auth.signUpSubmit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
