import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  attendanceSettingsSchema,
  attendanceSummarySchema,
  attendanceTodaySchema,
  correctionListResponseSchema,
  correctionSchema,
  employeeListResponseSchema,
  myAttendanceSchema,
  shiftListResponseSchema,
  siteListResponseSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
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
import { errorReference, errorText } from '../../lib/errors.js';
import { can, canAny, useAccess } from '../../lib/session.js';

const kuwaitToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const shift = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const minutesText = (t: ReturnType<typeof useI18n>['t'], m: number) =>
  t('ui.attendance.hm', { h: Math.floor(m / 60), m: m % 60 });

/** Attendance (brief Module I). */
export function AttendancePage() {
  const { t } = useI18n();
  const access = useAccess(true);
  const team =
    canAny(access.data, 'attendance.read') &&
    !(access.data?.permissions['attendance.read'] ?? []).every((s) => s === 'own');
  const approver = canAny(access.data, 'attendance.correction.approve');
  const manage = can(access.data, 'attendance.manage');
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.attendance.title')} />
      <Tabs
        label={t('ui.attendance.title')}
        items={[
          { value: 'me', label: t('ui.attendance.tabs.me'), content: <Me /> },
          ...(team
            ? [{ value: 'today', label: t('ui.attendance.tabs.today'), content: <Today /> }]
            : []),
          ...(approver
            ? [
                {
                  value: 'approvals',
                  label: t('ui.attendance.tabs.approvals'),
                  content: <Approvals />,
                },
              ]
            : []),
          ...(manage
            ? [{ value: 'setup', label: t('ui.attendance.tabs.setup'), content: <Setup /> }]
            : []),
        ]}
      />
    </div>
  );
}

function Me() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['attendance', 'me'],
    queryFn: () => api('/attendance/me', { schema: myAttendanceSchema }),
  });
  const check = useMutation({
    mutationFn: () =>
      api('/attendance/check', { method: 'POST', body: {}, schema: myAttendanceSchema }),
    onSuccess: async (data) => {
      queryClient.setQueryData(['attendance', 'me'], data);
      toast({
        tone: 'good',
        title: t(data.next === 'out' ? 'ui.attendance.checkedIn' : 'ui.attendance.checkedOut'),
      });
      await queryClient.invalidateQueries({ queryKey: ['attendance', 'summary'] });
    },
  });
  const time = (iso: string) => formatDate(locale, new Date(iso), { timeStyle: 'short' });
  return (
    <div className="grid gap-4">
      <Card title={t('ui.attendance.todayTitle')}>
        {me.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        {me.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, me.error)}
            reference={errorReference(t, me.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void me.refetch()}
          />
        )}
        {me.data && (
          <>
            {me.data.shift && (
              <small className="text-ink-3">
                {t('ui.attendance.shiftLine', {
                  name: locale === 'ar' ? me.data.shift.name.ar : me.data.shift.name.en,
                  from: me.data.shift.startTime,
                  to: me.data.shift.endTime,
                })}
              </small>
            )}
            {me.data.events.length === 0 ? (
              <p className="text-[13.5px] text-ink-2">{t('ui.attendance.noEvents')}</p>
            ) : (
              <ol className="grid gap-1.5 text-[13.5px]">
                {me.data.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <StatusChip
                      status={e.kind === 'in' ? 'good' : 'info'}
                      label={t(`ui.attendance.kind.${e.kind}`)}
                    />
                    <b className="tabular-nums">{time(e.at)}</b>
                    <small className="text-ink-3">
                      {t(`ui.attendance.method.${e.method}`)}
                      {e.site ? ` · ${locale === 'ar' ? e.site.ar : e.site.en}` : ''}
                    </small>
                  </li>
                ))}
              </ol>
            )}
            {me.data.allowWeb ? (
              <Button
                className="w-fit"
                loading={check.isPending}
                onClick={() => {
                  check.mutate();
                }}
              >
                {t(me.data.next === 'in' ? 'ui.attendance.checkIn' : 'ui.attendance.checkOut')}
              </Button>
            ) : (
              <p className="text-[13.5px] text-ink-2">{t('ui.attendance.qrOnly')}</p>
            )}
            <FormError error={check.error} />
          </>
        )}
      </Card>
      <SummaryCard />
      <Corrections />
    </div>
  );
}

function SummaryCard({ membershipId }: { membershipId?: string }) {
  const { t, locale } = useI18n();
  const to = kuwaitToday();
  const from = shift(to, -13);
  const q = `from=${from}&to=${to}${membershipId ? `&membershipId=${membershipId}` : ''}`;
  const summary = useQuery({
    queryKey: ['attendance', 'summary', q],
    queryFn: () => api(`/attendance/summary?${q}`, { schema: attendanceSummarySchema }),
  });
  const time = (iso: string | null) =>
    iso ? formatDate(locale, new Date(iso), { timeStyle: 'short' }) : '—';
  const tone = {
    present: 'good',
    incomplete: 'warn',
    absent: 'bad',
    leave: 'info',
    holiday: 'info',
    weekend: 'info',
    upcoming: 'info',
  } as const;
  return (
    <Card title={t('ui.attendance.lastTwoWeeks')}>
      {summary.isPending && <LoadingState label={t('ui.common.loading')} lines={3} />}
      {summary.data && (
        <>
          <p className="text-[13.5px] text-ink-2">
            {t('ui.attendance.totals', {
              present: summary.data.totals.present,
              absent: summary.data.totals.absent,
              late: summary.data.totals.late,
              worked: minutesText(t, summary.data.totals.workedMinutes),
              logged: summary.data.totals.loggedHours,
            })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[12px] text-ink-3">
                <tr>
                  {(
                    ['date', 'status', 'in', 'out', 'worked', 'late', 'early', 'logged'] as const
                  ).map((c) => (
                    <th key={c} scope="col" className="py-1.5 text-start font-semibold">
                      {t(`ui.attendance.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...summary.data.days].reverse().map((d) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="py-1.5">
                      {formatDate(locale, new Date(`${d.date}T12:00:00Z`), {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </td>
                    <td className="py-1.5">
                      <StatusChip
                        status={tone[d.status]}
                        label={t(`ui.attendance.day.${d.status}`)}
                      />
                    </td>
                    <td className="py-1.5 tabular-nums">{time(d.firstIn)}</td>
                    <td className="py-1.5 tabular-nums">{time(d.lastOut)}</td>
                    <td className="py-1.5 tabular-nums">
                      {d.workedMinutes ? minutesText(t, d.workedMinutes) : '—'}
                    </td>
                    <td
                      className={`py-1.5 tabular-nums ${d.lateMinutes ? 'font-semibold text-bad' : ''}`}
                    >
                      {d.lateMinutes || '—'}
                    </td>
                    <td
                      className={`py-1.5 tabular-nums ${d.earlyMinutes ? 'font-semibold text-bad' : ''}`}
                    >
                      {d.earlyMinutes || '—'}
                    </td>
                    <td className="py-1.5 tabular-nums">
                      {d.loggedHours === '0' ? '—' : d.loggedHours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function Corrections() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [date, setDate] = useState(shift(kuwaitToday(), -1));
  const [time, setTime] = useState('08:00');
  const [reason, setReason] = useState('');
  const mine = useQuery({
    queryKey: ['attendance', 'corrections', 'mine'],
    queryFn: () =>
      api('/attendance/corrections?view=mine', { schema: correctionListResponseSchema }),
  });
  const ask = useMutation({
    mutationFn: () =>
      api('/attendance/corrections', {
        method: 'POST',
        body: { kind, at: `${date}T${time}:00+03:00`, reason },
        schema: correctionSchema,
      }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.attendance.correctionSent') });
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['attendance', 'corrections'] });
    },
  });
  return (
    <Card title={t('ui.attendance.corrections')}>
      <small className="text-ink-3">{t('ui.attendance.correctionHint')}</small>
      <form
        noValidate
        className="grid gap-3 md:grid-cols-4 md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          ask.mutate();
        }}
      >
        <SelectField
          label={t('ui.attendance.missing')}
          placeholder={t('ui.attendance.missing')}
          value={kind}
          onValueChange={(v) => {
            setKind(v as 'in' | 'out');
          }}
          options={[
            { value: 'in', label: t('ui.attendance.kind.in') },
            { value: 'out', label: t('ui.attendance.kind.out') },
          ]}
        />
        <TextField
          label={t('ui.attendance.date')}
          type="date"
          max={kuwaitToday()}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
          }}
        />
        <TextField
          label={t('ui.attendance.time')}
          type="time"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
          }}
        />
        <TextField
          label={t('ui.attendance.reason')}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        <Button
          type="submit"
          className="w-fit"
          loading={ask.isPending}
          disabled={!reason.trim() || !date || !time}
        >
          {t('ui.attendance.askCorrection')}
        </Button>
      </form>
      <FormError error={ask.error} />
      <ul className="grid gap-2">
        {mine.data?.items.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3 text-[13px]"
          >
            <span className="min-w-0 flex-1">
              {t(`ui.attendance.kind.${c.kind}`)} ·{' '}
              {formatDate(locale, new Date(c.at), { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {c.reason}
              {c.note ? (
                <small className="block text-ink-2">
                  {t('ui.attendance.reviewNote', { note: c.note, name: c.decidedByName ?? '' })}
                </small>
              ) : null}
            </span>
            <StatusChip
              status={c.status === 'approved' ? 'good' : c.status === 'rejected' ? 'bad' : 'warn'}
              label={t(`ui.attendance.correctionStatus.${c.status}`)}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Today() {
  const { t, locale } = useI18n();
  const board = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => api('/attendance/today', { schema: attendanceTodaySchema }),
    refetchInterval: 60_000,
  });
  const tone = { in: 'good', out: 'info', not_in: 'warn', leave: 'info', off: 'info' } as const;
  return (
    <Card title={t('ui.attendance.whoIsIn')}>
      {board.isPending && <LoadingState label={t('ui.common.loading')} lines={3} />}
      {board.data?.items.length === 0 && (
        <EmptyState title={t('ui.attendance.nobody')} body={t('ui.states.emptyBody')} />
      )}
      <ul className="grid gap-1.5 text-[13.5px]">
        {board.data?.items.map((p) => (
          <li
            key={p.membershipId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-tile bg-frame p-2.5"
          >
            <span>{p.name}</span>
            <span className="flex items-center gap-2">
              {p.since && (
                <small className="text-ink-3">
                  {formatDate(locale, new Date(p.since), { timeStyle: 'short' })}
                </small>
              )}
              {p.lateMinutes > 0 && (
                <small className="font-semibold text-bad">
                  {t('ui.attendance.lateBy', { minutes: p.lateMinutes })}
                </small>
              )}
              <StatusChip status={tone[p.state]} label={t(`ui.attendance.state.${p.state}`)} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Approvals() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: ['attendance', 'corrections', 'approvals'],
    queryFn: () =>
      api('/attendance/corrections?view=approvals', { schema: correctionListResponseSchema }),
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api(`/attendance/corrections/${id}/${action}`, {
        method: 'POST',
        body: notes[id] ? { note: notes[id] } : {},
        schema: correctionSchema,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['attendance'] }),
  });
  return (
    <Card>
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.data?.items.length === 0 && (
        <EmptyState
          title={t('ui.attendance.nothingWaiting')}
          body={t('ui.attendance.nothingWaitingBody')}
        />
      )}
      <ul className="grid gap-2">
        {list.data?.items.map((c) => (
          <li key={c.id} className="grid gap-2 rounded-tile bg-frame p-3 text-[13.5px]">
            <span>
              <b>{c.person.name}</b> · {t(`ui.attendance.kind.${c.kind}`)} ·{' '}
              {formatDate(locale, new Date(c.at), { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {c.reason}
            </span>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <TextField
                  label={t('ui.attendance.reviewerNote')}
                  value={notes[c.id] ?? ''}
                  onChange={(e) => {
                    setNotes({ ...notes, [c.id]: e.target.value });
                  }}
                />
              </div>
              <Button
                size="sm"
                onClick={() => {
                  decide.mutate({ id: c.id, action: 'approve' });
                }}
              >
                {t('ui.attendance.approve')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!notes[c.id]?.trim()}
                onClick={() => {
                  decide.mutate({ id: c.id, action: 'reject' });
                }}
              >
                {t('ui.attendance.reject')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <FormError error={decide.error} />
    </Card>
  );
}

function Setup() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['attendance', 'settings'],
    queryFn: () => api('/attendance/settings', { schema: attendanceSettingsSchema }),
  });
  const sites = useQuery({
    queryKey: ['attendance', 'sites'],
    queryFn: () => api('/attendance/sites', { schema: siteListResponseSchema }),
  });
  const shifts = useQuery({
    queryKey: ['attendance', 'shifts'],
    queryFn: () => api('/attendance/shifts', { schema: shiftListResponseSchema }),
  });
  const people = useQuery({
    queryKey: ['people', 'list', ''],
    queryFn: () => api('/people', { schema: employeeListResponseSchema }),
  });
  const [site, setSite] = useState({ nameEn: '', nameAr: '' });
  const [newShift, setNewShift] = useState({
    nameEn: '',
    nameAr: '',
    startTime: '08:00',
    endTime: '16:00',
    graceMinutes: '10',
    breakMinutes: '60',
  });
  const [assignee, setAssignee] = useState('');
  const [assignShift, setAssignShift] = useState('none');
  const saveSettings = useMutation({
    mutationFn: (allowWeb: boolean) =>
      api('/attendance/settings', {
        method: 'PATCH',
        body: { allowWeb },
        schema: attendanceSettingsSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['attendance', 'settings'], data);
    },
  });
  const addSite = useMutation({
    mutationFn: () =>
      api('/attendance/sites', { method: 'POST', body: site, schema: siteListResponseSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(['attendance', 'sites'], data);
      setSite({ nameEn: '', nameAr: '' });
    },
  });
  const addShift = useMutation({
    mutationFn: () =>
      api('/attendance/shifts', {
        method: 'POST',
        body: {
          ...newShift,
          graceMinutes: Number(newShift.graceMinutes),
          breakMinutes: Number(newShift.breakMinutes),
        },
        schema: shiftListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['attendance', 'shifts'], data);
    },
  });
  const assign = useMutation({
    mutationFn: () =>
      api(`/attendance/assignments/${assignee}`, {
        method: 'PUT',
        body: { shiftId: assignShift === 'none' ? null : assignShift },
        schema: shiftListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['attendance', 'shifts'], data);
    },
  });
  const name = (n: { en: string; ar: string }) => (locale === 'ar' ? n.ar : n.en);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('ui.attendance.settings')}>
        {settings.data && (
          <Checkbox
            label={t('ui.attendance.allowWeb')}
            checked={settings.data.allowWeb}
            onCheckedChange={(on) => {
              saveSettings.mutate(on);
            }}
          />
        )}
        <small className="text-ink-3">{t('ui.attendance.policyNote')}</small>
        <FormError error={saveSettings.error} />
      </Card>
      <Card title={t('ui.attendance.sites')}>
        <ul className="grid gap-1.5 text-[13.5px]">
          {sites.data?.items
            .filter((s) => !s.archived)
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>{name(s.name)}</span>
                <Link
                  to="/attendance/kiosk/$siteId"
                  params={{ siteId: s.id }}
                  target="_blank"
                  className="text-[13px] font-semibold text-plum hover:underline"
                >
                  {t('ui.attendance.openKiosk')}
                </Link>
              </li>
            ))}
        </ul>
        <form
          noValidate
          className="grid gap-2 sm:grid-cols-3 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            addSite.mutate();
          }}
        >
          <TextField
            label={t('ui.attendance.siteNameEn')}
            dir="ltr"
            lang="en"
            value={site.nameEn}
            onChange={(e) => {
              setSite({ ...site, nameEn: e.target.value });
            }}
          />
          <TextField
            label={t('ui.attendance.siteNameAr')}
            dir="rtl"
            lang="ar"
            value={site.nameAr}
            onChange={(e) => {
              setSite({ ...site, nameAr: e.target.value });
            }}
          />
          <Button
            type="submit"
            loading={addSite.isPending}
            disabled={!site.nameEn.trim() || !site.nameAr.trim()}
          >
            {t('ui.attendance.addSite')}
          </Button>
        </form>
        <FormError error={addSite.error} />
      </Card>
      <Card title={t('ui.attendance.shifts')}>
        <ul className="grid gap-1.5 text-[13.5px]">
          {shifts.data?.items
            .filter((s) => !s.archived)
            .map((s) => (
              <li key={s.id} className="grid gap-0.5 rounded-tile bg-frame p-2.5">
                <b>
                  {name(s.name)} ·{' '}
                  <span dir="ltr">
                    {s.startTime}–{s.endTime}
                  </span>
                </b>
                <small className="text-ink-3">
                  {t('ui.attendance.shiftRules', { grace: s.graceMinutes, break: s.breakMinutes })}{' '}
                  · {s.people.map((p) => p.name).join('، ') || '—'}
                </small>
              </li>
            ))}
        </ul>
        <form
          noValidate
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            addShift.mutate();
          }}
        >
          <TextField
            label={t('ui.attendance.shiftNameEn')}
            dir="ltr"
            lang="en"
            value={newShift.nameEn}
            onChange={(e) => {
              setNewShift({ ...newShift, nameEn: e.target.value });
            }}
          />
          <TextField
            label={t('ui.attendance.shiftNameAr')}
            dir="rtl"
            lang="ar"
            value={newShift.nameAr}
            onChange={(e) => {
              setNewShift({ ...newShift, nameAr: e.target.value });
            }}
          />
          <TextField
            label={t('ui.attendance.start')}
            type="time"
            value={newShift.startTime}
            onChange={(e) => {
              setNewShift({ ...newShift, startTime: e.target.value });
            }}
          />
          <TextField
            label={t('ui.attendance.end')}
            type="time"
            value={newShift.endTime}
            onChange={(e) => {
              setNewShift({ ...newShift, endTime: e.target.value });
            }}
          />
          <TextField
            label={t('ui.attendance.grace')}
            type="number"
            min={0}
            max={240}
            value={newShift.graceMinutes}
            onChange={(e) => {
              setNewShift({ ...newShift, graceMinutes: e.target.value });
            }}
          />
          <TextField
            label={t('ui.attendance.break')}
            type="number"
            min={0}
            max={480}
            value={newShift.breakMinutes}
            onChange={(e) => {
              setNewShift({ ...newShift, breakMinutes: e.target.value });
            }}
          />
          <Button
            type="submit"
            className="w-fit"
            loading={addShift.isPending}
            disabled={!newShift.nameEn.trim() || !newShift.nameAr.trim()}
          >
            {t('ui.attendance.addShift')}
          </Button>
        </form>
        <FormError error={addShift.error} />
      </Card>
      <Card title={t('ui.attendance.assign')}>
        <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
          <SelectField
            label={t('ui.attendance.person')}
            placeholder={t('ui.attendance.person')}
            value={assignee}
            onValueChange={setAssignee}
            options={(people.data?.items ?? [])
              .filter((p) => p.status !== 'left')
              .map((p) => ({ value: p.membershipId, label: p.name }))}
          />
          <SelectField
            label={t('ui.attendance.shift')}
            placeholder={t('ui.attendance.noShift')}
            value={assignShift}
            onValueChange={setAssignShift}
            options={[
              { value: 'none', label: t('ui.attendance.noShift') },
              ...(shifts.data?.items ?? [])
                .filter((s) => !s.archived)
                .map((s) => ({ value: s.id, label: name(s.name) })),
            ]}
          />
          <Button
            loading={assign.isPending}
            disabled={!assignee}
            onClick={() => {
              assign.mutate();
            }}
          >
            {t('ui.common.save')}
          </Button>
        </div>
        <FormError error={assign.error} />
      </Card>
    </div>
  );
}
