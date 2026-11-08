import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { approvalListResponseSchema, sumMoney, type TimeEntry } from '@ultimate-erp/contracts';
import { formatDate, formatNumber } from '@ultimate-erp/i18n';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Dialog,
  DistributionBar,
  EmptyState,
  ErrorState,
  initialsOf,
  LoadingState,
  StatCard,
  TextArea,
  useToast,
} from '@ultimate-erp/ui';
import { ChevronDown, Clock3, Hourglass, ReceiptText, Users } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { hoursText } from '../projects/shared.js';

const hoursSum = (entries: TimeEntry[]) => sumMoney(entries.map((e) => e.hours));

/**
 * Time approval workspace (redesign 2026-11-08): what is waiting in total, then one panel per
 * person — their hours, billable split and day-by-day spread — with each entry in a clear
 * row. Selecting shows a floating bar to approve, or send back with a reason (required).
 * Approval rules are the server's (only the project's manager; never your own time).
 */
export function TimeApprovalsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [project, setProject] = useState<string>('all');
  const [closed, setClosed] = useState<string[]>([]);
  const list = useQuery({
    queryKey: ['time', 'approvals'],
    queryFn: () => api('/approvals/time', { schema: approvalListResponseSchema }),
  });
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api(`/time-entries/${decision}`, {
        method: 'POST',
        body: decision === 'reject' ? { ids: picked, reason } : { ids: picked },
        schema: approvalListResponseSchema,
      }),
    onSuccess: async (_data, decision) => {
      toast({
        tone: 'good',
        title: t(decision === 'approve' ? 'ui.time.approvedDone' : 'ui.time.rejectedDone'),
      });
      setPicked([]);
      setRejecting(false);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['time'] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const all = list.data?.items ?? [];
  const projects = new Map(all.map((e) => [e.project.id, e.project]));
  const shown = project === 'all' ? all : all.filter((e) => e.project.id === project);
  const groups = new Map<string, TimeEntry[]>();
  for (const e of shown) {
    groups.set(e.person.membershipId, [...(groups.get(e.person.membershipId) ?? []), e]);
  }
  const pickedEntries = all.filter((e) => picked.includes(e.id));
  const toggle = (id: string, on: boolean) => {
    setPicked(on ? [...picked, id] : picked.filter((p) => p !== id));
  };
  const hours = (h: string) => hoursText(locale, t, h);
  const day = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    formatDate(locale, new Date(`${iso}T12:00:00Z`), opts);
  const nonBillable = all.filter((e) => !e.billable);

  return (
    <div className="grid gap-5 pb-20">
      <AppPageHeader title={t('ui.time.approvalsTitle')} />
      {!rejecting && <FormError error={decide.error} />}
      {list.isPending && <LoadingState label={t('ui.common.loading')} />}
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
        <Card>
          <EmptyState
            title={t('ui.time.nothingToApprove')}
            body={t('ui.time.nothingToApproveBody')}
          />
        </Card>
      )}
      {all.length > 0 && (
        <>
          <div className="ui-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              tone="butter"
              icon={<Hourglass />}
              label={t('ui.ws.approvals.waiting')}
              value={hours(hoursSum(all))}
              hint={t('ui.ws.approvals.entries', { count: all.length })}
            />
            <StatCard
              tone="sky"
              icon={<Users />}
              label={t('ui.ws.approvals.people')}
              value={formatNumber(locale, new Set(all.map((e) => e.person.membershipId)).size)}
            />
            <StatCard
              tone="lilac"
              icon={<ReceiptText />}
              label={t('ui.ws.approvals.projects')}
              value={formatNumber(locale, projects.size)}
            />
            <StatCard
              tone="mint"
              icon={<Clock3 />}
              label={t('ui.ws.approvals.nonBillable')}
              value={hours(hoursSum(nonBillable))}
              hint={t('ui.ws.approvals.entries', { count: nonBillable.length })}
            />
          </div>

          {projects.size > 1 && (
            <div
              role="group"
              aria-label={t('ui.ws.approvals.byProject')}
              className="flex flex-wrap gap-2"
            >
              {[
                ['all', t('ui.ws.approvals.allProjects')] as const,
                ...[...projects.values()].map(
                  (p) => [p.id, locale === 'ar' ? p.name.ar : p.name.en] as const,
                ),
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={project === id}
                  onClick={() => {
                    setProject(id);
                  }}
                  className="ui-glass rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:text-ink aria-pressed:border-transparent aria-pressed:bg-plum aria-pressed:text-on-plum"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {[...groups.values()].map((entries) => {
        const person = entries[0]?.person;
        if (!person) return null;
        const everyPicked = entries.every((e) => picked.includes(e.id));
        const open = !closed.includes(person.membershipId);
        const billable = entries.filter((e) => e.billable);
        const total = hoursSum(entries);
        const byDay = new Map<string, TimeEntry[]>();
        for (const e of entries) byDay.set(e.workDate, [...(byDay.get(e.workDate) ?? []), e]);
        const days = [...byDay.keys()].sort();
        const maxDay = Math.max(...days.map((d) => Number(hoursSum(byDay.get(d) ?? []))), 8);
        const sorted = [...entries].sort((a, b) => a.workDate.localeCompare(b.workDate));
        return (
          <section
            key={person.membershipId}
            aria-label={person.name}
            className="ui-glass ui-rise grid gap-4 rounded-card p-5"
          >
            <header className="flex flex-wrap items-center gap-3">
              <Avatar name={person.name} initials={initialsOf(person.name)} size={44} />
              <div className="grid min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-bold">{person.name}</h2>
                <span className="text-[12.5px] text-ink-2">
                  {t('ui.ws.approvals.personLine', {
                    count: entries.length,
                    from: day(days[0] ?? '', { day: 'numeric', month: 'short' }),
                    to: day(days.at(-1) ?? '', { day: 'numeric', month: 'short' }),
                  })}
                </span>
              </div>
              <b className="num text-[22px] font-extrabold tracking-tight">{hours(total)}</b>
              <Checkbox
                label={t('ui.time.selectAll')}
                checked={everyPicked}
                onCheckedChange={(on) => {
                  const ids = entries.map((e) => e.id);
                  setPicked(
                    on ? [...new Set([...picked, ...ids])] : picked.filter((p) => !ids.includes(p)),
                  );
                }}
              />
              <button
                type="button"
                aria-expanded={open}
                aria-label={t('ui.ws.approvals.toggle', { name: person.name })}
                onClick={() => {
                  setClosed(
                    open
                      ? [...closed, person.membershipId]
                      : closed.filter((c) => c !== person.membershipId),
                  );
                }}
                className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-frame"
              >
                <ChevronDown
                  aria-hidden
                  className={`size-4 transition-transform duration-200 ${open ? '' : '-rotate-90 rtl:rotate-90'}`}
                />
              </button>
            </header>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <DistributionBar
                label={t('ui.ws.approvals.split')}
                segments={[
                  {
                    key: 'billable',
                    label: t('ui.ws.approvals.billable'),
                    value: Number(hoursSum(billable)),
                    display: hours(hoursSum(billable)),
                    color: 'var(--mint-solid)',
                  },
                  {
                    key: 'non',
                    label: t('ui.time.nonBillable'),
                    value: Number(hoursSum(entries.filter((e) => !e.billable))),
                    display: hours(hoursSum(entries.filter((e) => !e.billable))),
                    color: 'var(--line-2)',
                  },
                ]}
              />
              <ol
                aria-label={t('ui.ws.approvals.perDay')}
                className="flex items-end gap-1.5 overflow-x-auto pb-1"
              >
                {days.map((d) => {
                  const h = hoursSum(byDay.get(d) ?? []);
                  return (
                    <li key={d} className="grid min-w-[42px] flex-1 justify-items-center gap-1">
                      <span className="num text-[11px] font-bold">
                        {formatNumber(locale, Number(h))}
                      </span>
                      <span className="relative block h-16 w-full max-w-[34px] overflow-hidden rounded-full bg-sky">
                        <span
                          aria-hidden
                          className="ui-fill-y absolute inset-x-0 bottom-0 rounded-full bg-sky-solid"
                          style={{
                            blockSize: `${String(Math.min(100, (Number(h) / maxDay) * 100))}%`,
                          }}
                        />
                      </span>
                      <span className="text-[10.5px] text-ink-3">
                        {day(d, { weekday: 'short', day: 'numeric' })}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {open && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-[11.5px] text-ink-3">
                    <tr>
                      <th scope="col" className="w-10 py-2">
                        <span className="sr-only">{t('ui.ws.approvals.pick')}</span>
                      </th>
                      <th scope="col" className="py-2 text-start font-semibold">
                        {t('ui.ws.approvals.date')}
                      </th>
                      <th scope="col" className="py-2 text-start font-semibold">
                        {t('ui.ws.approvals.work')}
                      </th>
                      <th scope="col" className="py-2 text-start font-semibold">
                        {t('ui.ws.approvals.note')}
                      </th>
                      <th scope="col" className="py-2 text-end font-semibold">
                        {t('ui.ws.approvals.hours')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((e) => {
                      const on = picked.includes(e.id);
                      return (
                        <tr
                          key={e.id}
                          className={`border-t border-line transition-colors ${on ? 'bg-plum-soft' : 'hover:bg-frame'}`}
                        >
                          <td className="py-2.5 ps-1">
                            <Checkbox
                              label={`${e.task.number} · ${e.task.title}`}
                              hideLabel
                              checked={on}
                              onCheckedChange={(v) => {
                                toggle(e.id, v);
                              }}
                            />
                          </td>
                          <td className="py-2.5 whitespace-nowrap text-ink-2">
                            {day(e.workDate, { weekday: 'short', day: 'numeric', month: 'short' })}
                          </td>
                          <td className="py-2.5">
                            <Link
                              to="/tasks/$taskId"
                              params={{ taskId: e.task.id }}
                              className="font-semibold hover:underline"
                            >
                              <span dir="ltr" className="text-ink-3">
                                {e.task.number}
                              </span>{' '}
                              {e.task.title}
                            </Link>
                            <span className="block text-[12px] text-ink-3">
                              {locale === 'ar' ? e.project.name.ar : e.project.name.en}
                            </span>
                          </td>
                          <td className="max-w-[280px] py-2.5 text-ink-2">
                            <span className="line-clamp-2">{e.description || '—'}</span>
                          </td>
                          <td className="py-2.5 text-end whitespace-nowrap">
                            <b className="num">{hours(e.hours)}</b>
                            {!e.billable && (
                              <span className="ms-1.5 rounded-full bg-frame px-1.5 py-px text-[10.5px] font-semibold text-ink-3">
                                {t('ui.time.nonBillable')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {picked.length > 0 && (
        <div
          role="region"
          aria-label={t('ui.ws.approvals.selection')}
          className="ui-glass-pop ui-toast fixed inset-x-4 bottom-5 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-full px-5 py-2.5"
        >
          <span className="text-[13px] font-semibold">
            {t('ui.ws.approvals.selected', {
              count: picked.length,
              hours: hours(hoursSum(pickedEntries)),
            })}
          </span>
          <span className="ms-auto flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                decide.reset();
                setRejecting(true);
              }}
            >
              {t('ui.time.rejectSelected', { count: picked.length })}
            </Button>
            <Button
              loading={decide.isPending && decide.variables === 'approve'}
              onClick={() => {
                decide.mutate('approve');
              }}
            >
              {t('ui.time.approveSelected', { count: picked.length })}
            </Button>
          </span>
        </div>
      )}
      <Dialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t('ui.time.rejectSelected', { count: picked.length })}
        description={t('ui.time.rejectHint')}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate('reject');
          }}
        >
          <TextArea
            label={t('ui.time.reason')}
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <FormError error={decide.error} />
          <Button
            type="submit"
            className="w-fit"
            loading={decide.isPending}
            disabled={!reason.trim()}
          >
            {t('ui.time.sendBack')}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
