import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  clientListResponseSchema,
  CONTRACT_KINDS,
  type ContractKind,
  contractSchema,
  templateListResponseSchema,
} from '@ultimate-erp/contracts';
import { formatMoney } from '@ultimate-erp/i18n';
import {
  Avatar,
  Button,
  Card,
  initialsOf,
  SelectField,
  TextArea,
  TextField,
  useToast,
  Wizard,
} from '@ultimate-erp/ui';
import { ArrowLeft, ArrowRight, FileSignature, Handshake, ScrollText } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { dateText } from './shared.js';
import { kindLabel } from './shared.js';

const MONEY = /^\d{1,17}(\.\d{1,3})?$/;
const STEPS = ['party', 'template', 'details', 'money', 'dates', 'review'] as const;
type Step = (typeof STEPS)[number];

/**
 * New contract or engagement letter as a guided flow (redesign 2026-11-08). Six short steps,
 * each checked before moving on; the review step creates a DRAFT with the same single request
 * as before (the server validates everything again). Approval, sending and signing stay on the
 * document's page. Templates are the firm's own text — the product supplies no legal wording.
 */
export function NewContractPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
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
  const client = clients.data?.items.find((c) => c.id === clientId);
  const clientName = client ? (locale === 'ar' ? client.legalName.ar : client.legalName.en) : '';
  const template = usable.find((tpl) => tpl.id === templateId);

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
  const serverError = (path: string) =>
    isApiError(create.error) && create.error.details.some((d) => d.path === path)
      ? t('ui.validation.required')
      : undefined;

  // What blocks each step (shown only after a Next attempt).
  const problems: Record<Step, Partial<Record<string, string>>> = {
    party: clientId ? {} : { clientId: t('ui.ws.wizard.pickClient') },
    template: {},
    details: {
      ...(form.titleEn.trim() ? {} : { titleEn: t('ui.validation.required') }),
      ...(form.titleAr.trim() ? {} : { titleAr: t('ui.validation.required') }),
    },
    money: {
      ...(form.valueAmount.trim() && !MONEY.test(form.valueAmount.trim())
        ? { valueAmount: t('ui.ws.wizard.moneyFormat') }
        : {}),
      ...(/^[A-Z]{3}$/.test(form.currency) ? {} : { currency: t('ui.ws.wizard.currency') }),
    },
    dates: {
      ...(form.startDate && form.endDate && form.endDate < form.startDate
        ? { endDate: t('ui.ws.wizard.endBeforeStart') }
        : {}),
      ...(/^\d{1,3}$/.test(form.renewalNoticeDays) && Number(form.renewalNoticeDays) <= 365
        ? {}
        : { renewalNoticeDays: t('ui.ws.wizard.noticeDays') }),
    },
    review: {},
  };
  const current = STEPS[step] ?? 'party';
  const err = (key: string) => (tried ? problems[current][key] : undefined) ?? serverError(key);
  const next = () => {
    if (Object.keys(problems[current]).length > 0) {
      setTried(true);
      return;
    }
    setTried(false);
    setStep(Math.min(step + 1, STEPS.length - 1));
  };
  const valueText = form.valueAmount.trim()
    ? MONEY.test(form.valueAmount.trim())
      ? formatMoney(locale, form.valueAmount.trim(), form.currency || 'KWD')
      : form.valueAmount
    : t('ui.ws.wizard.notSet');

  const summary: [string, ReactNode][] = [
    [t('ui.contracts.fields.kind'), kindLabel(t, kind)],
    [t('ui.contracts.fields.client'), clientName || t('ui.ws.wizard.notSet')],
    [t('ui.contracts.fields.template'), template?.name ?? t('ui.contracts.fields.noTemplate')],
    [
      t('ui.ws.wizard.titles'),
      form.titleEn || form.titleAr
        ? `${form.titleEn}${form.titleAr ? ` · ${form.titleAr}` : ''}`
        : t('ui.ws.wizard.notSet'),
    ],
    [t('ui.contracts.fields.valueAmount'), valueText],
    [
      t('ui.ws.wizard.period'),
      form.startDate || form.endDate
        ? `${form.startDate ? dateText(locale, form.startDate) : '…'} – ${form.endDate ? dateText(locale, form.endDate) : '…'}`
        : t('ui.ws.wizard.notSet'),
    ],
    [
      t('ui.contracts.fields.renewalNoticeDays'),
      t('ui.ws.wizard.days', { count: Number(form.renewalNoticeDays || 0) }),
    ],
  ];

  const kinds: { value: ContractKind; Icon: typeof Handshake }[] = CONTRACT_KINDS.map((k) => ({
    value: k,
    Icon: k === 'engagement_letter' ? ScrollText : Handshake,
  }));

  return (
    <div className="grid gap-5">
      <AppPageHeader title={t('ui.contracts.new')} />
      <Wizard
        label={t('ui.ws.wizard.steps')}
        progressLabel={t('ui.ws.wizard.stepOf', { n: step + 1, total: STEPS.length })}
        current={step}
        onStepClick={setStep}
        steps={STEPS.map((s) => ({
          key: s,
          title: t(`ui.ws.wizard.contract.${s}.title`),
          hint: t(`ui.ws.wizard.contract.${s}.hint`),
        }))}
        aside={
          <Card title={t('ui.ws.wizard.summary')}>
            <dl className="grid gap-2.5 text-[12.5px]">
              {summary.map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="font-semibold break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        }
        footer={
          <>
            {step > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  setTried(false);
                  setStep(step - 1);
                }}
              >
                <ArrowLeft aria-hidden className="mirror size-4" />
                {t('ui.ws.wizard.back')}
              </Button>
            )}
            <span className="ms-auto" />
            {current === 'review' ? (
              <Button
                loading={create.isPending}
                onClick={() => {
                  create.mutate();
                }}
              >
                <FileSignature aria-hidden className="size-4" />
                {t('ui.contracts.create')}
              </Button>
            ) : (
              <Button onClick={next}>
                {t('ui.ws.wizard.next')}
                <ArrowRight aria-hidden className="mirror size-4" />
              </Button>
            )}
          </>
        }
      >
        <header className="grid gap-1">
          <h2 className="text-[18px] font-bold tracking-tight">
            {t(`ui.ws.wizard.contract.${current}.title`)}
          </h2>
          <p className="text-[13px] text-ink-2">{t(`ui.ws.wizard.contract.${current}.body`)}</p>
        </header>

        {current === 'party' && (
          <>
            <div
              role="radiogroup"
              aria-label={t('ui.contracts.fields.kind')}
              className="grid gap-3 sm:grid-cols-2"
            >
              {kinds.map(({ value, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => {
                    setKind(value);
                    setTemplateId('none');
                  }}
                  className="flex items-start gap-3 rounded-tile border border-line bg-frame p-4 text-start transition-all hover:border-line-2 aria-checked:border-plum aria-checked:bg-plum-soft aria-checked:shadow-[0_0_0_1px_var(--plum)]"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-plum">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="grid gap-0.5">
                    <b className="text-[14px]">{kindLabel(t, value)}</b>
                    <span className="text-[12.5px] text-ink-2">
                      {t(`ui.ws.wizard.kindHint.${value}`)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <SelectField
              label={t('ui.contracts.fields.client')}
              placeholder={t('ui.contracts.fields.client')}
              value={clientId}
              onValueChange={setClientId}
              disabled={!clients.data}
              error={err('clientId')}
              options={(clients.data?.items ?? []).map((c) => ({
                value: c.id,
                label: `${c.number} · ${locale === 'ar' ? c.legalName.ar : c.legalName.en}`,
              }))}
            />
            {client && (
              <div className="ui-fade flex items-center gap-3 rounded-tile border border-line bg-frame p-3">
                <Avatar
                  name={client.legalName.en}
                  initials={initialsOf(client.legalName.en)}
                  size={38}
                />
                <span className="grid min-w-0">
                  <b className="truncate text-[13.5px]">{clientName}</b>
                  <span className="text-[12px] text-ink-3">
                    {[client.industry, client.city, client.accountManagerName]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </div>
            )}
          </>
        )}

        {current === 'template' && (
          <>
            <SelectField
              label={t('ui.contracts.fields.template')}
              placeholder={t('ui.contracts.fields.noTemplate')}
              value={templateId}
              onValueChange={setTemplateId}
              disabled={!templates.data}
              options={[
                { value: 'none', label: t('ui.contracts.fields.noTemplate') },
                ...usable.map((tpl) => ({ value: tpl.id, label: tpl.name })),
              ]}
            />
            {usable.length === 0 && (
              <p className="text-[13px] text-ink-2">{t('ui.ws.wizard.noTemplates')}</p>
            )}
            <p role="note" className="rounded-tile bg-butter p-3 text-[12.5px] text-butter-ink">
              {t('ui.ws.wizard.legalNote')}
            </p>
          </>
        )}

        {current === 'details' && (
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label={t('ui.contracts.fields.titleEn')}
              dir="ltr"
              lang="en"
              value={form.titleEn}
              onChange={set('titleEn')}
              error={err('titleEn')}
            />
            <TextField
              label={t('ui.contracts.fields.titleAr')}
              dir="rtl"
              lang="ar"
              value={form.titleAr}
              onChange={set('titleAr')}
              error={err('titleAr')}
            />
          </div>
        )}

        {current === 'money' && (
          <>
            <div className="grid gap-4 md:grid-cols-[1fr_8rem]">
              <TextField
                label={t('ui.contracts.fields.valueAmount')}
                inputMode="decimal"
                dir="ltr"
                placeholder="0.000"
                value={form.valueAmount}
                onChange={set('valueAmount')}
                error={err('valueAmount')}
              />
              <TextField
                label={t('ui.contracts.fields.currency')}
                dir="ltr"
                maxLength={3}
                value={form.currency}
                onChange={(e) => {
                  setForm({ ...form, currency: e.target.value.toUpperCase() });
                }}
                error={err('currency')}
              />
            </div>
            <TextArea
              label={t('ui.contracts.fields.paymentTerms')}
              rows={4}
              value={form.paymentTerms}
              onChange={set('paymentTerms')}
            />
          </>
        )}

        {current === 'dates' && (
          <div className="grid gap-4 md:grid-cols-3">
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
              error={err('endDate')}
            />
            <TextField
              label={t('ui.contracts.fields.renewalNoticeDays')}
              type="number"
              min={0}
              max={365}
              value={form.renewalNoticeDays}
              onChange={set('renewalNoticeDays')}
              error={err('renewalNoticeDays')}
            />
          </div>
        )}

        {current === 'review' && (
          <>
            <dl className="grid gap-x-6 gap-y-3 rounded-tile border border-line bg-frame p-4 text-[13px] sm:grid-cols-2">
              {summary.map(([k, v]) => (
                <div key={k} className="grid gap-0.5">
                  <dt className="text-[12px] text-ink-3">{k}</dt>
                  <dd className="font-semibold break-words">{v}</dd>
                </div>
              ))}
              {form.paymentTerms && (
                <div className="grid gap-0.5 sm:col-span-2">
                  <dt className="text-[12px] text-ink-3">
                    {t('ui.contracts.fields.paymentTerms')}
                  </dt>
                  <dd className="whitespace-pre-wrap">{form.paymentTerms}</dd>
                </div>
              )}
            </dl>
            <p className="text-[12.5px] text-ink-2">{t('ui.ws.wizard.draftNote')}</p>
            <FormError error={create.error} />
          </>
        )}
      </Wizard>
    </div>
  );
}
