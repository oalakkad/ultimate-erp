import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  type ExpenseClaim,
  expenseClaimSchema,
  expenseSettingsSchema,
  fileDownloadResponseSchema,
  fileSchema,
  okResponseSchema,
  projectListResponseSchema,
  REIMBURSEMENT_METHODS,
} from '@ultimate-erp/contracts';
import { formatMoney } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { dateOf } from '../billing/invoices.js';
import { EXPENSE_CHIP } from './expenses.js';

const kuwaitToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

type Line = {
  spentOn: string;
  category: string;
  description: string;
  amount: string;
  projectId: string;
  billable: boolean;
  receipt: { id: string; name: string } | null;
  file: File | null;
};
const blank = (): Line => ({
  spentOn: kuwaitToday(),
  category: '',
  description: '',
  amount: '',
  projectId: 'none',
  billable: false,
  receipt: null,
  file: null,
});
const linesOf = (c: ExpenseClaim): Line[] =>
  c.lines.map((l) => ({
    spentOn: l.spentOn,
    category: l.category.code,
    description: l.description,
    amount: l.amount,
    projectId: l.project?.id ?? 'none',
    billable: l.billable,
    receipt: l.receipt ? { id: l.receipt.id, name: l.receipt.name } : null,
    file: null,
  }));

/** One expense claim: edit while a draft; approve, reject, reopen or reimburse by role. */
export function ExpenseClaimPage() {
  const { t } = useI18n();
  const { claimId } = useParams({ from: '/app/expenses/$claimId' });
  const claim = useQuery({
    queryKey: ['expenses', 'claim', claimId],
    queryFn: () => api(`/expenses/${claimId}`, { schema: expenseClaimSchema }),
  });
  if (claim.isPending) return <LoadingState label={t('ui.common.loading')} lines={4} />;
  if (claim.isError)
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, claim.error)}
        reference={errorReference(t, claim.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void claim.refetch()}
      />
    );
  return <Claim key={`${claim.data.id}:${claim.data.version}`} c={claim.data} />;
}

function Claim({ c }: { c: ExpenseClaim }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = c.actions.includes('edit');
  const [title, setTitle] = useState(c.title);
  const [lines, setLines] = useState<Line[]>(c.lines.length ? linesOf(c) : [blank()]);
  const [dialog, setDialog] = useState<'reject' | 'reimburse' | null>(null);
  const [form, setForm] = useState({
    note: '',
    reimbursedOn: kuwaitToday(),
    method: 'bank_transfer',
    reference: '',
  });
  const money = (v: string) => formatMoney(locale, v, c.currency);
  const refresh = async (next: ExpenseClaim) => {
    queryClient.setQueryData(['expenses', 'claim', c.id], next);
    await queryClient.invalidateQueries({ queryKey: ['expenses', 'list'] });
  };

  const save = async () => {
    const body = [];
    for (const l of lines.filter((x) => x.description.trim() && x.amount.trim())) {
      let receiptFileId = l.receipt?.id ?? null;
      if (l.file) {
        const data = new FormData();
        data.append('file', l.file);
        receiptFileId = (await api('/files', { method: 'POST', body: data, schema: fileSchema }))
          .id;
      }
      body.push({
        spentOn: l.spentOn,
        category: l.category,
        description: l.description.trim(),
        amount: l.amount.trim(),
        projectId: l.projectId === 'none' ? null : l.projectId,
        billable: l.projectId !== 'none' && l.billable,
        receiptFileId,
      });
    }
    return api(`/expenses/${c.id}`, {
      method: 'PATCH',
      body: { title: title.trim(), lines: body, version: c.version },
      schema: expenseClaimSchema,
    });
  };
  const saveDraft = useMutation({
    mutationFn: save,
    onSuccess: async (next) => {
      toast({ tone: 'good', title: t('ui.expenses.saved') });
      await refresh(next);
    },
  });
  const act = useMutation({
    mutationFn: async (action: 'submit' | 'approve' | 'reject' | 'reopen' | 'reimburse') => {
      if (action === 'submit') await save();
      const body =
        action === 'reject'
          ? { note: form.note.trim() }
          : action === 'reimburse'
            ? {
                reimbursedOn: form.reimbursedOn,
                method: form.method,
                reference: form.reference.trim(),
              }
            : {};
      return api(`/expenses/${c.id}/${action}`, {
        method: 'POST',
        body,
        schema: expenseClaimSchema,
      });
    },
    onSuccess: async (next) => {
      setDialog(null);
      toast({ tone: 'good', title: t(`ui.expenses.done.${next.status}`) });
      await refresh(next);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/expenses/${c.id}`, { method: 'DELETE', schema: okResponseSchema }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expenses'] });
      await navigate({ to: '/expenses' });
    },
  });
  const download = useMutation({
    mutationFn: (lineId: string) =>
      api(`/expenses/${c.id}/lines/${lineId}/receipt`, {
        method: 'POST',
        schema: fileDownloadResponseSchema,
      }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={c.number ? `${c.number} · ${c.title}` : c.title}
        actions={
          <StatusChip
            status={EXPENSE_CHIP[c.status]}
            label={t(`ui.expenses.statusName.${c.status}`)}
          />
        }
      />
      <Card>
        <p className="text-[13.5px] text-ink-2">
          {t('ui.expenses.claimant', { name: c.person.name })} ·{' '}
          <span className="font-bold tabular-nums text-ink">{money(c.total)}</span>
        </p>
        {c.decisionNote && (
          <p className="rounded-tile bg-frame p-3 text-[13.5px]">
            {t('ui.expenses.decisionBy', { name: c.decidedByName ?? '', note: c.decisionNote })}
          </p>
        )}
        {c.reimbursement && (
          <p className="rounded-tile bg-mint p-3 text-[13.5px] text-mint-ink">
            {t('ui.expenses.reimbursedOn', {
              date: dateOf(locale, c.reimbursement.reimbursedOn),
              method: t(`ui.expenses.method.${c.reimbursement.method}`),
              reference: c.reimbursement.reference || '—',
            })}
          </p>
        )}
      </Card>
      {editing ? (
        <Card title={t('ui.expenses.linesTitle')}>
          <small className="text-ink-3">{t('ui.expenses.editHint')}</small>
          <TextField
            label={t('ui.expenses.claimTitle')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <LinesEditor lines={lines} onChange={setLines} />
          <FormError error={saveDraft.error ?? act.error ?? remove.error} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={saveDraft.isPending}
              onClick={() => {
                saveDraft.mutate();
              }}
            >
              {t('ui.expenses.saveDraft')}
            </Button>
            <Button
              loading={act.isPending}
              disabled={!title.trim()}
              onClick={() => {
                act.mutate('submit');
              }}
            >
              {t('ui.expenses.submit')}
            </Button>
            <Button
              variant="ghost"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate();
              }}
            >
              {t('ui.expenses.delete')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card title={t('ui.expenses.linesTitle')}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead className="text-[12px] text-ink-3">
                <tr>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.expenses.line.date')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.expenses.line.category')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.expenses.line.description')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.expenses.line.project')}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {t('ui.expenses.line.amount')}
                  </th>
                  <th scope="col" className="py-2 text-end font-semibold">
                    {t('ui.expenses.line.receipt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-2">{dateOf(locale, l.spentOn)}</td>
                    <td className="py-2">
                      {locale === 'ar' ? l.category.name.ar : l.category.name.en}
                    </td>
                    <td className="py-2">{l.description}</td>
                    <td className="py-2">
                      {l.project ? l.project.number : '—'}
                      {l.billable && (
                        <small className="block text-ink-3">
                          {l.invoiceNumber
                            ? t('ui.expenses.onInvoice', { number: l.invoiceNumber })
                            : t(l.invoiced ? 'ui.expenses.invoiced' : 'ui.expenses.billable')}
                        </small>
                      )}
                    </td>
                    <td className="py-2 text-end tabular-nums">{money(l.amount)}</td>
                    <td className="py-2 text-end">
                      {l.receipt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={download.isPending && download.variables === l.id}
                          onClick={() => {
                            download.mutate(l.id);
                          }}
                        >
                          {t('ui.expenses.openReceipt')}
                        </Button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FormError error={act.error ?? download.error} />
          <div className="flex flex-wrap gap-2">
            {c.actions.includes('approve') && (
              <Button
                loading={act.isPending && act.variables === 'approve'}
                onClick={() => {
                  act.mutate('approve');
                }}
              >
                {t('ui.expenses.approve')}
              </Button>
            )}
            {c.actions.includes('reject') && (
              <Button
                variant="secondary"
                onClick={() => {
                  setDialog('reject');
                }}
              >
                {t('ui.expenses.reject')}
              </Button>
            )}
            {c.actions.includes('reopen') && (
              <Button
                variant="secondary"
                loading={act.isPending}
                onClick={() => {
                  act.mutate('reopen');
                }}
              >
                {t('ui.expenses.reopen')}
              </Button>
            )}
            {c.actions.includes('reimburse') && (
              <Button
                onClick={() => {
                  setDialog('reimburse');
                }}
              >
                {t('ui.expenses.reimburse')}
              </Button>
            )}
          </div>
        </Card>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        title={dialog ? t(`ui.expenses.dialog.${dialog}`) : ''}
        description={dialog === 'reimburse' ? t('ui.expenses.recordedHint') : undefined}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (dialog) act.mutate(dialog);
          }}
        >
          {dialog === 'reject' && (
            <TextArea
              label={t('ui.expenses.reason')}
              rows={3}
              value={form.note}
              onChange={(e) => {
                setForm({ ...form, note: e.target.value });
              }}
            />
          )}
          {dialog === 'reimburse' && (
            <>
              <TextField
                label={t('ui.expenses.reimbursedOnLabel')}
                type="date"
                value={form.reimbursedOn}
                onChange={(e) => {
                  setForm({ ...form, reimbursedOn: e.target.value });
                }}
              />
              <SelectField
                label={t('ui.expenses.methodLabel')}
                placeholder={t('ui.expenses.methodLabel')}
                value={form.method}
                onValueChange={(v) => {
                  setForm({ ...form, method: v });
                }}
                options={REIMBURSEMENT_METHODS.map((m) => ({
                  value: m,
                  label: t(`ui.expenses.method.${m}`),
                }))}
              />
              <TextField
                label={t('ui.expenses.reference')}
                value={form.reference}
                onChange={(e) => {
                  setForm({ ...form, reference: e.target.value });
                }}
              />
            </>
          )}
          <FormError error={act.error} />
          <Button
            type="submit"
            className="w-fit"
            loading={act.isPending}
            disabled={dialog === 'reject' && !form.note.trim()}
          >
            {dialog ? t(`ui.expenses.dialog.${dialog}`) : ''}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

function LinesEditor({ lines, onChange }: { lines: Line[]; onChange: (l: Line[]) => void }) {
  const { t, locale } = useI18n();
  const settings = useQuery({
    queryKey: ['expenses', 'settings'],
    queryFn: () => api('/expenses/settings', { schema: expenseSettingsSchema }),
  });
  const projects = useQuery({
    queryKey: ['projects', 'picker', 'mine'],
    queryFn: () => api('/projects?limit=100', { schema: projectListResponseSchema }),
  });
  const categories = (settings.data?.categories ?? []).filter((c) => c.active);
  const update = (i: number, patch: Partial<Line>) => {
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  return (
    <div className="grid gap-3">
      {settings.data && (
        <small className="text-ink-3">
          {t('ui.expenses.receiptRule', {
            amount: formatMoney(locale, settings.data.receiptRequiredAbove, 'KWD'),
          })}
        </small>
      )}
      {lines.map((l, i) => (
        <fieldset key={i} className="grid gap-2 rounded-tile bg-frame p-3">
          <legend className="sr-only">{t('ui.expenses.lineN', { n: i + 1 })}</legend>
          <div className="grid gap-2 sm:grid-cols-[1.2fr_1.4fr_3fr_1.2fr] sm:items-end">
            <TextField
              label={t('ui.expenses.line.date')}
              type="date"
              value={l.spentOn}
              onChange={(e) => {
                update(i, { spentOn: e.target.value });
              }}
            />
            <SelectField
              label={t('ui.expenses.line.category')}
              placeholder={t('ui.expenses.chooseCategory')}
              value={l.category}
              onValueChange={(v) => {
                update(i, { category: v });
              }}
              options={categories.map((c) => ({
                value: c.code,
                label: locale === 'ar' ? c.nameAr : c.nameEn,
              }))}
            />
            <TextField
              label={t('ui.expenses.line.description')}
              value={l.description}
              onChange={(e) => {
                update(i, { description: e.target.value });
              }}
            />
            <TextField
              label={t('ui.expenses.line.amount')}
              inputMode="decimal"
              dir="ltr"
              placeholder="0.000"
              value={l.amount}
              onChange={(e) => {
                update(i, { amount: e.target.value });
              }}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
            <SelectField
              label={t('ui.expenses.line.project')}
              placeholder={t('ui.expenses.noProject')}
              value={l.projectId}
              onValueChange={(v) => {
                update(i, { projectId: v, billable: v === 'none' ? false : l.billable });
              }}
              options={[
                { value: 'none', label: t('ui.expenses.noProject') },
                ...(projects.data?.items ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.number} · ${locale === 'ar' ? p.name.ar : p.name.en}`,
                })),
              ]}
            />
            <Checkbox
              label={t('ui.expenses.billableLabel')}
              checked={l.billable}
              disabled={l.projectId === 'none'}
              onCheckedChange={(on) => {
                update(i, { billable: on });
              }}
            />
            <label className="grid gap-1.5 text-[13px] font-semibold">
              {t('ui.expenses.line.receipt')}
              {l.receipt && !l.file && (
                <span className="text-[12.5px] font-normal text-ink-2">{l.receipt.name}</span>
              )}
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                className="text-[13px] font-normal"
                onChange={(e) => {
                  update(i, { file: e.target.files?.[0] ?? null });
                }}
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(lines.filter((_, j) => j !== i));
              }}
            >
              {t('ui.expenses.removeLine')}
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={() => {
          onChange([...lines, blank()]);
        }}
      >
        {t('ui.expenses.addLine')}
      </Button>
    </div>
  );
}
