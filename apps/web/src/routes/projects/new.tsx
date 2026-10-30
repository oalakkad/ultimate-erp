import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  BILLING_METHODS,
  type BillingMethod,
  clientListResponseSchema,
  contractListResponseSchema,
  memberListResponseSchema,
  projectSchema,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
  Checkbox,
  SelectField,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { can, useAccess } from '../../lib/session.js';
import { useSearchParam } from '../../lib/use-search-param.js';

/** New project: client, optional contract of that client, manager, team and budget revision 1. */
export function NewProjectPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const access = useAccess(true);
  const [clientId, setClientId] = useState(useSearchParam('clientId') ?? '');
  const [contractId, setContractId] = useState('none');
  const [managerId, setManagerId] = useState('');
  const [team, setTeam] = useState<string[]>([]);
  const [billing, setBilling] = useState<BillingMethod>('time_and_materials');
  const [form, setForm] = useState({
    nameEn: '',
    nameAr: '',
    description: '',
    startDate: '',
    endDate: '',
    budgetHours: '',
    budgetAmount: '',
    currency: 'KWD',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [key]: e.target.value });
  };

  const clients = useQuery({
    queryKey: ['clients', 'picker'],
    queryFn: () => api('/clients?limit=100&sort=name', { schema: clientListResponseSchema }),
  });
  const contracts = useQuery({
    queryKey: ['contracts', 'client', clientId],
    enabled: Boolean(clientId) && can(access.data, 'contracts.contract.read'),
    queryFn: () =>
      api(`/contracts?clientId=${clientId}&limit=100`, { schema: contractListResponseSchema }),
  });
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api('/members', { schema: memberListResponseSchema }),
  });
  const active = (members.data?.members ?? []).filter((m) => m.status === 'active');

  const create = useMutation({
    mutationFn: () =>
      api('/projects', {
        method: 'POST',
        body: {
          clientId,
          contractId: contractId === 'none' ? null : contractId,
          nameEn: form.nameEn,
          nameAr: form.nameAr,
          description: form.description,
          managerMembershipId: managerId,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          billingMethod: billing,
          budgetHours: form.budgetHours.trim(),
          budgetAmount: form.budgetAmount.trim() || null,
          currency: form.currency,
          memberIds: team.filter((id) => id !== managerId),
        },
        schema: projectSchema,
      }),
    onSuccess: async (project) => {
      toast({ tone: 'good', title: t('ui.projects.created', { number: project.number }) });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
    },
  });
  const fieldError = (path: string) => {
    const detail = isApiError(create.error)
      ? create.error.details.find((d) => d.path === path)
      : undefined;
    if (!detail) return undefined;
    if (detail.code === 'not_of_client') return t('ui.projects.contractOtherClient');
    if (path === 'endDate') return t('ui.projects.endBeforeStart');
    if (path === 'budgetHours') return t('ui.projects.hoursFormat');
    return t('ui.validation.required');
  };

  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.projects.new')} />
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
              label={t('ui.projects.fields.client')}
              placeholder={t('ui.projects.fields.client')}
              value={clientId}
              onValueChange={(v) => {
                setClientId(v);
                setContractId('none');
              }}
              error={fieldError('clientId')}
              options={(clients.data?.items ?? []).map((c) => ({
                value: c.id,
                label: `${c.number} · ${locale === 'ar' ? c.legalName.ar : c.legalName.en}`,
              }))}
            />
            <SelectField
              label={t('ui.projects.fields.contract')}
              placeholder={t('ui.projects.fields.noContract')}
              value={contractId}
              onValueChange={setContractId}
              error={fieldError('contractId')}
              options={[
                { value: 'none', label: t('ui.projects.fields.noContract') },
                ...(contracts.data?.items ?? []).map((c) => ({
                  value: c.id,
                  label: `${c.number} · ${locale === 'ar' ? c.title.ar : c.title.en}`,
                })),
              ]}
            />
            <SelectField
              label={t('ui.projects.fields.manager')}
              placeholder={t('ui.projects.fields.manager')}
              value={managerId}
              onValueChange={setManagerId}
              error={fieldError('managerMembershipId')}
              options={active.map((m) => ({ value: m.membershipId, label: m.name }))}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t('ui.projects.fields.nameEn')}
              dir="ltr"
              lang="en"
              value={form.nameEn}
              onChange={set('nameEn')}
              error={fieldError('nameEn')}
            />
            <TextField
              label={t('ui.projects.fields.nameAr')}
              dir="rtl"
              lang="ar"
              value={form.nameAr}
              onChange={set('nameAr')}
              error={fieldError('nameAr')}
            />
            <TextField
              label={t('ui.projects.fields.startDate')}
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
            />
            <TextField
              label={t('ui.projects.fields.endDate')}
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              error={fieldError('endDate')}
            />
            <SelectField
              label={t('ui.projects.fields.billingMethod')}
              placeholder={t('ui.projects.fields.billingMethod')}
              value={billing}
              onValueChange={(v) => {
                setBilling(v as BillingMethod);
              }}
              options={BILLING_METHODS.map((b) => ({
                value: b,
                label: t(`ui.projects.billing.${b}`),
              }))}
            />
            <TextField
              label={t('ui.projects.fields.budgetHours')}
              inputMode="decimal"
              dir="ltr"
              placeholder="0"
              value={form.budgetHours}
              onChange={set('budgetHours')}
              error={fieldError('budgetHours')}
            />
            <TextField
              label={t('ui.projects.fields.budgetAmount')}
              inputMode="decimal"
              dir="ltr"
              placeholder="0.000"
              value={form.budgetAmount}
              onChange={set('budgetAmount')}
              error={fieldError('budgetAmount')}
            />
            <TextField
              label={t('ui.projects.fields.currency')}
              dir="ltr"
              maxLength={3}
              value={form.currency}
              onChange={set('currency')}
            />
          </div>
          <TextArea
            label={t('ui.projects.fields.description')}
            rows={3}
            value={form.description}
            onChange={set('description')}
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-semibold">
              {t('ui.projects.fields.team')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {active
                .filter((m) => m.membershipId !== managerId)
                .map((m) => (
                  <Checkbox
                    key={m.membershipId}
                    label={m.name}
                    checked={team.includes(m.membershipId)}
                    onCheckedChange={(on) => {
                      setTeam(
                        on ? [...team, m.membershipId] : team.filter((id) => id !== m.membershipId),
                      );
                    }}
                  />
                ))}
            </div>
          </fieldset>
          <FormError error={create.error} />
          <Button
            type="submit"
            className="w-fit"
            loading={create.isPending}
            disabled={
              !clientId ||
              !managerId ||
              !form.nameEn.trim() ||
              !form.nameAr.trim() ||
              !form.budgetHours.trim()
            }
          >
            {t('ui.projects.create')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
