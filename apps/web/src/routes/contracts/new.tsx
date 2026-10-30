import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  clientListResponseSchema,
  CONTRACT_KINDS,
  type ContractKind,
  contractSchema,
  templateListResponseSchema,
} from '@ultimate-erp/contracts';
import { Button, Card, SelectField, TextArea, TextField, useToast } from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { kindLabel } from './shared.js';

/** New contract or engagement letter, from a template (placeholders filled) or blank. */
export function NewContractPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ContractKind>('engagement_letter');
  const [clientId, setClientId] = useState(useSearchParam('clientId') ?? '');
  const [templateId, setTemplateId] = useState('none');
  const [form, setForm] = useState({
    titleEn: '',
    titleAr: '',
    startDate: '',
    endDate: '',
    valueAmount: '',
    currency: 'KWD',
    paymentTerms: '',
    renewalNoticeDays: '30',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [key]: e.target.value });
  };

  const clients = useQuery({
    queryKey: ['clients', 'picker'],
    queryFn: () => api('/clients?limit=100&sort=name', { schema: clientListResponseSchema }),
  });
  const templates = useQuery({
    queryKey: ['contract-templates'],
    queryFn: () => api('/contract-templates', { schema: templateListResponseSchema }),
  });
  const usable = (templates.data?.items ?? []).filter((tpl) => tpl.kind === kind && !tpl.archived);

  const create = useMutation({
    mutationFn: () =>
      api('/contracts', {
        method: 'POST',
        body: {
          kind,
          clientId,
          templateId: templateId === 'none' ? null : templateId,
          titleEn: form.titleEn,
          titleAr: form.titleAr,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          valueAmount: form.valueAmount.trim() || null,
          currency: form.currency,
          paymentTerms: form.paymentTerms,
          renewalNoticeDays: Number(form.renewalNoticeDays || '30'),
        },
        schema: contractSchema,
      }),
    onSuccess: async (contract) => {
      toast({ tone: 'good', title: t('ui.contracts.created', { number: contract.number }) });
      await queryClient.invalidateQueries({ queryKey: ['contracts'] });
      await navigate({ to: '/contracts/$contractId', params: { contractId: contract.id } });
    },
  });
  const fieldError = (path: string) =>
    isApiError(create.error) && create.error.details.some((d) => d.path === path)
      ? t('ui.validation.required')
      : undefined;

  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.contracts.new')} />
      <Card>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField
              label={t('ui.contracts.fields.kind')}
              placeholder={t('ui.contracts.fields.kind')}
              value={kind}
              onValueChange={(v) => {
                setKind(v as ContractKind);
                setTemplateId('none');
              }}
              options={CONTRACT_KINDS.map((k) => ({ value: k, label: kindLabel(t, k) }))}
            />
            <SelectField
              label={t('ui.contracts.fields.client')}
              placeholder={t('ui.contracts.fields.client')}
              value={clientId}
              onValueChange={setClientId}
              error={fieldError('clientId')}
              options={(clients.data?.items ?? []).map((c) => ({
                value: c.id,
                label: `${c.number} · ${locale === 'ar' ? c.legalName.ar : c.legalName.en}`,
              }))}
            />
            <SelectField
              label={t('ui.contracts.fields.template')}
              placeholder={t('ui.contracts.fields.noTemplate')}
              value={templateId}
              onValueChange={setTemplateId}
              options={[
                { value: 'none', label: t('ui.contracts.fields.noTemplate') },
                ...usable.map((tpl) => ({ value: tpl.id, label: tpl.name })),
              ]}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t('ui.contracts.fields.titleEn')}
              dir="ltr"
              lang="en"
              value={form.titleEn}
              onChange={set('titleEn')}
              error={fieldError('titleEn')}
            />
            <TextField
              label={t('ui.contracts.fields.titleAr')}
              dir="rtl"
              lang="ar"
              value={form.titleAr}
              onChange={set('titleAr')}
              error={fieldError('titleAr')}
            />
            <TextField
              label={t('ui.contracts.fields.startDate')}
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
            />
            <TextField
              label={t('ui.contracts.fields.endDate')}
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              error={fieldError('endDate')}
            />
            <TextField
              label={t('ui.contracts.fields.valueAmount')}
              inputMode="decimal"
              dir="ltr"
              placeholder="0.000"
              value={form.valueAmount}
              onChange={set('valueAmount')}
              error={fieldError('valueAmount')}
            />
            <TextField
              label={t('ui.contracts.fields.currency')}
              dir="ltr"
              maxLength={3}
              value={form.currency}
              onChange={set('currency')}
            />
            <TextField
              label={t('ui.contracts.fields.renewalNoticeDays')}
              type="number"
              min={0}
              max={365}
              value={form.renewalNoticeDays}
              onChange={set('renewalNoticeDays')}
            />
          </div>
          <TextArea
            label={t('ui.contracts.fields.paymentTerms')}
            rows={3}
            value={form.paymentTerms}
            onChange={set('paymentTerms')}
          />
          <FormError error={create.error} />
          <Button
            type="submit"
            className="w-fit"
            loading={create.isPending}
            disabled={!clientId || !form.titleEn.trim() || !form.titleAr.trim()}
          >
            {t('ui.contracts.create')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
