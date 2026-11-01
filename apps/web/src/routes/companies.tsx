import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { createCompanyRequestSchema, createCompanyResponseSchema } from '@ultimate-erp/contracts';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
} from '@ultimate-erp/ui';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { type z } from 'zod';
import { useI18n } from '../app/i18n.js';
import { AuthLayout, FormError } from '../components/auth-layout.js';
import { api } from '../lib/api.js';
import { openCompany } from '../lib/handoff.js';
import { errorReference, errorText } from '../lib/errors.js';
import { useMe, useMyCompanies } from '../lib/session.js';
import { usePlatformAccess } from './platform.js';

/** Main address after sign-in: pick a company or create one. */
export function CompaniesPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const companies = useMyCompanies(Boolean(me.data));
  const platform = usePlatformAccess(Boolean(me.data));
  const queryClient = useQueryClient();
  const open = useMutation({ mutationFn: openCompany });

  const form = useForm<z.input<typeof createCompanyRequestSchema>>({
    resolver: zodResolver(createCompanyRequestSchema),
    defaultValues: { slug: '', nameEn: '', nameAr: '', defaultLocale: locale },
  });
  const create = useMutation({
    mutationFn: async (body: z.input<typeof createCompanyRequestSchema>) => {
      const company = await api('/companies', {
        method: 'POST',
        body,
        schema: createCompanyResponseSchema,
      });
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      await openCompany(company.tenantId);
    },
  });

  const slug = useWatch({ control: form.control, name: 'slug' });

  if (me.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (!me.data) return <Navigate to="/sign-in" search={{ returnTo: '/companies' }} />;

  const errors = form.formState.errors;
  const host = window.location.host.replace(/^[^.]+\.(?=localhost)/, '');

  return (
    <AuthLayout title={t('ui.companies.title')}>
      {companies.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {companies.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, companies.error)}
          reference={errorReference(t, companies.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void companies.refetch()}
        />
      )}
      {companies.data?.companies.length === 0 && (
        <EmptyState title={t('ui.companies.empty')} body={t('ui.companies.createBody')} />
      )}
      <ul className="grid gap-2">
        {companies.data?.companies.map((company) => {
          const name = locale === 'ar' ? company.name.ar : company.name.en;
          return (
            <li
              key={company.tenantId}
              className="flex items-center gap-3 rounded-tile bg-frame p-3"
            >
              <Avatar name={name} initials={name.slice(0, 2).toUpperCase()} size={40} />
              <div className="min-w-0 flex-1">
                <b className="block truncate">{name}</b>
                <small className="block truncate text-ink-3" dir="ltr">
                  {company.url.replace(/^https?:\/\//, '')}
                </small>
              </div>
              <Button
                size="sm"
                loading={open.isPending && open.variables === company.tenantId}
                icon={<ArrowRight aria-hidden className="mirror size-4" />}
                onClick={() => {
                  open.mutate(company.tenantId);
                }}
              >
                {t('ui.companies.open')}
              </Button>
            </li>
          );
        })}
      </ul>
      <FormError error={open.error} />
      {platform.data?.founder && (
        <Link
          to="/platform"
          className="flex items-center gap-3 rounded-tile bg-plum-soft p-3 text-plum hover:bg-lilac"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-ctl bg-card">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block">{t('ui.platform.title')}</b>
            <small className="block text-[12px] opacity-80">{t('ui.platform.linkBody')}</small>
          </span>
          <ArrowRight aria-hidden className="mirror size-4" />
        </Link>
      )}

      <Card title={t('ui.companies.createTitle')} className="bg-frame shadow-none">
        <p className="text-[13px] text-ink-2">{t('ui.companies.createBody')}</p>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) =>
            void form.handleSubmit((v) => {
              create.mutate(v);
            })(e)
          }
        >
          <TextField
            label={t('ui.companies.nameEn')}
            error={errors.nameEn ? t('ui.validation.required') : undefined}
            {...form.register('nameEn')}
          />
          <TextField
            label={t('ui.companies.nameAr')}
            dir="rtl"
            lang="ar"
            error={errors.nameAr ? t('ui.validation.required') : undefined}
            {...form.register('nameAr')}
          />
          <TextField
            label={t('ui.companies.slug')}
            dir="ltr"
            autoCapitalize="none"
            hint={t('ui.companies.slugHint', { address: `${slug || '…'}.${host}` })}
            error={errors.slug ? t('ui.validation.slug') : undefined}
            {...form.register('slug')}
          />
          <Controller
            control={form.control}
            name="defaultLocale"
            render={({ field }) => (
              <SelectField
                label={t('ui.companies.defaultLanguage')}
                placeholder={t('ui.companies.defaultLanguage')}
                value={field.value ?? 'en'}
                onValueChange={field.onChange}
                options={[
                  { value: 'en', label: t('ui.common.english') },
                  { value: 'ar', label: t('ui.common.arabic') },
                ]}
              />
            )}
          />
          <FormError error={create.error} />
          <Button type="submit" loading={create.isPending}>
            {t('ui.companies.createSubmit')}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
