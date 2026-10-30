import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  departmentListResponseSchema,
  EMPLOYEE_STATUSES,
  employeeCandidatesResponseSchema,
  employeeListResponseSchema,
  employeeSchema,
  type EmployeeStatus,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
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
import { can, useAccess } from '../../lib/session.js';
import { useDebounced } from '../../lib/use-debounced.js';

const CHIP: Record<EmployeeStatus, 'good' | 'info' | 'warn' | 'bad'> = {
  onboarding: 'info',
  active: 'good',
  on_leave: 'warn',
  offboarding: 'warn',
  left: 'bad',
};
export function EmployeeStatusChip({ status }: { status: EmployeeStatus }) {
  const { t } = useI18n();
  return <StatusChip status={CHIP[status]} label={t(`ui.people.status.${status}`)} />;
}

/** People directory (brief Module G): what each person may see is decided by the server. */
export function PeoplePage() {
  const { t, locale } = useI18n();
  const access = useAccess(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | 'all'>('all');
  const [departmentId, setDepartmentId] = useState('all');
  const [creating, setCreating] = useState(false);
  const term = useDebounced(search.trim());
  const params = new URLSearchParams();
  if (term) params.set('search', term);
  if (status !== 'all') params.set('status', status);
  if (departmentId !== 'all') params.set('departmentId', departmentId);
  const list = useQuery({
    queryKey: ['people', 'list', params.toString()],
    queryFn: () => api(`/people?${params.toString()}`, { schema: employeeListResponseSchema }),
    placeholderData: (previous) => previous,
  });
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api('/departments', { schema: departmentListResponseSchema }),
  });
  const items = list.data?.items ?? [];
  const filtered = Boolean(term) || status !== 'all' || departmentId !== 'all';
  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.people.title')}
        actions={
          <>
            <Link
              to="/organisation"
              className="inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame"
            >
              {t('ui.people.organisation')}
            </Link>
            {can(access.data, 'people.employee.manage') && (
              <Button
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => {
                  setCreating(true);
                }}
              >
                {t('ui.people.new')}
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <TextField
            label={t('ui.people.search')}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-48">
          <SelectField
            label={t('ui.people.department')}
            placeholder={t('ui.people.allDepartments')}
            value={departmentId}
            onValueChange={setDepartmentId}
            options={[
              { value: 'all', label: t('ui.people.allDepartments') },
              ...(departments.data?.items ?? [])
                .filter((d) => !d.archived)
                .map((d) => ({ value: d.id, label: locale === 'ar' ? d.name.ar : d.name.en })),
            ]}
          />
        </div>
        <div className="w-44">
          <SelectField
            label={t('ui.people.statusLabel')}
            placeholder={t('ui.people.allStatuses')}
            value={status}
            onValueChange={(v) => {
              setStatus(v as EmployeeStatus | 'all');
            }}
            options={[
              { value: 'all', label: t('ui.people.allStatuses') },
              ...EMPLOYEE_STATUSES.map((s) => ({ value: s, label: t(`ui.people.status.${s}`) })),
            ]}
          />
        </div>
      </div>
      <Card>
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
        {list.isSuccess && items.length === 0 && (
          <EmptyState
            title={filtered ? t('ui.people.noMatches') : t('ui.people.empty')}
            body={filtered ? t('ui.states.emptyBody') : t('ui.people.emptyBody')}
          />
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead className="text-[12px] text-ink-3">
                <tr>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.people.colNumber')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.people.colName')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.people.department')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.people.manager')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.people.statusLabel')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.membershipId} className="border-t border-line">
                    <td className="py-3 tabular-nums text-ink-2" dir="ltr">
                      {p.number}
                    </td>
                    <td className="py-3">
                      <Link
                        to="/people/$membershipId"
                        params={{ membershipId: p.membershipId }}
                        className="font-semibold hover:underline"
                      >
                        {p.name}
                      </Link>
                      <small className="block text-ink-3">
                        {(locale === 'ar' ? p.jobTitle.ar : p.jobTitle.en) || '—'}
                      </small>
                    </td>
                    <td className="py-3">
                      {p.department
                        ? locale === 'ar'
                          ? p.department.name.ar
                          : p.department.name.en
                        : '—'}
                    </td>
                    <td className="py-3">{p.manager?.name ?? '—'}</td>
                    <td className="py-3">
                      <EmployeeStatusChip status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && (
        <NewEmployeeDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function NewEmployeeDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [membershipId, setMembershipId] = useState('');
  const [departmentId, setDepartmentId] = useState('none');
  const [form, setForm] = useState({
    jobTitleEn: '',
    jobTitleAr: '',
    joinDate: '',
    weeklyHours: '40',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [key]: e.target.value });
  };
  const candidates = useQuery({
    queryKey: ['people', 'candidates'],
    queryFn: () => api('/people/candidates', { schema: employeeCandidatesResponseSchema }),
  });
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api('/departments', { schema: departmentListResponseSchema }),
  });
  const create = useMutation({
    mutationFn: () =>
      api('/people', {
        method: 'POST',
        body: {
          membershipId,
          jobTitleEn: form.jobTitleEn,
          jobTitleAr: form.jobTitleAr,
          departmentId: departmentId === 'none' ? null : departmentId,
          joinDate: form.joinDate || null,
          weeklyHours: form.weeklyHours.trim() || '40',
        },
        schema: employeeSchema,
      }),
    onSuccess: async (e) => {
      toast({ tone: 'good', title: t('ui.people.created', { number: e.number }) });
      await queryClient.invalidateQueries({ queryKey: ['people'] });
      await navigate({ to: '/people/$membershipId', params: { membershipId: e.membershipId } });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('ui.people.new')}
      description={t('ui.people.newHint')}
      closeLabel={t('ui.common.close')}
    >
      <form
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <SelectField
          label={t('ui.people.member')}
          placeholder={t('ui.people.member')}
          value={membershipId}
          onValueChange={setMembershipId}
          options={(candidates.data?.items ?? []).map((c) => ({
            value: c.membershipId,
            label: `${c.name} · ${c.email}`,
          }))}
        />
        {candidates.data?.items.length === 0 && (
          <small className="text-ink-3">{t('ui.people.noCandidates')}</small>
        )}
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
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: locale === 'ar' ? d.name.ar : d.name.en })),
          ]}
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
        <FormError error={create.error} />
        <Button type="submit" className="w-fit" loading={create.isPending} disabled={!membershipId}>
          {t('ui.people.create')}
        </Button>
      </form>
    </Dialog>
  );
}
