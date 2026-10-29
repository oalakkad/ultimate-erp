import { zodResolver } from '@hookform/resolvers/zod';
import {
  CLIENT_STATUSES,
  CLIENT_TYPES,
  createClientRequestSchema,
  type ErrorDetail,
} from '@ultimate-erp/contracts';
import { Button, SelectField, TextField } from '@ultimate-erp/ui';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { type z } from 'zod';
import { useI18n } from '../../app/i18n.js';

export type ClientFormValues = z.input<typeof createClientRequestSchema>;

const FIELDS = [
  'legalNameEn',
  'legalNameAr',
  'commercialRegistration',
  'industry',
  'email',
  'phone',
  'website',
  'addressLine',
  'city',
  'country',
] as const;

/**
 * The client fields, validated with the same schema the API uses. Server-side field errors
 * (e.g. a duplicate CR number) are shown next to their field via `serverErrors`.
 */
export function ClientForm({
  defaultValues,
  submitLabel,
  pending,
  serverErrors,
  onSubmit,
  footer,
}: {
  defaultValues: ClientFormValues;
  submitLabel: string;
  pending: boolean;
  serverErrors?: ErrorDetail[] | undefined;
  onSubmit: (values: ClientFormValues) => void;
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  const form = useForm<ClientFormValues>({
    resolver: zodResolver(createClientRequestSchema),
    defaultValues,
  });
  useEffect(() => {
    for (const detail of serverErrors ?? []) {
      if ((FIELDS as readonly string[]).includes(detail.path)) {
        form.setError(detail.path as (typeof FIELDS)[number], {
          type: 'server',
          message: detail.code,
        });
      }
    }
  }, [serverErrors, form]);
  const errors = form.formState.errors;
  const fieldError = (name: (typeof FIELDS)[number]) => {
    const e = errors[name];
    if (!e) return undefined;
    if (e.message === 'duplicate') return t('ui.clients.duplicateCr');
    if (name === 'email') return t('ui.validation.email');
    return t('ui.validation.required');
  };
  const text = (name: (typeof FIELDS)[number], extra: Record<string, unknown> = {}) => (
    <TextField
      label={t(`ui.clients.fields.${name}`)}
      error={fieldError(name)}
      {...extra}
      {...form.register(name)}
    />
  );

  return (
    <form noValidate className="grid gap-4" onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}>
      <div className="grid gap-4 md:grid-cols-2">
        {text('legalNameEn', { dir: 'ltr', lang: 'en' })}
        {text('legalNameAr', { dir: 'rtl', lang: 'ar' })}
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <SelectField
              label={t('ui.clients.fields.type')}
              placeholder={t('ui.clients.fields.type')}
              value={field.value ?? 'company'}
              onValueChange={field.onChange}
              options={CLIENT_TYPES.map((v) => ({ value: v, label: t(`ui.clients.type.${v}`) }))}
            />
          )}
        />
        <Controller
          control={form.control}
          name="status"
          render={({ field }) => (
            <SelectField
              label={t('ui.clients.fields.status')}
              placeholder={t('ui.clients.fields.status')}
              value={field.value ?? 'prospect'}
              onValueChange={field.onChange}
              options={CLIENT_STATUSES.map((v) => ({
                value: v,
                label: t(`ui.clients.status.${v}`),
              }))}
            />
          )}
        />
        {text('commercialRegistration', { dir: 'ltr', autoCapitalize: 'characters' })}
        {text('industry')}
        {text('email', { type: 'email', dir: 'ltr' })}
        {text('phone', { type: 'tel', dir: 'ltr' })}
        {text('website', { type: 'url', dir: 'ltr' })}
        {text('city')}
        {text('addressLine')}
        {text('country', { dir: 'ltr', maxLength: 2 })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}

/** Form values from an API client (nulls become empty fields). */
export function formValuesOf(c: {
  type: ClientFormValues['type'];
  status: ClientFormValues['status'];
  legalName: { en: string; ar: string };
  commercialRegistration: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine: string | null;
  city: string | null;
  country: string;
}): ClientFormValues {
  return {
    type: c.type,
    status: c.status,
    legalNameEn: c.legalName.en,
    legalNameAr: c.legalName.ar,
    commercialRegistration: c.commercialRegistration ?? '',
    industry: c.industry ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    website: c.website ?? '',
    addressLine: c.addressLine ?? '',
    city: c.city ?? '',
    country: c.country,
  };
}
