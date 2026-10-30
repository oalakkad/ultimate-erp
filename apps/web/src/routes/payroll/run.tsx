import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import {
  employeeListResponseSchema,
  PAYROLL_INPUT_KINDS,
  type PayrollRun,
  payrollRunSchema,
  type Payslip,
} from '@ultimate-erp/contracts';
import { formatMoney } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { PayrollWarning, RUN_CHIP } from './payroll.js';

type InputKind = (typeof PAYROLL_INPUT_KINDS)[number];
type Row = { membershipId: string; kind: InputKind; value: string; note: string };

/** One month's payroll run. */
export function PayrollRunPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { runId } = useParams({ from: '/app/payroll/runs/$runId' });
  const key = ['payroll', 'run', runId];
  const run = useQuery({
    queryKey: key,
    queryFn: () => api(`/payroll/runs/${runId}`, { schema: payrollRunSchema }),
  });
  const act = useMutation({
    mutationFn: (action: 'calculate' | 'submit' | 'approve' | 'pay' | 'cancel') =>
      api(`/payroll/runs/${runId}/${action}`, {
        method: 'POST',
        body: {},
        schema: payrollRunSchema,
      }),
    onSuccess: async (data, action) => {
      queryClient.setQueryData(key, data);
      toast({ tone: 'good', title: t(`ui.payroll.done.${action}`) });
      await queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    },
  });
  if (run.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (run.isError) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, run.error)}
        reference={errorReference(t, run.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void run.refetch()}
      />
    );
  }
  const r = run.data;
  const money = (v: string) => formatMoney(locale, v, 'KWD');
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.payroll.runTitle', { period: r.period })} />
      <PayrollWarning />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <StatusChip status={RUN_CHIP[r.status]} label={t(`ui.payroll.status.${r.status}`)} />
        {r.testRun && (
          <small className="rounded-full bg-butter px-2 py-0.5 font-semibold text-butter-ink">
            {t('ui.payroll.testRun')}
          </small>
        )}
        {r.ruleSetVersion !== null && (
          <span>{t('ui.payroll.usesVersion', { version: r.ruleSetVersion })}</span>
        )}
        {r.preparedByName && (
          <span>· {t('ui.payroll.preparedBy', { name: r.preparedByName })}</span>
        )}
        {r.approvedByName && (
          <span>· {t('ui.payroll.approvedBy', { name: r.approvedByName })}</span>
        )}
        {r.paidByName && <span>· {t('ui.payroll.paidBy', { name: r.paidByName })}</span>}
      </div>
      <Card title={t('ui.payroll.totalsTitle')}>
        <dl className="grid gap-3 sm:grid-cols-4">
          {(
            [
              ['people', String(r.totals.people)],
              ['gross', money(r.totals.gross)],
              ['deductions', money(r.totals.deductions)],
              ['net', money(r.totals.net)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="grid gap-0.5 rounded-tile bg-frame p-3">
              <dt className="text-[12px] font-semibold text-ink-3">
                {t(`ui.payroll.totals.${k}`)}
              </dt>
              <dd className="text-[16px] font-bold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {r.warnings.length > 0 && (
          <ul
            role="status"
            className="grid gap-1 rounded-tile bg-blush p-3 text-[13px] text-blush-ink"
          >
            {r.warnings.map((w) => (
              <li key={`${w.person.membershipId}-${w.code}`}>
                {t(`ui.payroll.warning.${w.code as 'no_salary_record'}`, { name: w.person.name })}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {(['calculate', 'submit', 'approve', 'pay', 'cancel'] as const)
            .filter((a) => r.actions.includes(a))
            .map((a) => (
              <Button
                key={a}
                variant={a === 'cancel' ? 'secondary' : 'primary'}
                loading={act.isPending && act.variables === a}
                onClick={() => {
                  act.mutate(a);
                }}
              >
                {t(`ui.payroll.actions.${a}`)}
              </Button>
            ))}
          {r.actions.includes('export') && (
            <a
              href={`/api/v1/payroll/runs/${r.id}/export.csv`}
              className="inline-flex h-10 items-center rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame"
            >
              {t('ui.payroll.actions.export')}
            </a>
          )}
        </div>
        {r.status === 'approved' && r.testRun && (
          <small className="text-ink-3">{t('ui.payroll.cannotPayTest')}</small>
        )}
        <FormError error={act.error} />
      </Card>
      {r.actions.includes('inputs') && <InputsCard key={r.version} run={r} />}
      <Card title={t('ui.payroll.payslips')}>
        {r.payslips.length === 0 && (
          <p className="text-[13.5px] text-ink-2">{t('ui.payroll.notCalculated')}</p>
        )}
        <ul className="grid gap-2">
          {r.payslips.map((p) => (
            <PayslipRow key={p.id} payslip={p} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function PayslipRow({
  payslip: p,
  showPerson = true,
}: {
  payslip: Payslip;
  showPerson?: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const money = (v: string) => formatMoney(locale, v, p.currency);
  return (
    <li className="grid gap-2 rounded-tile bg-frame p-3 text-[13.5px]">
      <div className="flex flex-wrap items-center gap-3">
        <b className="min-w-0 flex-1">
          {showPerson ? p.person.name : t('ui.payroll.runTitle', { period: p.run.period })}
        </b>
        <span className="tabular-nums">{t('ui.payroll.netLine', { net: money(p.net) })}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? t('ui.payroll.hideLines') : t('ui.payroll.showLines')}
        </Button>
      </div>
      {open && (
        <table className="w-full text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr>
              <th scope="col" className="py-1 text-start font-semibold">
                {t('ui.payroll.line')}
              </th>
              <th scope="col" className="py-1 text-start font-semibold">
                {t('ui.payroll.basis')}
              </th>
              <th scope="col" className="py-1 text-end font-semibold">
                {t('ui.payroll.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.code} className="border-t border-line">
                <td className="py-1">
                  {t(
                    `ui.payroll.lineName.${(l.code.startsWith('allowance.') ? 'allowance' : l.code) as 'basic'}`,
                    { label: l.label },
                  )}
                </td>
                <td className="py-1 text-ink-3" dir="ltr">
                  {l.basis}
                </td>
                <td className="py-1 text-end tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line font-bold">
              <td className="py-1">{t('ui.payroll.totals.net')}</td>
              <td />
              <td className="py-1 text-end tabular-nums">{money(p.net)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </li>
  );
}

function InputsCard({ run }: { run: PayrollRun }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const people = useQuery({
    queryKey: ['people', 'list', ''],
    queryFn: () => api('/people', { schema: employeeListResponseSchema }),
  });
  const [rows, setRows] = useState<Row[]>(
    run.inputs.map((i) => ({
      membershipId: i.membershipId,
      kind: i.kind,
      value: i.value,
      note: i.note ?? '',
    })),
  );
  const save = useMutation({
    mutationFn: () =>
      api(`/payroll/runs/${run.id}/inputs`, {
        method: 'PUT',
        body: {
          inputs: rows
            .filter((r) => r.membershipId && r.value.trim())
            .map((r) => ({ ...r, value: r.value.trim() })),
        },
        schema: payrollRunSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['payroll', 'run', run.id], data);
    },
  });
  const update = (i: number, patch: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  return (
    <Card title={t('ui.payroll.inputs')}>
      <small className="text-ink-3">{t('ui.payroll.inputsHint')}</small>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1.5fr_1fr_2fr_auto] sm:items-end">
          <SelectField
            label={t('ui.payroll.person')}
            placeholder={t('ui.payroll.person')}
            value={r.membershipId}
            onValueChange={(v) => {
              update(i, { membershipId: v });
            }}
            options={(people.data?.items ?? []).map((p) => ({
              value: p.membershipId,
              label: p.name,
            }))}
          />
          <SelectField
            label={t('ui.payroll.kind')}
            placeholder={t('ui.payroll.kind')}
            value={r.kind}
            onValueChange={(v) => {
              update(i, { kind: v as InputKind });
            }}
            options={PAYROLL_INPUT_KINDS.map((k) => ({
              value: k,
              label: t(`ui.payroll.inputKind.${k}`),
            }))}
          />
          <TextField
            label={
              r.kind === 'overtime_hours' ? t('ui.payroll.hoursValue') : t('ui.payroll.kwdValue')
            }
            inputMode="decimal"
            dir="ltr"
            value={r.value}
            onChange={(e) => {
              update(i, { value: e.target.value });
            }}
          />
          <TextField
            label={t('ui.payroll.note')}
            value={r.note}
            onChange={(e) => {
              update(i, { note: e.target.value });
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRows(rows.filter((_, j) => j !== i));
            }}
          >
            {t('ui.people.remove')}
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setRows([...rows, { membershipId: '', kind: 'overtime_hours', value: '', note: '' }]);
          }}
        >
          {t('ui.payroll.addInput')}
        </Button>
        <Button
          size="sm"
          loading={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {t('ui.payroll.saveInputs')}
        </Button>
      </div>
      <FormError error={save.error} />
    </Card>
  );
}
