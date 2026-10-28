import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  backupCodeRequestSchema,
  signInRequestSchema,
  signInResponseSchema,
  twoFactorVerifyRequestSchema,
  type User,
} from '@ultimate-erp/contracts';
import { Button, Checkbox, TextField } from '@ultimate-erp/ui';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { type z } from 'zod';
import { useI18n } from '../../app/i18n.js';
import { AuthLayout, FormError, LINK_CLASS } from '../../components/auth-layout.js';
import { api } from '../../lib/api.js';
import { safeReturnTo } from '../../lib/navigation.js';
import { useTenant } from '../../lib/session.js';
import { useSearchParam } from '../../lib/use-search-param.js';

type Step = 'password' | 'code' | 'backup';

export function SignInPage() {
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tenant = useTenant().data;
  const returnTo = safeReturnTo(useSearchParam('returnTo'));
  const [step, setStep] = useState<Step>('password');

  const finish = async (user: User) => {
    // A saved language choice always wins (owner decision 2026-10-28).
    if (user.locale !== locale) setLocale(user.locale);
    await queryClient.invalidateQueries();
    // returnTo may carry a query string (an invitation token), so it is navigated to as an href.
    await (returnTo ? navigate({ href: returnTo }) : navigate({ to: tenant ? '/' : '/companies' }));
  };

  const passwordForm = useForm<z.input<typeof signInRequestSchema>>({
    resolver: zodResolver(signInRequestSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });
  const signIn = useMutation({
    mutationFn: (body: z.input<typeof signInRequestSchema>) =>
      api('/auth/sign-in', { method: 'POST', body, schema: signInResponseSchema }),
    onSuccess: (result) => {
      if (result.status === 'two_factor_required') setStep('code');
      else void finish(result.user);
    },
  });

  const codeForm = useForm<z.input<typeof twoFactorVerifyRequestSchema>>({
    resolver: zodResolver(
      step === 'backup' ? backupCodeRequestSchema : twoFactorVerifyRequestSchema,
    ),
    defaultValues: { code: '', trustDevice: false },
  });
  const verify = useMutation({
    mutationFn: (body: z.input<typeof twoFactorVerifyRequestSchema>) =>
      api(step === 'backup' ? '/auth/two-factor/verify-backup-code' : '/auth/two-factor/verify', {
        method: 'POST',
        body,
        schema: signInResponseSchema,
      }),
    onSuccess: (result) => {
      if (result.status === 'signed_in') void finish(result.user);
    },
  });

  const companyName = tenant ? (locale === 'ar' ? tenant.name.ar : tenant.name.en) : undefined;

  if (step !== 'password') {
    const errors = codeForm.formState.errors;
    return (
      <AuthLayout title={t('ui.auth.twoFactorTitle')}>
        <p className="text-ink-2">{t('ui.auth.twoFactorBody')}</p>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) =>
            void codeForm.handleSubmit((values) => {
              verify.mutate(values);
            })(e)
          }
        >
          <TextField
            label={step === 'backup' ? t('ui.auth.backupCode') : t('ui.auth.code')}
            autoComplete="one-time-code"
            inputMode={step === 'backup' ? 'text' : 'numeric'}
            autoFocus
            error={errors.code ? t('ui.validation.code') : undefined}
            {...codeForm.register('code')}
          />
          <Controller
            control={codeForm.control}
            name="trustDevice"
            render={({ field }) => (
              <div className="grid gap-1">
                <Checkbox
                  label={t('ui.auth.trustDevice')}
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
                <span className="ps-[30px] text-xs text-ink-3">{t('ui.auth.trustDeviceHint')}</span>
              </div>
            )}
          />
          <FormError error={verify.error} />
          <Button type="submit" loading={verify.isPending}>
            {t('ui.auth.verify')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              codeForm.reset();
              verify.reset();
              setStep(step === 'backup' ? 'code' : 'backup');
            }}
          >
            {step === 'backup' ? t('ui.auth.useAuthenticator') : t('ui.auth.useBackupCode')}
          </Button>
        </form>
      </AuthLayout>
    );
  }

  const errors = passwordForm.formState.errors;
  return (
    <AuthLayout
      title={
        companyName ? t('ui.auth.signInTo', { company: companyName }) : t('ui.auth.signInTitle')
      }
      footer={
        <>
          <span>
            {t('ui.auth.noAccount')}{' '}
            <Link className={LINK_CLASS} to="/sign-up" search={returnTo ? { returnTo } : {}}>
              {t('ui.auth.createAccount')}
            </Link>
          </span>
          <Link className={LINK_CLASS} to="/forgot-password">
            {t('ui.auth.forgot')}
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) =>
          void passwordForm.handleSubmit((values) => {
            signIn.mutate(values);
          })(e)
        }
      >
        <TextField
          label={t('ui.auth.email')}
          type="email"
          autoComplete="email"
          error={errors.email ? t('ui.validation.email') : undefined}
          {...passwordForm.register('email')}
        />
        <TextField
          label={t('ui.auth.password')}
          type="password"
          autoComplete="current-password"
          error={errors.password ? t('ui.validation.required') : undefined}
          {...passwordForm.register('password')}
        />
        <FormError error={signIn.error} />
        <Button type="submit" loading={signIn.isPending}>
          {t('ui.auth.signInSubmit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
