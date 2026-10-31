import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  expenseClaimSchema,
  type ExpenseSettings,
  expenseSettingsSchema,
  type ExpenseStatus,
  expenseListResponseSchema,
  projectExpensesSchema,
} from '@ultimate-erp/contracts';
import { formatMoney } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusChip,
  Tabs,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, canAny, useAccess } from '../../lib/session.js';
import { dateOf } from '../billing/invoices.js';

export const EXPENSE_CHIP: Record<ExpenseStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  draft: 'info',
  submitted: 'warn',
  approved: 'good',
  rejected: 'bad',
  reimbursed: 'good',
};

/** Expenses: my claims, approvals, reimbursements, everything I may see, and settings. */
export function ExpensesPage() {
  const { t } = useI18n();
  const access = useAccess(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      api('/expenses', {
        method: 'POST',
        body: { title: t('ui.expenses.defaultTitle') },
        schema: expenseClaimSchema,
      }),
    onSuccess: async (claim) => {
      await queryClient.invalidateQueries({ queryKey: ['expenses'] });
      await navigate({ to: '/expenses/$claimId', params: { claimId: claim.id } });
    },
  });
  const approver = canAny(access.data, 'expenses.claim.approve');
  const reader = canAny(access.data, 'expenses.claim.read');
  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.expenses.title')}
        actions={
          <Button
            loading={create.isPending}
            onClick={() => {
              create.mutate();
            }}
          >
            <Plus aria-hidden className="size-4" />
            {t('ui.expenses.new')}
          </Button>
        }
      />
      <FormError error={create.error} />
      <Tabs
        label={t('ui.expenses.title')}
        items={[
          { value: 'mine', label: t('ui.expenses.tabs.mine'), content: <ClaimList view="mine" /> },
          ...(approver
            ? [
                {
                  value: 'approvals',
                  label: t('ui.expenses.tabs.approvals'),
                  content: <ClaimList view="approvals" />,
                },
              ]
            : []),
          ...(can(access.data, 'expenses.claim.reimburse')
            ? [
                {
                  value: 'reimburse',
                  label: t('ui.expenses.tabs.reimburse'),
                  content: <ClaimList view="reimburse" />,
                },
              ]
            : []),
          ...(reader
            ? [
                {
                  value: 'all',
                  label: t('ui.expenses.tabs.all'),
                  content: <ClaimList view="all" />,
                },
              ]
            : []),
          ...(can(access.data, 'expenses.settings.manage')
            ? [{ value: 'settings', label: t('ui.expenses.tabs.settings'), content: <Settings /> }]
            : []),
        ]}
      />
    </div>
  );
}

function ClaimList({ view }: { view: 'mine' | 'approvals' | 'reimburse' | 'all' }) {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ['expenses', 'list', view],
    queryFn: () => api(`/expenses?view=${view}`, { schema: expenseListResponseSchema }),
  });
  return (
    <Card>
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={3} />}
      {list.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, list.error)}
          reference={errorReference(t, list.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data?.items.length === 0 && (
        <EmptyState
          title={t(view === 'mine' ? 'ui.expenses.empty' : 'ui.expenses.nothingWaiting')}
          body={t(view === 'mine' ? 'ui.expenses.emptyBody' : 'ui.states.emptyBody')}
        />
      )}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="text-[12px] text-ink-3">
              <tr>
                <th scope="col" className="py-2 text-start font-semibold">
                  {t('ui.expenses.col.number')}
                </th>
                <th scope="col" className="py-2 text-start font-semibold">
                  {t('ui.expenses.col.title')}
                </th>
                {view !== 'mine' && (
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.expenses.col.person')}
                  </th>
                )}
                <th scope="col" className="py-2 text-start font-semibold">
                  {t('ui.expenses.col.status')}
                </th>
                <th scope="col" className="py-2 text-end font-semibold">
                  {t('ui.expenses.col.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-2">
                    <Link
                      to="/expenses/$claimId"
                      params={{ claimId: c.id }}
                      className="font-semibold text-plum hover:underline"
                    >
                      {c.number ?? t('ui.expenses.draftLabel')}
                    </Link>
                  </td>
                  <td className="py-2">{c.title}</td>
                  {view !== 'mine' && <td className="py-2">{c.person.name}</td>}
                  <td className="py-2">
                    <StatusChip
                      status={EXPENSE_CHIP[c.status]}
                      label={t(`ui.expenses.statusName.${c.status}`)}
                    />
                  </td>
                  <td className="py-2 text-end tabular-nums">
                    {formatMoney(locale, c.total, c.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['expenses', 'settings'],
    queryFn: () => api('/expenses/settings', { schema: expenseSettingsSchema }),
  });
  const save = useMutation({
    mutationFn: (value: Partial<ExpenseSettings>) =>
      api('/expenses/settings', { method: 'PATCH', body: value, schema: expenseSettingsSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(['expenses', 'settings'], data);
      toast({ tone: 'good', title: t('ui.expenses.settingsSaved') });
    },
  });
  if (!settings.data) return <LoadingState label={t('ui.common.loading')} lines={3} />;
  return <SettingsForm key={JSON.stringify(settings.data)} value={settings.data} save={save} />;
}

function SettingsForm({
  value,
  save,
}: {
  value: ExpenseSettings;
  save: { mutate: (v: Partial<ExpenseSettings>) => void; isPending: boolean; error: unknown };
}) {
  const { t } = useI18n();
  const [threshold, setThreshold] = useState(value.receiptRequiredAbove);
  const [categories, setCategories] = useState(value.categories);
  const [draft, setDraft] = useState({ code: '', nameEn: '', nameAr: '' });
  return (
    <Card title={t('ui.expenses.tabs.settings')}>
      <TextField
        label={t('ui.expenses.threshold')}
        hint={t('ui.expenses.thresholdHint')}
        inputMode="decimal"
        dir="ltr"
        value={threshold}
        onChange={(e) => {
          setThreshold(e.target.value);
        }}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-semibold">{t('ui.expenses.categories')}</legend>
        {categories.map((c, i) => (
          <Checkbox
            key={c.code}
            label={`${c.nameEn} · ${c.nameAr}`}
            checked={c.active}
            onCheckedChange={(on) => {
              setCategories(categories.map((x, j) => (j === i ? { ...x, active: on } : x)));
            }}
          />
        ))}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
        <TextField
          label={t('ui.expenses.categoryCode')}
          dir="ltr"
          value={draft.code}
          onChange={(e) => {
            setDraft({ ...draft, code: e.target.value });
          }}
        />
        <TextField
          label={t('ui.expenses.categoryEn')}
          dir="ltr"
          lang="en"
          value={draft.nameEn}
          onChange={(e) => {
            setDraft({ ...draft, nameEn: e.target.value });
          }}
        />
        <TextField
          label={t('ui.expenses.categoryAr')}
          dir="rtl"
          lang="ar"
          value={draft.nameAr}
          onChange={(e) => {
            setDraft({ ...draft, nameAr: e.target.value });
          }}
        />
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        disabled={!draft.code.trim() || !draft.nameEn.trim() || !draft.nameAr.trim()}
        onClick={() => {
          setCategories([...categories, { ...draft, code: draft.code.trim(), active: true }]);
          setDraft({ code: '', nameEn: '', nameAr: '' });
        }}
      >
        {t('ui.expenses.addCategory')}
      </Button>
      <FormError error={save.error} />
      <Button
        className="w-fit"
        loading={save.isPending}
        onClick={() => {
          save.mutate({ categories, receiptRequiredAbove: threshold.trim() });
        }}
      >
        {t('ui.common.save')}
      </Button>
    </Card>
  );
}

/** A project's expense cost (on the project page, for its manager and expense readers). */
export function ProjectExpensesCard({ projectId }: { projectId: string }) {
  const { t, locale } = useI18n();
  const cost = useQuery({
    queryKey: ['expenses', 'project', projectId],
    queryFn: () => api(`/projects/${projectId}/expenses`, { schema: projectExpensesSchema }),
    retry: false,
  });
  if (!cost.data) return null;
  const money = (v: string) => formatMoney(locale, v, 'KWD');
  return (
    <Card title={t('ui.expenses.projectTitle')}>
      <dl className="grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-4">
        {(['approved', 'billable', 'invoiced', 'pending'] as const).map((k) => (
          <div key={k} className="grid gap-0.5">
            <dt className="text-[12px] text-ink-3">{t(`ui.expenses.cost.${k}`)}</dt>
            <dd className="font-bold tabular-nums">{money(cost.data[k])}</dd>
          </div>
        ))}
      </dl>
      {cost.data.lines.length === 0 ? (
        <small className="text-ink-3">{t('ui.expenses.projectEmpty')}</small>
      ) : (
        <ul className="grid gap-1.5 text-[13.5px]">
          {cost.data.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <Link
                  to="/expenses/$claimId"
                  params={{ claimId: l.claimId }}
                  className="font-semibold text-plum hover:underline"
                >
                  {l.claimNumber ?? t('ui.expenses.draftLabel')}
                </Link>{' '}
                · {dateOf(locale, l.spentOn)} · {l.person} ·{' '}
                {locale === 'ar' ? l.category.ar : l.category.en} · {l.description}
              </span>
              <span className="tabular-nums text-ink-2">
                {money(l.amount)}
                {l.billable &&
                  ` · ${t(l.invoiced ? 'ui.expenses.invoiced' : 'ui.expenses.billable')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
