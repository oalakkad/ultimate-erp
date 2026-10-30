import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  employeeListResponseSchema,
  type PayrollRulesInput,
  type PayrollRunStatus,
  payrollRunListResponseSchema,
  payrollRunSchema,
  ruleSetListResponseSchema,
  salaryListResponseSchema,
} from '@ultimate-erp/contracts';
import { formatMoney } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  LoadingState,
  SelectField,
  StatusChip,
  Tabs,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { can, useAccess } from '../../lib/session.js';

export const RUN_CHIP: Record<PayrollRunStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  draft: 'info',
  calculated: 'info',
  submitted: 'warn',
  approved: 'good',
  paid: 'good',
  cancelled: 'bad',
};

/** The warning shown on every payroll screen (docs/modules/payroll.md §2). */
export function PayrollWarning() {
  const { t } = useI18n();
  return (
    <p role="note" className="rounded-tile bg-butter p-3 text-[13px] font-semibold text-butter-ink">
      {t('ui.payroll.notVerified')}
    </p>
  );
}

/** Payroll home for payroll staff: runs, salaries and rules. */
export function PayrollPage() {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.payroll.title')} />
      <PayrollWarning />
      <Tabs
        label={t('ui.payroll.title')}
        items={[
          { value: 'runs', label: t('ui.payroll.tabs.runs'), content: <Runs /> },
          { value: 'salaries', label: t('ui.payroll.tabs.salaries'), content: <Salaries /> },
          { value: 'rules', label: t('ui.payroll.tabs.rules'), content: <Rules /> },
        ]}
      />
    </div>
  );
}

function Runs() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const access = useAccess(true);
  const lastMonth = (() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const [period, setPeriod] = useState(lastMonth);
  const list = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => api('/payroll/runs', { schema: payrollRunListResponseSchema }),
  });
  const create = useMutation({
    mutationFn: () =>
      api('/payroll/runs', { method: 'POST', body: { period }, schema: payrollRunSchema }),
    onSuccess: async (run) => {
      await navigate({ to: '/payroll/runs/$runId', params: { runId: run.id } });
    },
  });
  return (
    <Card>
      {can(access.data, 'payroll.run.prepare') && (
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <TextField
            label={t('ui.payroll.month')}
            type="month"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
            }}
          />
          <Button type="submit" loading={create.isPending} disabled={!period}>
            {t('ui.payroll.newRun')}
          </Button>
        </form>
      )}
      <FormError error={create.error} />
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.data?.items.length === 0 && (
        <EmptyState title={t('ui.payroll.noRuns')} body={t('ui.payroll.noRunsBody')} />
      )}
      <ul className="grid gap-2">
        {list.data?.items.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3 text-[13.5px]"
          >
            <Link
              to="/payroll/runs/$runId"
              params={{ runId: r.id }}
              className="min-w-0 flex-1 font-semibold hover:underline"
              dir="ltr"
            >
              {r.period}
            </Link>
            <span className="tabular-nums">
              {t('ui.payroll.runLine', {
                people: r.totals.people,
                net: formatMoney(locale, r.totals.net, 'KWD'),
              })}
            </span>
            {r.testRun && (
              <small className="rounded-full bg-butter px-2 py-0.5 font-semibold text-butter-ink">
                {t('ui.payroll.testRun')}
              </small>
            )}
            <StatusChip status={RUN_CHIP[r.status]} label={t(`ui.payroll.status.${r.status}`)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Salaries() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const access = useAccess(true);
  const list = useQuery({
    queryKey: ['payroll', 'salaries'],
    queryFn: () => api('/payroll/salaries', { schema: salaryListResponseSchema }),
  });
  const people = useQuery({
    queryKey: ['people', 'list', ''],
    queryFn: () => api('/people', { schema: employeeListResponseSchema }),
  });
  const [form, setForm] = useState({
    membershipId: '',
    effectiveFrom: new Date().toISOString().slice(0, 8) + '01',
    basic: '',
    housing: '',
    transport: '',
  });
  const [si, setSi] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      api('/payroll/salaries', {
        method: 'POST',
        body: {
          membershipId: form.membershipId,
          effectiveFrom: form.effectiveFrom,
          basic: form.basic.trim(),
          allowances: [
            ...(form.housing.trim()
              ? [{ code: 'housing', label: 'Housing', amount: form.housing.trim() }]
              : []),
            ...(form.transport.trim()
              ? [{ code: 'transport', label: 'Transport', amount: form.transport.trim() }]
              : []),
          ],
          socialInsurance: si,
        },
        schema: salaryListResponseSchema,
      }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.payroll.salarySaved') });
      await queryClient.invalidateQueries({ queryKey: ['payroll', 'salaries'] });
    },
  });
  const money = (v: string) => formatMoney(locale, v, 'KWD');
  return (
    <Card>
      {can(access.data, 'payroll.run.prepare') && (
        <form
          noValidate
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <SelectField
            label={t('ui.payroll.person')}
            placeholder={t('ui.payroll.person')}
            value={form.membershipId}
            onValueChange={(v) => {
              setForm({ ...form, membershipId: v });
            }}
            options={(people.data?.items ?? [])
              .filter((p) => p.status !== 'left')
              .map((p) => ({ value: p.membershipId, label: p.name }))}
          />
          <TextField
            label={t('ui.payroll.effectiveFrom')}
            type="date"
            value={form.effectiveFrom}
            onChange={(e) => {
              setForm({ ...form, effectiveFrom: e.target.value });
            }}
          />
          <TextField
            label={t('ui.payroll.basic')}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.000"
            value={form.basic}
            onChange={(e) => {
              setForm({ ...form, basic: e.target.value });
            }}
          />
          <TextField
            label={t('ui.payroll.housing')}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.000"
            value={form.housing}
            onChange={(e) => {
              setForm({ ...form, housing: e.target.value });
            }}
          />
          <TextField
            label={t('ui.payroll.transport')}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.000"
            value={form.transport}
            onChange={(e) => {
              setForm({ ...form, transport: e.target.value });
            }}
          />
          <div className="pb-2.5 md:self-end">
            <Checkbox
              label={t('ui.payroll.socialInsurance')}
              checked={si}
              onCheckedChange={setSi}
            />
          </div>
          <Button
            type="submit"
            className="w-fit"
            loading={add.isPending}
            disabled={!form.membershipId || !form.basic.trim()}
          >
            {t('ui.payroll.saveSalary')}
          </Button>
        </form>
      )}
      <FormError error={add.error} />
      {list.data?.items.length === 0 && (
        <EmptyState title={t('ui.payroll.noSalaries')} body={t('ui.states.emptyBody')} />
      )}
      <ul className="grid gap-2 text-[13.5px]">
        {list.data?.items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3">
            <b className="min-w-0 flex-1">{s.person.name}</b>
            <span className="tabular-nums">
              {t('ui.payroll.salaryLine', {
                date: s.effectiveFrom,
                basic: money(s.basic),
                allowances:
                  s.allowances.map((a) => `${a.label} ${money(a.amount)}`).join(' · ') || '—',
              })}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Rules() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const access = useAccess(true);
  const list = useQuery({
    queryKey: ['payroll', 'rules'],
    queryFn: () => api('/payroll/rules', { schema: ruleSetListResponseSchema }),
  });
  const current = list.data?.items[0];
  const [draft, setDraft] = useState<PayrollRulesInput | null>(null);
  const [note, setNote] = useState('');
  const [verifyNote, setVerifyNote] = useState('');
  const rules = draft ?? current?.rules;
  const save = useMutation({
    mutationFn: () =>
      api('/payroll/rules', {
        method: 'POST',
        body: { effectiveFrom: new Date().toISOString().slice(0, 10), rules, note },
        schema: ruleSetListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['payroll', 'rules'], data);
      setDraft(null);
      setNote('');
      toast({ tone: 'good', title: t('ui.payroll.rulesSaved') });
    },
  });
  const verify = useMutation({
    mutationFn: (id: string) =>
      api(`/payroll/rules/${id}/verify`, {
        method: 'POST',
        body: { confirm: true, note: verifyNote },
        schema: ruleSetListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['payroll', 'rules'], data);
      setVerifyNote('');
    },
  });
  if (!rules || !current) return <LoadingState label={t('ui.common.loading')} lines={3} />;
  const edit = (patch: Partial<PayrollRulesInput>) => {
    setDraft({ ...rules, ...patch });
  };
  const prepare = can(access.data, 'payroll.run.prepare');
  return (
    <div className="grid gap-4">
      <Card title={t('ui.payroll.rulesVersion', { version: current.version })}>
        {current.toVerify ? (
          <small className="rounded-full bg-butter px-2 py-0.5 font-semibold text-butter-ink w-fit">
            {t('ui.payroll.toVerify')}
          </small>
        ) : (
          <small className="rounded-full bg-mint px-2 py-0.5 font-semibold text-mint-ink w-fit">
            {t('ui.payroll.verified')}
          </small>
        )}
        <fieldset disabled={!prepare} className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t('ui.payroll.rules.workingDaysDivisor')}
            inputMode="decimal"
            dir="ltr"
            value={rules.workingDaysDivisor}
            onChange={(e) => {
              edit({ workingDaysDivisor: e.target.value });
            }}
          />
          <TextField
            label={t('ui.payroll.rules.monthlyHours')}
            inputMode="decimal"
            dir="ltr"
            value={rules.monthlyHours}
            onChange={(e) => {
              edit({ monthlyHours: e.target.value });
            }}
          />
          <Checkbox
            label={t('ui.payroll.rules.overtime')}
            checked={rules.overtime.enabled}
            onCheckedChange={(on) => {
              edit({ overtime: { ...rules.overtime, enabled: on } });
            }}
          />
          <TextField
            label={t('ui.payroll.rules.overtimeMultiplier')}
            inputMode="decimal"
            dir="ltr"
            value={rules.overtime.multiplier}
            onChange={(e) => {
              edit({ overtime: { ...rules.overtime, multiplier: e.target.value } });
            }}
          />
          <Checkbox
            label={t('ui.payroll.rules.unpaidLeave')}
            checked={rules.unpaidLeave.enabled}
            onCheckedChange={(on) => {
              edit({ unpaidLeave: { enabled: on } });
            }}
          />
          <Checkbox
            label={t('ui.payroll.rules.lateDeduction')}
            checked={rules.lateDeduction.enabled}
            onCheckedChange={(on) => {
              edit({ lateDeduction: { enabled: on } });
            }}
          />
          <Checkbox
            label={t('ui.payroll.rules.socialInsurance')}
            checked={rules.socialInsurance.enabled}
            onCheckedChange={(on) => {
              edit({ socialInsurance: { ...rules.socialInsurance, enabled: on } });
            }}
          />
          <TextField
            label={t('ui.payroll.rules.socialInsurancePercent')}
            inputMode="decimal"
            dir="ltr"
            value={rules.socialInsurance.employeePercent}
            onChange={(e) => {
              edit({
                socialInsurance: { ...rules.socialInsurance, employeePercent: e.target.value },
              });
            }}
          />
        </fieldset>
        {prepare && draft && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1">
              <TextField
                label={t('ui.payroll.changeNote')}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </div>
            <Button
              loading={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {t('ui.payroll.saveVersion')}
            </Button>
          </div>
        )}
        <FormError error={save.error} />
        {current.toVerify && can(access.data, 'payroll.run.approve') && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <div className="min-w-[240px] flex-1">
              <TextField
                label={t('ui.payroll.verifyNote')}
                value={verifyNote}
                onChange={(e) => {
                  setVerifyNote(e.target.value);
                }}
              />
            </div>
            <Button
              variant="secondary"
              loading={verify.isPending}
              disabled={!verifyNote.trim()}
              onClick={() => {
                verify.mutate(current.id);
              }}
            >
              {t('ui.payroll.confirmVerified')}
            </Button>
          </div>
        )}
        <FormError error={verify.error} />
      </Card>
      <Card title={t('ui.payroll.history')}>
        <ul className="grid gap-1.5 text-[13px]">
          {list.data?.items.map((r) => (
            <li key={r.id}>
              {t('ui.payroll.versionLine', {
                version: r.version,
                from: r.effectiveFrom,
                note: r.note || '—',
              })}
              {r.toVerify ? ` · ${t('ui.payroll.toVerify')}` : ` · ${t('ui.payroll.verified')}`}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
