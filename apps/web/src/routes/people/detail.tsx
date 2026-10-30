import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import {
  checklistResponseSchema,
  departmentListResponseSchema,
  emergencyContactListResponseSchema,
  type Employee,
  employeeDocumentListResponseSchema,
  employeeHistorySchema,
  employeeListResponseSchema,
  employeeSchema,
  type EmployeeStatus,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  type PrivateDetails,
  privateDetailsResponseSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
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
import { DocumentsTab } from '../clients/tabs.js';
import { dateText } from '../contracts/shared.js';
import { EmployeeStatusChip } from './list.js';

const personKey = (id: string) => ['people', 'detail', id] as const;
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const NEEDS_DATE: EmployeeStatus[] = ['offboarding', 'left'];

/** One person: employment, private details (restricted), documents, history, checklists. */
export function PersonPage() {
  const { t, locale } = useI18n();
  const { membershipId } = useParams({ from: '/app/people/$membershipId' });
  const person = useQuery({
    queryKey: personKey(membershipId),
    queryFn: () => api(`/people/${membershipId}`, { schema: employeeSchema }),
  });
  if (person.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (person.isError) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, person.error)}
        reference={errorReference(t, person.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void person.refetch()}
      />
    );
  }
  const p = person.data;
  const tabs = [
    ...(p.details
      ? [
          {
            value: 'employment',
            label: t('ui.people.tabs.employment'),
            content: <EmploymentCard key={p.version} person={p} />,
          },
          {
            value: 'documents',
            label: t('ui.people.tabs.documents'),
            content: (
              <DocumentsTab
                basePath={`/people/${p.membershipId}`}
                canUpdate={p.actions.includes('documents')}
                schema={employeeDocumentListResponseSchema}
              />
            ),
          },
          {
            value: 'checklist',
            label: t('ui.people.tabs.checklist'),
            content: <ChecklistCard person={p} />,
          },
          {
            value: 'history',
            label: t('ui.people.tabs.history'),
            content: <HistoryCard person={p} />,
          },
        ]
      : []),
    ...(p.canSeeRestricted
      ? [
          {
            value: 'private',
            label: t('ui.people.tabs.private'),
            content: <PrivateCard person={p} />,
          },
        ]
      : []),
  ];
  return (
    <div className="grid gap-4">
      <AppPageHeader title={p.name} />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span dir="ltr" className="tabular-nums">
          {p.number}
        </span>
        <span aria-hidden>·</span>
        <span>{(locale === 'ar' ? p.jobTitle.ar : p.jobTitle.en) || '—'}</span>
        {p.department && (
          <>
            <span aria-hidden>·</span>
            <span>{locale === 'ar' ? p.department.name.ar : p.department.name.en}</span>
          </>
        )}
        <EmployeeStatusChip status={p.status} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          {tabs.length > 0 ? (
            <Tabs label={p.name} items={tabs} />
          ) : (
            <Card>
              <p className="text-[13.5px] text-ink-2">{t('ui.people.directoryOnly')}</p>
            </Card>
          )}
        </div>
        <div className="grid content-start gap-4">
          <Card title={t('ui.people.overview')}>
            <dl className="grid gap-2 text-[13.5px]">
              <div>
                <dt className="text-[12px] font-semibold text-ink-3">{t('ui.people.manager')}</dt>
                <dd>{p.manager?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-semibold text-ink-3">{t('ui.people.teams')}</dt>
                <dd>
                  {p.teams.map((tm) => (locale === 'ar' ? tm.name.ar : tm.name.en)).join('، ') ||
                    '—'}
                </dd>
              </div>
              {p.email && (
                <div>
                  <dt className="text-[12px] font-semibold text-ink-3">
                    {t('ui.people.workEmail')}
                  </dt>
                  <dd dir="ltr">{p.email}</dd>
                </div>
              )}
            </dl>
          </Card>
          {p.nextStatuses.length > 0 && <StatusCard person={p} />}
        </div>
      </div>
    </div>
  );
}

function useSaved() {
  const queryClient = useQueryClient();
  return async (updated: Employee) => {
    queryClient.setQueryData(personKey(updated.membershipId), updated);
    await queryClient.invalidateQueries({ queryKey: ['people', 'list'] });
  };
}

function StatusCard({ person: p }: { person: Employee }) {
  const { t } = useI18n();
  const toast = useToast();
  const saved = useSaved();
  const [target, setTarget] = useState<EmployeeStatus | null>(null);
  const [leaveDate, setLeaveDate] = useState(p.details?.leaveDate ?? '');
  const move = useMutation({
    mutationFn: (status: EmployeeStatus) =>
      api(`/people/${p.membershipId}/status`, {
        method: 'POST',
        body: { status, ...(NEEDS_DATE.includes(status) && leaveDate ? { leaveDate } : {}) },
        schema: employeeSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setTarget(null);
      toast({ tone: 'good', title: t('ui.people.statusChanged') });
    },
  });
  return (
    <Card title={t('ui.people.statusLabel')}>
      <div className="grid gap-2">
        {p.nextStatuses.map((s) => (
          <Button
            key={s}
            variant={s === 'left' || s === 'offboarding' ? 'secondary' : 'primary'}
            onClick={() => {
              move.reset();
              setTarget(s);
            }}
          >
            {t(`ui.people.moveTo.${s}`)}
          </Button>
        ))}
      </div>
      <Dialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
        }}
        title={target ? t(`ui.people.moveTo.${target}`) : ''}
        description={target === 'left' ? t('ui.people.leftHint') : undefined}
        closeLabel={t('ui.common.close')}
      >
        {target && NEEDS_DATE.includes(target) && (
          <TextField
            label={t('ui.people.leaveDate')}
            type="date"
            value={leaveDate}
            onChange={(e) => {
              setLeaveDate(e.target.value);
            }}
          />
        )}
        <FormError error={move.error} />
        <Button
          className="w-fit"
          loading={move.isPending}
          disabled={Boolean(target && NEEDS_DATE.includes(target) && !leaveDate)}
          onClick={() => {
            if (target) move.mutate(target);
          }}
        >
          {target ? t(`ui.people.moveTo.${target}`) : ''}
        </Button>
      </Dialog>
    </Card>
  );
}

function EmploymentCard({ person: p }: { person: Employee }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const saved = useSaved();
  const d = p.details;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    jobTitleEn: p.jobTitle.en,
    jobTitleAr: p.jobTitle.ar,
    joinDate: d?.joinDate ?? '',
    weeklyHours: d?.weeklyHours ?? '40',
  });
  const [type, setType] = useState<EmploymentType>(d?.employmentType ?? 'full_time');
  const [departmentId, setDepartmentId] = useState(p.department?.id ?? 'none');
  const [managerId, setManagerId] = useState(p.manager?.membershipId ?? 'none');
  const [workDays, setWorkDays] = useState<number[]>(d?.workDays ?? [0, 1, 2, 3, 4]);
  const departments = useQuery({
    queryKey: ['departments'],
    enabled: editing,
    queryFn: () => api('/departments', { schema: departmentListResponseSchema }),
  });
  const people = useQuery({
    queryKey: ['people', 'list', ''],
    enabled: editing,
    queryFn: () => api('/people', { schema: employeeListResponseSchema }),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/people/${p.membershipId}`, {
        method: 'PATCH',
        body: {
          version: p.version,
          jobTitleEn: form.jobTitleEn,
          jobTitleAr: form.jobTitleAr,
          joinDate: form.joinDate || null,
          weeklyHours: form.weeklyHours.trim(),
          employmentType: type,
          departmentId: departmentId === 'none' ? null : departmentId,
          managerMembershipId: managerId === 'none' ? null : managerId,
          workDays: [...workDays].sort(),
        },
        schema: employeeSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setEditing(false);
      toast({ tone: 'good', title: t('ui.people.saved') });
    },
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [key]: e.target.value });
  };
  const dayName = (n: number) =>
    formatDate(locale, new Date(Date.UTC(2026, 0, 4 + n, 12)), { weekday: 'short' });
  if (!d) return null;
  return (
    <Card
      action={
        p.actions.includes('edit') ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              save.reset();
              setEditing(true);
            }}
          >
            {t('ui.common.edit')}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          [t('ui.people.employmentType'), t(`ui.people.type.${d.employmentType}`)],
          [t('ui.people.joinDate'), dateText(locale, d.joinDate)],
          [t('ui.people.leaveDate'), dateText(locale, d.leaveDate)],
          [t('ui.people.weeklyHours'), d.weeklyHours],
          [t('ui.people.workDays'), d.workDays.map(dayName).join('، ')],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-[12px] font-semibold text-ink-3">{label}</dt>
            <dd className="text-[14px]">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t('ui.people.editEmployment')}
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
            label={t('ui.people.jobTitleEn')}
            dir="ltr"
            lang="en"
            value={form.jobTitleEn}
            onChange={set('jobTitleEn')}
          />
          <TextField
            label={t('ui.people.jobTitleAr')}
            dir="rtl"
            lang="ar"
            value={form.jobTitleAr}
            onChange={set('jobTitleAr')}
          />
          <SelectField
            label={t('ui.people.department')}
            placeholder={t('ui.people.noDepartment')}
            value={departmentId}
            onValueChange={setDepartmentId}
            options={[
              { value: 'none', label: t('ui.people.noDepartment') },
              ...(departments.data?.items ?? [])
                .filter((x) => !x.archived)
                .map((x) => ({ value: x.id, label: locale === 'ar' ? x.name.ar : x.name.en })),
            ]}
          />
          <SelectField
            label={t('ui.people.manager')}
            placeholder={t('ui.people.noManager')}
            value={managerId}
            onValueChange={setManagerId}
            options={[
              { value: 'none', label: t('ui.people.noManager') },
              ...(people.data?.items ?? [])
                .filter((x) => x.membershipId !== p.membershipId && x.status !== 'left')
                .map((x) => ({ value: x.membershipId, label: x.name })),
            ]}
          />
          <SelectField
            label={t('ui.people.employmentType')}
            placeholder={t('ui.people.employmentType')}
            value={type}
            onValueChange={(v) => {
              setType(v as EmploymentType);
            }}
            options={EMPLOYMENT_TYPES.map((x) => ({ value: x, label: t(`ui.people.type.${x}`) }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t('ui.people.joinDate')}
              type="date"
              value={form.joinDate}
              onChange={set('joinDate')}
            />
            <TextField
              label={t('ui.people.weeklyHours')}
              inputMode="decimal"
              dir="ltr"
              value={form.weeklyHours}
              onChange={set('weeklyHours')}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-semibold">{t('ui.people.workDays')}</legend>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((n) => (
                <Checkbox
                  key={n}
                  label={dayName(n)}
                  checked={workDays.includes(n)}
                  onCheckedChange={(on) => {
                    setWorkDays(on ? [...workDays, n] : workDays.filter((x) => x !== n));
                  }}
                />
              ))}
            </div>
          </fieldset>
          <FormError error={save.error} />
          <Button type="submit" className="w-fit" loading={save.isPending}>
            {t('ui.common.save')}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}

const PRIVATE_FIELDS = [
  'civilId',
  'nationality',
  'birthDate',
  'personalPhone',
  'personalEmail',
  'address',
  'bankName',
  'iban',
] as const;

function PrivateCard({ person: p }: { person: Employee }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = [...personKey(p.membershipId), 'private'];
  const details = useQuery({
    queryKey: key,
    queryFn: () =>
      api(`/people/${p.membershipId}/private`, { schema: privateDetailsResponseSchema }),
  });
  const contacts = useQuery({
    queryKey: [...personKey(p.membershipId), 'contacts'],
    queryFn: () =>
      api(`/people/${p.membershipId}/emergency-contacts`, {
        schema: emergencyContactListResponseSchema,
      }),
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [contact, setContact] = useState({ name: '', relationship: '', phone: '' });
  const canWrite = p.actions.includes('private');
  const save = useMutation({
    mutationFn: () => {
      const body: PrivateDetails = Object.fromEntries(
        PRIVATE_FIELDS.map((f) => [f, f === 'birthDate' ? form[f] || null : (form[f] ?? '')]),
      );
      return api(`/people/${p.membershipId}/private`, {
        method: 'PUT',
        body,
        schema: privateDetailsResponseSchema,
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setEditing(false);
      toast({ tone: 'good', title: t('ui.people.saved') });
    },
  });
  const addContact = useMutation({
    mutationFn: () =>
      api(`/people/${p.membershipId}/emergency-contacts`, {
        method: 'POST',
        body: contact,
        schema: emergencyContactListResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([...personKey(p.membershipId), 'contacts'], data);
      setContact({ name: '', relationship: '', phone: '' });
    },
  });
  const removeContact = useMutation({
    mutationFn: (id: string) =>
      api(`/people/${p.membershipId}/emergency-contacts/${id}`, { method: 'DELETE' }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: [...personKey(p.membershipId), 'contacts'] }),
  });
  const values = details.data?.details ?? {};
  return (
    <div className="grid gap-4">
      <Card
        title={t('ui.people.privateTitle')}
        action={
          canWrite && !editing ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setForm(Object.fromEntries(PRIVATE_FIELDS.map((f) => [f, values[f] ?? ''])));
                save.reset();
                setEditing(true);
              }}
            >
              {t('ui.common.edit')}
            </Button>
          ) : undefined
        }
      >
        <small className="text-ink-3">{t('ui.people.privateHint')}</small>
        {details.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        {details.isError && <FormError error={details.error} />}
        {editing ? (
          <form
            noValidate
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {PRIVATE_FIELDS.map((f) => (
                <TextField
                  key={f}
                  label={t(`ui.people.private.${f}`)}
                  type={f === 'birthDate' ? 'date' : 'text'}
                  dir={f === 'address' || f === 'nationality' ? undefined : 'ltr'}
                  value={form[f] ?? ''}
                  onChange={(e) => {
                    setForm({ ...form, [f]: e.target.value });
                  }}
                />
              ))}
            </div>
            <FormError error={save.error} />
            <div className="flex gap-2">
              <Button type="submit" loading={save.isPending}>
                {t('ui.common.save')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                }}
              >
                {t('ui.common.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          details.data && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {PRIVATE_FIELDS.map((f) => (
                <div key={f} className="grid gap-0.5">
                  <dt className="text-[12px] font-semibold text-ink-3">
                    {t(`ui.people.private.${f}`)}
                  </dt>
                  <dd className="text-[14px]">{values[f] || '—'}</dd>
                </div>
              ))}
            </dl>
          )
        )}
      </Card>
      <Card title={t('ui.people.emergencyContacts')}>
        {contacts.data?.items.length === 0 && (
          <small className="text-ink-3">{t('ui.people.noContacts')}</small>
        )}
        <ul className="grid gap-2">
          {contacts.data?.items.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3 text-[13.5px]"
            >
              <span className="min-w-0 flex-1">
                <b>{c.name}</b> · {c.relationship} · <span dir="ltr">{c.phone}</span>
              </span>
              {canWrite && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    removeContact.mutate(c.id);
                  }}
                >
                  {t('ui.people.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
          <form
            noValidate
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              addContact.mutate();
            }}
          >
            <TextField
              label={t('ui.people.contactName')}
              value={contact.name}
              onChange={(e) => {
                setContact({ ...contact, name: e.target.value });
              }}
            />
            <TextField
              label={t('ui.people.relationship')}
              value={contact.relationship}
              onChange={(e) => {
                setContact({ ...contact, relationship: e.target.value });
              }}
            />
            <TextField
              label={t('ui.people.phone')}
              dir="ltr"
              value={contact.phone}
              onChange={(e) => {
                setContact({ ...contact, phone: e.target.value });
              }}
            />
            <Button
              type="submit"
              loading={addContact.isPending}
              disabled={
                !contact.name.trim() || !contact.relationship.trim() || !contact.phone.trim()
              }
            >
              {t('ui.people.addContact')}
            </Button>
          </form>
        )}
        <FormError error={addContact.error} />
      </Card>
    </div>
  );
}

function ChecklistCard({ person: p }: { person: Employee }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const key = [...personKey(p.membershipId), 'checklist'];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api(`/people/${p.membershipId}/checklist`, { schema: checklistResponseSchema }),
  });
  const tick = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api(`/people/${p.membershipId}/checklist/${id}`, {
        method: 'PATCH',
        body: { done },
        schema: checklistResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
    },
  });
  const title = (raw: string) =>
    raw.startsWith('builtin:')
      ? t(`ui.people.checklistItems.${raw.slice(8) as 'contract_signed'}`)
      : raw;
  const canTick = p.actions.includes('checklist');
  return (
    <Card>
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.data?.items.length === 0 && (
        <EmptyState title={t('ui.people.noChecklist')} body={t('ui.states.emptyBody')} />
      )}
      {(['onboarding', 'offboarding'] as const).map((kind) => {
        const items = list.data?.items.filter((i) => i.kind === kind) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={kind} className="grid gap-2">
            <h3 className="text-[13px] font-bold">{t(`ui.people.${kind}`)}</h3>
            {items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2">
                <Checkbox
                  label={title(i.title)}
                  checked={i.done}
                  disabled={!canTick}
                  onCheckedChange={(done) => {
                    tick.mutate({ id: i.id, done });
                  }}
                />
                {i.doneAt && (
                  <small className="text-ink-3">
                    {i.doneByName ?? ''} ·{' '}
                    {formatDate(locale, new Date(i.doneAt), { dateStyle: 'medium' })}
                  </small>
                )}
              </div>
            ))}
          </section>
        );
      })}
      <FormError error={tick.error} />
    </Card>
  );
}

function HistoryCard({ person: p }: { person: Employee }) {
  const { t, locale } = useI18n();
  const history = useQuery({
    queryKey: [...personKey(p.membershipId), 'history', p.version],
    queryFn: () => api(`/people/${p.membershipId}/history`, { schema: employeeHistorySchema }),
  });
  const show = (v: unknown) =>
    v === null || v === undefined || v === ''
      ? '—'
      : Array.isArray(v)
        ? v.join(', ')
        : typeof v === 'string' || typeof v === 'number'
          ? String(v)
          : '…';
  return (
    <Card>
      {history.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      <ol className="grid gap-3">
        {history.data?.items.map((h) => (
          <li key={h.id} className="grid gap-0.5 border-s-2 border-lilac ps-3">
            <span className="text-[13.5px] font-semibold">
              {t(
                `ui.people.historyKind.${(['joined', 'changed', 'status'].includes(h.kind) ? h.kind : 'changed') as 'joined'}`,
              )}
            </span>
            {Object.entries(h.changes).map(([field, c]) => (
              <small key={field} className="text-ink-2">
                {t('ui.people.historyChange', { field, from: show(c.from), to: show(c.to) })}
              </small>
            ))}
            <small className="text-ink-3">
              {h.changedByName ?? ''} ·{' '}
              {formatDate(locale, new Date(h.createdAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </small>
          </li>
        ))}
      </ol>
    </Card>
  );
}
