import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fileSchema,
  holidayListResponseSchema,
  LEAVE_ACCRUALS,
  leaveBalanceSchema,
  leaveCalendarSchema,
  leaveListResponseSchema,
  leavePreviewSchema,
  type LeaveRequest,
  leaveRequestSchema,
  type LeaveStatus,
  type LeaveType,
  leaveTypeListResponseSchema,
} from '@ultimate-erp/contracts';
import { formatDate, formatNumber } from '@ultimate-erp/i18n';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
  Tabs,
  TextArea,
  TextField,
  initialsOf,
  Ring,
  StatCard,
  useToast,
} from '@ultimate-erp/ui';
import { CalendarCheck2, CalendarRange, Hourglass, Palmtree } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, canAny, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';

const CHIP: Record<LeaveStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  pending: 'warn',
  approved: 'good',
  rejected: 'bad',
  withdrawn: 'info',
  cancelled: 'info',
};
const kuwaitToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const shift = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function VerifyNote() {
  const { t } = useI18n();
  return (
    <p role="note" className="rounded-tile bg-butter p-3 text-[13px] text-butter-ink">
      {t('ui.leave.verifyNote')}
    </p>
  );
}

/** Leave (brief Module H): my leave, approvals, team calendar and company policies. */
export function LeavePage() {
  const { t } = useI18n();
  const access = useAccess(true);
  const approver = canAny(access.data, 'leave.request.approve');
  const policy = can(access.data, 'leave.policy.manage');
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.leave.title')} />
      <LeaveOverview approver={approver} />
      <Tabs
        label={t('ui.leave.title')}
        items={[
          { value: 'mine', label: t('ui.leave.tabs.mine'), content: <MyLeave /> },
          ...(approver
            ? [{ value: 'approvals', label: t('ui.leave.tabs.approvals'), content: <Approvals /> }]
            : []),
          { value: 'calendar', label: t('ui.leave.tabs.calendar'), content: <Calendar /> },
          ...(policy
            ? [{ value: 'policies', label: t('ui.leave.tabs.policies'), content: <Policies /> }]
            : []),
        ]}
      />
    </div>
  );
}

const typeName = (locale: string, n: { en: string; ar: string }) => (locale === 'ar' ? n.ar : n.en);

const RING_COLORS = [
  'var(--mint-solid)',
  'var(--sky-solid)',
  'var(--lilac-solid)',
  'var(--butter-solid)',
];

/**
 * The leave picture at a glance (redesign 2026-11-08): my balance, what waits for me, who is
 * away today and in the next two weeks — every number from the leave API (the server applies
 * the company's leave rules; nothing is calculated here).
 */
function LeaveOverview({ approver }: { approver: boolean }) {
  const { t, locale } = useI18n();
  const today = kuwaitToday();
  const until = shift(today, 13);
  const balances = useQuery({
    queryKey: ['leave', 'balances', 'me'],
    queryFn: () => api('/leave/balances', { schema: leaveBalanceSchema }),
  });
  const approvals = useQuery({
    queryKey: ['leave', 'approvals'],
    queryFn: () => api('/leave/requests?view=approvals', { schema: leaveListResponseSchema }),
    enabled: approver,
  });
  const calendar = useQuery({
    queryKey: ['leave', 'calendar', today, until],
    queryFn: () =>
      api(`/leave/calendar?from=${today}&to=${until}`, { schema: leaveCalendarSchema }),
  });
  const annual = balances.data?.items.find((i) => i.type.code === 'annual');
  const approved = calendar.data?.leave.filter((l) => l.status === 'approved') ?? [];
  const awayToday = approved.filter((l) => l.startDate <= today && l.endDate >= today);
  const upcoming = [...approved].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const people = new Set(approved.map((l) => l.person.membershipId)).size;
  const nextHoliday = calendar.data?.holidays.find((h) => h.date >= today);
  const short = (iso: string) =>
    formatDate(locale, new Date(`${iso}T12:00:00Z`), { day: 'numeric', month: 'short' });
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="ui-stagger grid content-start gap-4 sm:grid-cols-2">
        <StatCard
          tone="mint"
          icon={<Palmtree />}
          label={t('ui.ws.leave.myAnnual')}
          value={annual ? t('ui.leave.daysValue', { days: annual.balance }) : '—'}
          hint={
            annual
              ? t('ui.ws.leave.annualHint', { taken: annual.taken, pending: annual.pending })
              : undefined
          }
        />
        {approver ? (
          <StatCard
            tone="butter"
            icon={<Hourglass />}
            label={t('ui.ws.leave.waiting')}
            value={formatNumber(locale, approvals.data?.items.length ?? 0)}
            hint={t('ui.ws.leave.waitingHint')}
          />
        ) : (
          <StatCard
            tone="butter"
            icon={<Hourglass />}
            label={t('ui.ws.leave.myPending')}
            value={annual ? t('ui.leave.daysValue', { days: annual.pending }) : '—'}
          />
        )}
        <StatCard
          tone="sky"
          icon={<CalendarCheck2 />}
          label={t('ui.ws.leave.awayToday')}
          value={formatNumber(locale, new Set(awayToday.map((l) => l.person.membershipId)).size)}
          hint={awayToday.map((l) => l.person.name).join(', ') || t('ui.ws.leave.everyoneIn')}
        />
        <StatCard
          tone="lilac"
          icon={<CalendarRange />}
          label={t('ui.ws.leave.awaySoon')}
          value={formatNumber(locale, people)}
          hint={
            nextHoliday
              ? t('ui.ws.leave.nextHoliday', {
                  name: locale === 'ar' ? nextHoliday.nameAr : nextHoliday.nameEn,
                  date: short(nextHoliday.date),
                })
              : undefined
          }
        />
      </div>
      <Card title={t('ui.ws.leave.upcoming')}>
        {calendar.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        {calendar.data && upcoming.length === 0 && (
          <p className="text-[13px] text-ink-2">{t('ui.ws.leave.noneUpcoming')}</p>
        )}
        <ul className="grid gap-2.5">
          {upcoming.slice(0, 5).map((l) => {
            const now = l.startDate <= today;
            return (
              <li key={l.id} className="flex items-center gap-3">
                <Avatar name={l.person.name} initials={initialsOf(l.person.name)} size={34} />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[13px] font-semibold">{l.person.name}</span>
                  <span className="text-[12px] text-ink-3">{typeName(locale, l.type)}</span>
                </span>
                <span
                  className={`num rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${now ? 'bg-sky text-sky-ink' : 'bg-frame text-ink-2'}`}
                >
                  {now
                    ? t('ui.ws.leave.nowUntil', { date: short(l.endDate) })
                    : `${short(l.startDate)} – ${short(l.endDate)}`}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function MyLeave() {
  const { t, locale } = useI18n();
  const balances = useQuery({
    queryKey: ['leave', 'balances', 'me'],
    queryFn: () => api('/leave/balances', { schema: leaveBalanceSchema }),
  });
  const mine = useQuery({
    queryKey: ['leave', 'mine'],
    queryFn: () => api('/leave/requests?view=mine', { schema: leaveListResponseSchema }),
  });
  return (
    <div className="grid gap-4">
      <Card title={t('ui.leave.balances', { year: balances.data?.year ?? '' })}>
        {balances.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        {balances.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, balances.error)}
            reference={errorReference(t, balances.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void balances.refetch()}
          />
        )}
        {balances.data && (
          <>
            <dl className="ui-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {balances.data.items
                .filter((i) => i.deductsBalance)
                .map((i, index) => (
                  <div
                    key={i.type.id}
                    className="flex items-center gap-3.5 rounded-tile border border-line bg-frame p-3.5"
                  >
                    <Ring
                      label={t('ui.ws.leave.ringLabel', {
                        type: typeName(locale, i.type.name),
                        left: i.balance,
                      })}
                      value={Math.max(0, Number(i.balance))}
                      max={Math.max(
                        Number(i.accrued) + Number(i.adjustments),
                        Number(i.balance),
                        1,
                      )}
                      color={RING_COLORS[index % RING_COLORS.length]}
                      size={64}
                    >
                      <b className="num text-[15px] font-extrabold">
                        {formatNumber(locale, Number(i.balance))}
                      </b>
                    </Ring>
                    <div className="grid min-w-0 gap-0.5">
                      <dt className="truncate text-[12.5px] font-bold">
                        {typeName(locale, i.type.name)}
                      </dt>
                      <dd className="text-[12px] font-semibold text-ink-2">
                        {t('ui.leave.daysValue', { days: i.balance })}
                      </dd>
                      <dd className="text-[11.5px] text-ink-3">
                        {t('ui.leave.balanceLine', {
                          accrued: i.accrued,
                          taken: i.taken,
                          pending: i.pending,
                        })}
                      </dd>
                    </div>
                  </div>
                ))}
            </dl>
            {balances.data.items.some((i) => i.type.toVerify) && <VerifyNote />}
          </>
        )}
      </Card>
      <ApplyCard />
      <Card title={t('ui.leave.myRequests')}>
        {mine.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        {mine.data?.items.length === 0 && (
          <EmptyState title={t('ui.leave.noRequests')} body={t('ui.leave.noRequestsBody')} />
        )}
        <ul className="grid gap-2">
          {mine.data?.items.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ApplyCard() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const types = useQuery({
    queryKey: ['leave', 'types'],
    queryFn: () => api('/leave/types', { schema: leaveTypeListResponseSchema }),
  });
  const [typeId, setTypeId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState('');
  const [hasFile, setHasFile] = useState(false);
  const type = types.data?.items.find((x) => x.id === typeId);
  const single = Boolean(start) && start === end;
  const ready = Boolean(typeId && start && end && end >= start);
  const body = useDebounced(
    JSON.stringify({
      leaveTypeId: typeId,
      startDate: start,
      endDate: end,
      halfDay: single && half ? 'first' : 'none',
    }),
  );
  const preview = useQuery({
    queryKey: ['leave', 'preview', body],
    enabled: ready,
    queryFn: () =>
      api('/leave/requests/preview', {
        method: 'POST',
        body: JSON.parse(body) as object,
        schema: leavePreviewSchema,
      }),
    placeholderData: (previous) => previous,
  });
  const submit = useMutation({
    mutationFn: async () => {
      let fileId: string | null = null;
      const file = fileInput.current?.files?.[0];
      if (file) {
        const form = new FormData();
        form.append('file', file);
        fileId = (await api('/files', { method: 'POST', body: form, schema: fileSchema })).id;
      }
      return api('/leave/requests', {
        method: 'POST',
        body: {
          leaveTypeId: typeId,
          startDate: start,
          endDate: end,
          halfDay: single && half ? 'first' : 'none',
          reason,
          fileId,
        },
        schema: leaveRequestSchema,
      });
    },
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.leave.applied') });
      setStart('');
      setEnd('');
      setReason('');
      setHalf(false);
      if (fileInput.current) fileInput.current.value = '';
      setHasFile(false);
      await queryClient.invalidateQueries({ queryKey: ['leave'] });
    },
  });
  const problems = (preview.data?.problems ?? []).filter(
    (p) => !(p === 'document_required' && hasFile),
  );
  return (
    <Card title={t('ui.leave.apply')}>
      <form
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField
            label={t('ui.leave.type')}
            placeholder={t('ui.leave.type')}
            value={typeId}
            onValueChange={setTypeId}
            options={(types.data?.items ?? [])
              .filter((x) => !x.archived)
              .map((x) => ({ value: x.id, label: typeName(locale, x.name) }))}
          />
          <TextField
            label={t('ui.leave.from')}
            type="date"
            min={kuwaitToday()}
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (!end || end < e.target.value) setEnd(e.target.value);
            }}
          />
          <TextField
            label={t('ui.leave.to')}
            type="date"
            min={start || kuwaitToday()}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
            }}
          />
        </div>
        {single && type?.allowHalfDay && (
          <Checkbox label={t('ui.leave.halfDay')} checked={half} onCheckedChange={setHalf} />
        )}
        <TextArea
          label={t('ui.leave.reason')}
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        {type?.requiresDocument && (
          <label className="grid gap-1.5 text-[13px] font-semibold">
            {t('ui.leave.document')}
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="text-[13px] font-normal"
              onChange={(e) => {
                setHasFile(Boolean(e.target.files?.length));
              }}
            />
          </label>
        )}
        {ready && preview.data && (
          <div
            role="status"
            className={`grid gap-1 rounded-tile p-3 text-[13.5px] ${problems.length > 0 ? 'bg-blush text-blush-ink' : 'bg-mint text-mint-ink'}`}
          >
            <span>
              {t('ui.leave.previewDays', { days: preview.data.days })}
              {preview.data.balanceAfter !== null &&
                ` · ${t('ui.leave.previewBalance', { before: preview.data.balanceBefore ?? '', after: preview.data.balanceAfter })}`}
            </span>
            {problems.map((p) => (
              <b key={p}>{t(`ui.leave.problem.${p}`)}</b>
            ))}
          </div>
        )}
        <FormError error={submit.error} />
        <Button
          type="submit"
          className="w-fit"
          loading={submit.isPending}
          disabled={!ready || problems.length > 0}
        >
          {t('ui.leave.submit')}
        </Button>
      </form>
    </Card>
  );
}

function RequestRow({ request: r }: { request: LeaveRequest }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'reject' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const act = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'withdraw' | 'cancel') =>
      api(`/leave/requests/${r.id}/${action}`, {
        method: 'POST',
        body: action === 'withdraw' ? {} : note ? { note } : {},
        schema: leaveRequestSchema,
      }),
    onSuccess: async (_d, action) => {
      toast({ tone: 'good', title: t(`ui.leave.done.${action}`) });
      setDialog(null);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['leave'] });
    },
  });
  const date = (iso: string) =>
    formatDate(locale, new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' });
  return (
    <li className="grid gap-1.5 rounded-tile bg-frame p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid min-w-0 flex-1">
          <b className="text-[13.5px]">
            {r.person.name} · {typeName(locale, r.type.name)}
          </b>
          <small className="text-ink-3">
            {r.startDate === r.endDate
              ? date(r.startDate)
              : `${date(r.startDate)} – ${date(r.endDate)}`}{' '}
            · {t('ui.leave.daysValue', { days: r.days })}
            {r.reason ? ` · ${r.reason}` : ''}
          </small>
        </div>
        <StatusChip status={CHIP[r.status]} label={t(`ui.leave.status.${r.status}`)} />
        {r.actions.includes('approve') && (
          <Button
            size="sm"
            loading={act.isPending && act.variables === 'approve'}
            onClick={() => {
              act.mutate('approve');
            }}
          >
            {t('ui.leave.actions.approve')}
          </Button>
        )}
        {r.actions.includes('reject') && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              act.reset();
              setDialog('reject');
            }}
          >
            {t('ui.leave.actions.reject')}
          </Button>
        )}
        {r.actions.includes('withdraw') && (
          <Button
            size="sm"
            variant="ghost"
            loading={act.isPending}
            onClick={() => {
              act.mutate('withdraw');
            }}
          >
            {t('ui.leave.actions.withdraw')}
          </Button>
        )}
        {r.actions.includes('cancel') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              act.reset();
              setDialog('cancel');
            }}
          >
            {t('ui.leave.actions.cancel')}
          </Button>
        )}
      </div>
      {r.decisionNote && (
        <small className="text-ink-2">
          {t('ui.leave.note', { note: r.decisionNote, name: r.decidedByName ?? '' })}
        </small>
      )}
      {!dialog && <FormError error={act.error} />}
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        title={dialog ? t(`ui.leave.actions.${dialog}`) : ''}
        description={dialog === 'cancel' ? t('ui.leave.cancelHint') : undefined}
        closeLabel={t('ui.common.close')}
      >
        <TextArea
          label={t('ui.leave.decisionNote')}
          rows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <FormError error={act.error} />
        <Button
          className="w-fit"
          loading={act.isPending}
          disabled={dialog === 'reject' && !note.trim()}
          onClick={() => {
            if (dialog) act.mutate(dialog);
          }}
        >
          {dialog ? t(`ui.leave.actions.${dialog}`) : ''}
        </Button>
      </Dialog>
    </li>
  );
}

function Approvals() {
  const { t } = useI18n();
  const list = useQuery({
    queryKey: ['leave', 'approvals'],
    queryFn: () => api('/leave/requests?view=approvals', { schema: leaveListResponseSchema }),
  });
  return (
    <Card>
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.data?.items.length === 0 && (
        <EmptyState title={t('ui.leave.nothingWaiting')} body={t('ui.leave.nothingWaitingBody')} />
      )}
      <ul className="grid gap-2">
        {list.data?.items.map((r) => (
          <RequestRow key={r.id} request={r} />
        ))}
      </ul>
    </Card>
  );
}

function Calendar() {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(kuwaitToday());
  const to = shift(from, 27);
  const data = useQuery({
    queryKey: ['leave', 'calendar', from],
    queryFn: () => api(`/leave/calendar?from=${from}&to=${to}`, { schema: leaveCalendarSchema }),
  });
  const days = Array.from({ length: 28 }, (_, i) => shift(from, i));
  return (
    <Card
      title={t('ui.leave.calendarTitle', {
        from: formatDate(locale, new Date(`${from}T12:00:00Z`), { dateStyle: 'medium' }),
        to: formatDate(locale, new Date(`${to}T12:00:00Z`), { dateStyle: 'medium' }),
      })}
      action={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setFrom(shift(from, -28));
            }}
          >
            {t('ui.leave.earlier')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setFrom(shift(from, 28));
            }}
          >
            {t('ui.leave.later')}
          </Button>
        </div>
      }
    >
      {data.isPending && <LoadingState label={t('ui.common.loading')} lines={3} />}
      {data.data && data.data.leave.length === 0 && data.data.holidays.length === 0 && (
        <EmptyState title={t('ui.leave.calendarEmpty')} body={t('ui.states.emptyBody')} />
      )}
      {data.data && (data.data.leave.length > 0 || data.data.holidays.length > 0) && (
        <TeamGrid days={days} leave={data.data.leave} holidays={data.data.holidays} />
      )}
    </Card>
  );
}

interface GridLeave {
  id: string;
  person: { membershipId: string; name: string };
  type: { en: string; ar: string };
  startDate: string;
  endDate: string;
  status: 'pending' | 'approved';
}

/** People × days: who is away when. Approved = solid sky; pending = striped butter + "?". */
function TeamGrid({
  days,
  leave,
  holidays,
}: {
  days: string[];
  leave: GridLeave[];
  holidays: { date: string; nameEn: string; nameAr: string }[];
}) {
  const { t, locale } = useI18n();
  const people = [...new Map(leave.map((l) => [l.person.membershipId, l.person])).values()];
  const today = kuwaitToday();
  const weekend = (d: string) => {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    return w === 5 || w === 6;
  };
  const holidayOn = (d: string) => holidays.find((h) => h.date === d);
  const shade = (d: string) => (holidayOn(d) ? 'bg-lilac' : weekend(d) ? 'bg-frame' : '');
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <caption className="sr-only">{t('ui.ws.leave.gridCaption')}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky start-0 z-10 min-w-[150px] bg-[var(--pop)] py-1 text-start font-semibold text-ink-3"
              >
                {t('ui.ws.leave.person')}
              </th>
              {days.map((d) => {
                const h = holidayOn(d);
                const date = new Date(`${d}T12:00:00Z`);
                return (
                  <th
                    key={d}
                    scope="col"
                    title={h ? (locale === 'ar' ? h.nameAr : h.nameEn) : undefined}
                    className={`min-w-[30px] px-0.5 py-1 text-center font-semibold ${d === today ? 'text-plum' : 'text-ink-3'} ${shade(d)}`}
                  >
                    <span className="block text-[10px] font-normal">
                      {formatDate(locale, date, { weekday: 'narrow' })}
                    </span>
                    <span
                      className={`num ${d === today ? 'rounded-full bg-plum px-1 text-on-plum' : ''}`}
                    >
                      {formatDate(locale, date, { day: 'numeric' })}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={days.length + 1} className="py-3 text-ink-3">
                  {t('ui.ws.leave.noneUpcoming')}
                </td>
              </tr>
            )}
            {people.map((p) => (
              <tr key={p.membershipId}>
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-[var(--pop)] py-1.5 pe-2 text-start font-semibold"
                >
                  <span className="flex items-center gap-2">
                    <Avatar name={p.name} initials={initialsOf(p.name)} size={24} />
                    <span className="truncate">{p.name}</span>
                  </span>
                </th>
                {days.map((d) => {
                  const l = leave.find(
                    (x) =>
                      x.person.membershipId === p.membershipId &&
                      x.startDate <= d &&
                      x.endDate >= d,
                  );
                  const label = l
                    ? `${typeName(locale, l.type)}${l.status === 'pending' ? ` (${t('ui.leave.status.pending')})` : ''}`
                    : undefined;
                  return (
                    <td key={d} className={`border-t border-line px-[1px] py-1.5 ${shade(d)}`}>
                      {l && (
                        <span
                          title={label}
                          className={`grid h-5 place-items-center rounded-md text-[10px] font-bold ${
                            l.status === 'approved'
                              ? 'bg-sky-solid text-white'
                              : 'bg-[repeating-linear-gradient(45deg,var(--butter),var(--butter)_3px,var(--butter-solid)_3px,var(--butter-solid)_5px)] text-butter-ink'
                          }`}
                        >
                          <span className="sr-only">{label}</span>
                          <span aria-hidden>{l.status === 'pending' ? '?' : ''}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-wrap gap-4 text-[12px] text-ink-2">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded bg-sky-solid" />
          {t('ui.leave.status.approved')}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded bg-butter-solid" />
          {t('ui.leave.status.pending')}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded bg-lilac" />
          {t('ui.ws.leave.holiday')}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded border border-line bg-frame" />
          {t('ui.ws.leave.weekend')}
        </li>
      </ul>
    </div>
  );
}

function Policies() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: ['leave', 'types'],
    queryFn: () => api('/leave/types', { schema: leaveTypeListResponseSchema }),
  });
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const year = Number(kuwaitToday().slice(0, 4));
  const holidays = useQuery({
    queryKey: ['leave', 'holidays', year],
    queryFn: () => api(`/leave/holidays?year=${year}`, { schema: holidayListResponseSchema }),
  });
  const [holiday, setHoliday] = useState({ date: '', nameEn: '', nameAr: '' });
  const saveHolidays = useMutation({
    mutationFn: (list: { date: string; nameEn: string; nameAr: string }[]) =>
      api('/leave/holidays', {
        method: 'PUT',
        body: { year, holidays: list },
        schema: holidayListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['leave', 'holidays', year], data);
      setHoliday({ date: '', nameEn: '', nameAr: '' });
    },
  });
  const current = holidays.data?.items ?? [];
  return (
    <div className="grid gap-4">
      <VerifyNote />
      <Card title={t('ui.leave.typesTitle')}>
        {types.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        <ul className="grid gap-2">
          {types.data?.items.map((x) => (
            <li
              key={x.id}
              className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3 text-[13.5px]"
            >
              <div className="grid min-w-0 flex-1">
                <b>{typeName(locale, x.name)}</b>
                <small className="text-ink-3">
                  {t('ui.leave.typeLine', {
                    days: x.annualDays,
                    accrual: t(`ui.leave.accrual.${x.accrual}`),
                  })}
                  {x.paid ? '' : ` · ${t('ui.leave.unpaid')}`}
                  {x.requiresDocument ? ` · ${t('ui.leave.needsDocument')}` : ''}
                  {x.archived ? ` · ${t('ui.leave.archived')}` : ''}
                </small>
              </div>
              {x.toVerify && (
                <small className="rounded-full bg-butter px-2 py-0.5 font-semibold text-butter-ink">
                  {t('ui.leave.toVerify')}
                </small>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(x);
                }}
              >
                {t('ui.common.edit')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('ui.leave.holidaysTitle', { year })}>
        <small className="text-ink-3">{t('ui.leave.holidaysHint')}</small>
        <ul className="grid gap-1.5 text-[13.5px]">
          {current.map((h) => (
            <li key={h.date} className="flex items-center justify-between gap-2">
              <span>
                {formatDate(locale, new Date(`${h.date}T12:00:00Z`), { dateStyle: 'medium' })} ·{' '}
                {locale === 'ar' ? h.nameAr : h.nameEn}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  saveHolidays.mutate(current.filter((c) => c.date !== h.date));
                }}
              >
                {t('ui.people.remove')}
              </Button>
            </li>
          ))}
        </ul>
        <form
          noValidate
          className="grid gap-2 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            saveHolidays.mutate([...current, holiday]);
          }}
        >
          <TextField
            label={t('ui.leave.holidayDate')}
            type="date"
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            value={holiday.date}
            onChange={(e) => {
              setHoliday({ ...holiday, date: e.target.value });
            }}
          />
          <TextField
            label={t('ui.leave.holidayNameEn')}
            dir="ltr"
            lang="en"
            value={holiday.nameEn}
            onChange={(e) => {
              setHoliday({ ...holiday, nameEn: e.target.value });
            }}
          />
          <TextField
            label={t('ui.leave.holidayNameAr')}
            dir="rtl"
            lang="ar"
            value={holiday.nameAr}
            onChange={(e) => {
              setHoliday({ ...holiday, nameAr: e.target.value });
            }}
          />
          <Button
            type="submit"
            loading={saveHolidays.isPending}
            disabled={!holiday.date || !holiday.nameEn.trim() || !holiday.nameAr.trim()}
          >
            {t('ui.leave.addHoliday')}
          </Button>
        </form>
        <FormError error={saveHolidays.error} />
      </Card>
      {editing && (
        <TypeDialog
          type={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TypeDialog({ type, onClose }: { type: LeaveType; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    nameEn: type.name.en,
    nameAr: type.name.ar,
    annualDays: type.annualDays,
  });
  const [accrual, setAccrual] = useState(type.accrual);
  const [flags, setFlags] = useState({
    paid: type.paid,
    deductsBalance: type.deductsBalance,
    allowHalfDay: type.allowHalfDay,
    requiresDocument: type.requiresDocument,
    allowNegative: type.allowNegative,
    archived: type.archived,
  });
  const [verified, setVerified] = useState(!type.toVerify);
  const save = useMutation({
    mutationFn: () =>
      api(`/leave/types/${type.id}`, {
        method: 'PATCH',
        body: { ...form, accrual, ...flags, confirmVerified: verified },
        schema: leaveTypeListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['leave', 'types'], data);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('ui.leave.editType')}
      closeLabel={t('ui.common.close')}
    >
      <form
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextField
          label={t('ui.leave.typeNameEn')}
          dir="ltr"
          lang="en"
          value={form.nameEn}
          onChange={(e) => {
            setForm({ ...form, nameEn: e.target.value });
          }}
        />
        <TextField
          label={t('ui.leave.typeNameAr')}
          dir="rtl"
          lang="ar"
          value={form.nameAr}
          onChange={(e) => {
            setForm({ ...form, nameAr: e.target.value });
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t('ui.leave.annualDays')}
            inputMode="decimal"
            dir="ltr"
            value={form.annualDays}
            onChange={(e) => {
              setForm({ ...form, annualDays: e.target.value });
            }}
          />
          <SelectField
            label={t('ui.leave.accrualLabel')}
            placeholder={t('ui.leave.accrualLabel')}
            value={accrual}
            onValueChange={(v) => {
              setAccrual(v as typeof accrual);
            }}
            options={LEAVE_ACCRUALS.map((a) => ({ value: a, label: t(`ui.leave.accrual.${a}`) }))}
          />
        </div>
        {(Object.keys(flags) as (keyof typeof flags)[]).map((k) => (
          <Checkbox
            key={k}
            label={t(`ui.leave.flags.${k}`)}
            checked={flags[k]}
            onCheckedChange={(on) => {
              setFlags({ ...flags, [k]: on });
            }}
          />
        ))}
        <Checkbox
          label={t('ui.leave.confirmVerified')}
          checked={verified}
          onCheckedChange={setVerified}
        />
        <FormError error={save.error} />
        <Button type="submit" className="w-fit" loading={save.isPending}>
          {t('ui.common.save')}
        </Button>
      </form>
    </Dialog>
  );
}
