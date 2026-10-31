import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  BILLING_METHODS,
  type BillingMethod,
  budgetRevisionListResponseSchema,
  memberListResponseSchema,
  type Project,
  projectActivitySchema,
  projectHoursSchema,
  projectSchema,
  type ProjectStatus,
} from '@ultimate-erp/contracts';
import { formatDate, formatMoney } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Meter,
  SelectField,
  Tabs,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { ProjectExpensesCard } from '../expenses/expenses.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, canAny, useAccess } from '../../lib/session.js';
import { DocumentsTab } from '../clients/tabs.js';
import { dateText } from '../contracts/shared.js';
import { ProjectTasksTab } from '../tasks/project-tab.js';
import { hoursText, projectKey, ProjectStatusChip } from './shared.js';

/** Statuses that close the project for good — confirmed in a dialog first. */
const FINAL: ProjectStatus[] = ['completed', 'cancelled'];

/** One project: details, hours, budget history, team, documents, activity (docs/modules/projects.md). */
export function ProjectDetailPage() {
  const { t, locale } = useI18n();
  const { projectId } = useParams({ from: '/app/projects/$projectId' });
  const access = useAccess(true);
  const project = useQuery({
    queryKey: projectKey(projectId),
    queryFn: () => api(`/projects/${projectId}`, { schema: projectSchema }),
  });

  if (project.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (project.isError) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, project.error)}
        reference={errorReference(t, project.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void project.refetch()}
      />
    );
  }
  const p = project.data;
  const canManage = p.actions.includes('edit');
  const open = p.status !== 'completed' && p.status !== 'cancelled';
  return (
    <div className="grid gap-4">
      <AppPageHeader title={locale === 'ar' ? p.name.ar : p.name.en} />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span dir="ltr" className="tabular-nums">
          {p.number}
        </span>
        <span aria-hidden>·</span>
        <Link
          to="/clients/$clientId"
          params={{ clientId: p.client.id }}
          className="font-semibold text-plum hover:underline"
        >
          {locale === 'ar' ? p.client.name.ar : p.client.name.en}
        </Link>
        {p.contract && (
          <>
            <span aria-hidden>·</span>
            <Link
              to="/contracts/$contractId"
              params={{ contractId: p.contract.id }}
              className="font-semibold text-plum hover:underline"
            >
              <span dir="ltr">{p.contract.number}</span>
            </Link>
          </>
        )}
        <ProjectStatusChip status={p.status} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <HoursCard project={p} />
          {(canManage || can(access.data, 'expenses.claim.read')) && (
            <ProjectExpensesCard projectId={p.id} />
          )}
          <Tabs
            label={t('ui.projects.title')}
            items={[
              {
                value: 'tasks',
                label: t('ui.projects.tabs.tasks'),
                content: (
                  <ProjectTasksTab
                    projectId={p.id}
                    canCreate={open && canAny(access.data, 'tasks.task.manage')}
                    canAllocate={canAny(access.data, 'tasks.allocation.manage')}
                  />
                ),
              },
              {
                value: 'details',
                label: t('ui.projects.tabs.details'),
                content: <DetailsCard key={p.version} project={p} />,
              },
              {
                value: 'budget',
                label: t('ui.projects.tabs.budget'),
                content: <BudgetCard project={p} />,
              },
              {
                value: 'documents',
                label: t('ui.projects.tabs.documents'),
                content: <DocumentsTab basePath={`/projects/${p.id}`} canUpdate={canManage} />,
              },
              {
                value: 'activity',
                label: t('ui.projects.tabs.activity'),
                content: <ActivityCard project={p} />,
              },
            ]}
          />
        </div>
        <div className="grid content-start gap-4">
          <StatusCard project={p} />
          <TeamCard project={p} />
        </div>
      </div>
    </div>
  );
}

function useSave() {
  const queryClient = useQueryClient();
  return async (updated: Project) => {
    queryClient.setQueryData(projectKey(updated.id), updated);
    await queryClient.invalidateQueries({ queryKey: ['projects', 'list'] });
  };
}

// --- Hours -------------------------------------------------------------------------------------

function HoursCard({ project: p }: { project: Project }) {
  const { t, locale } = useI18n();
  const hours = useQuery({
    queryKey: [...projectKey(p.id), 'hours', p.version],
    queryFn: () => api(`/projects/${p.id}/hours`, { schema: projectHoursSchema }),
  });
  return (
    <Card title={t('ui.projects.hoursTitle')}>
      {hours.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {hours.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, hours.error)}
          reference={errorReference(t, hours.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void hours.refetch()}
        />
      )}
      {hours.data && (
        <>
          <Meter
            label={t('ui.projects.allocatedOfBudget')}
            value={Number(hours.data.allocated)}
            max={Number(hours.data.budgeted)}
          />
          {hours.data.warning !== 'none' && (
            <p
              role="status"
              className={`rounded-tile p-3 text-[13.5px] ${hours.data.warning === 'exceeded' ? 'bg-blush text-blush-ink' : 'bg-butter text-butter-ink'}`}
            >
              {t(`ui.projects.warning.${hours.data.warning}`)}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              ['budgeted', 'allocated', 'remaining', 'logged', 'approved', 'billable'] as const
            ).map((k) => (
              <div key={k} className="grid gap-0.5 rounded-tile bg-frame p-3">
                <dt className="text-[12px] font-semibold text-ink-3">
                  {t(`ui.projects.measure.${k}`)}
                </dt>
                <dd className="text-[15px] font-bold tabular-nums">
                  {hoursText(locale, t, hours.data[k])}
                </dd>
              </div>
            ))}
          </dl>
          <small className="text-ink-3">{t('ui.projects.measuresLater')}</small>
        </>
      )}
    </Card>
  );
}

// --- Details -----------------------------------------------------------------------------------

function DetailsCard({ project: p }: { project: Project }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const saved = useSave();
  const access = useAccess(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    nameEn: p.name.en,
    nameAr: p.name.ar,
    description: p.description ?? '',
    startDate: p.startDate ?? '',
    endDate: p.endDate ?? '',
  });
  const [billing, setBilling] = useState<BillingMethod>(p.billingMethod);
  const [managerId, setManagerId] = useState(p.manager?.membershipId ?? '');
  const members = useQuery({
    queryKey: ['members'],
    enabled: editing && can(access.data, 'access.members.read'),
    queryFn: () => api('/members', { schema: memberListResponseSchema }),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [key]: e.target.value });
  };
  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${p.id}`, {
        method: 'PATCH',
        body: {
          version: p.version,
          nameEn: form.nameEn,
          nameAr: form.nameAr,
          description: form.description,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          billingMethod: billing,
          ...(managerId && managerId !== p.manager?.membershipId
            ? { managerMembershipId: managerId }
            : {}),
        },
        schema: projectSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setEditing(false);
      toast({ tone: 'good', title: t('ui.projects.saved') });
    },
  });
  const endError =
    isApiError(save.error) && save.error.details.some((d) => d.path === 'endDate')
      ? t('ui.projects.endBeforeStart')
      : undefined;

  if (editing) {
    const managers = (members.data?.members ?? []).filter((m) => m.status === 'active');
    return (
      <Card>
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label={t('ui.projects.fields.nameEn')}
              dir="ltr"
              lang="en"
              value={form.nameEn}
              onChange={set('nameEn')}
            />
            <TextField
              label={t('ui.projects.fields.nameAr')}
              dir="rtl"
              lang="ar"
              value={form.nameAr}
              onChange={set('nameAr')}
            />
            <TextField
              label={t('ui.projects.fields.startDate')}
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
            />
            <TextField
              label={t('ui.projects.fields.endDate')}
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              error={endError}
            />
            <SelectField
              label={t('ui.projects.fields.billingMethod')}
              placeholder={t('ui.projects.fields.billingMethod')}
              value={billing}
              onValueChange={(v) => {
                setBilling(v as BillingMethod);
              }}
              options={BILLING_METHODS.map((b) => ({
                value: b,
                label: t(`ui.projects.billing.${b}`),
              }))}
            />
            {managers.length > 0 && (
              <SelectField
                label={t('ui.projects.fields.manager')}
                placeholder={t('ui.projects.fields.manager')}
                value={managerId}
                onValueChange={setManagerId}
                options={managers.map((m) => ({ value: m.membershipId, label: m.name }))}
              />
            )}
          </div>
          <TextArea
            label={t('ui.projects.fields.description')}
            rows={3}
            value={form.description}
            onChange={set('description')}
          />
          <FormError error={save.error} />
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!form.nameEn.trim() || !form.nameAr.trim()}
            >
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
      </Card>
    );
  }
  const row = (label: string, value: string) => (
    <div className="grid gap-0.5">
      <dt className="text-[12px] font-semibold text-ink-3">{label}</dt>
      <dd className="text-[14px]">{value || '—'}</dd>
    </div>
  );
  return (
    <Card
      action={
        p.actions.includes('edit') ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('ui.common.edit')}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        {row(t('ui.projects.fields.manager'), p.manager?.name ?? '')}
        {row(t('ui.projects.fields.billingMethod'), t(`ui.projects.billing.${p.billingMethod}`))}
        {row(t('ui.projects.fields.startDate'), dateText(locale, p.startDate))}
        {row(t('ui.projects.fields.endDate'), dateText(locale, p.endDate))}
        {p.contract &&
          row(
            t('ui.projects.fields.contract'),
            `${p.contract.number} · ${locale === 'ar' ? p.contract.title.ar : p.contract.title.en}`,
          )}
      </dl>
      {p.description && <p className="whitespace-pre-line text-[14px]">{p.description}</p>}
    </Card>
  );
}

// --- Budget ------------------------------------------------------------------------------------

function BudgetCard({ project: p }: { project: Project }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const saved = useSave();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ budgetHours: '', budgetAmount: '', reason: '' });
  const history = useQuery({
    queryKey: [...projectKey(p.id), 'budget', p.budgetRevision],
    queryFn: () => api(`/projects/${p.id}/budget`, { schema: budgetRevisionListResponseSchema }),
  });
  const revise = useMutation({
    mutationFn: () =>
      api(`/projects/${p.id}/budget`, {
        method: 'POST',
        body: {
          budgetHours: form.budgetHours.trim(),
          budgetAmount: form.budgetAmount.trim() || null,
          reason: form.reason,
        },
        schema: projectSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setOpen(false);
      toast({ tone: 'good', title: t('ui.projects.budgetRevised') });
    },
  });
  const money = (amount: string | null) => (amount ? formatMoney(locale, amount, p.currency) : '—');
  return (
    <Card
      action={
        p.actions.includes('budget') ? (
          <Button
            size="sm"
            onClick={() => {
              revise.reset();
              setForm({
                budgetHours: p.budgetHours,
                budgetAmount: p.budgetAmount ?? '',
                reason: '',
              });
              setOpen(true);
            }}
          >
            {t('ui.projects.revise')}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-0.5">
          <dt className="text-[12px] font-semibold text-ink-3">
            {t('ui.projects.fields.budgetHours')}
          </dt>
          <dd className="text-[15px] font-bold tabular-nums">
            {hoursText(locale, t, p.budgetHours)}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-[12px] font-semibold text-ink-3">
            {t('ui.projects.fields.budgetAmount')}
          </dt>
          <dd className="text-[15px] font-bold tabular-nums">{money(p.budgetAmount)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-[12px] font-semibold text-ink-3">{t('ui.projects.revision')}</dt>
          <dd className="text-[15px] font-bold tabular-nums">{p.budgetRevision}</dd>
        </div>
      </dl>
      <h3 className="text-[13px] font-bold">{t('ui.projects.history')}</h3>
      {history.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {history.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, history.error)}
          reference={errorReference(t, history.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void history.refetch()}
        />
      )}
      <ol className="grid gap-3">
        {history.data?.items.map((r) => (
          <li key={r.revisionNo} className="grid gap-0.5 border-s-2 border-lilac ps-3">
            <span className="text-[13.5px] font-semibold">
              {t('ui.projects.revisionLine', {
                n: r.revisionNo,
                hours: hoursText(locale, t, r.budgetHours),
                amount: money(r.budgetAmount),
              })}
            </span>
            <small className="text-ink-2">{r.reason}</small>
            <small className="text-ink-3">
              {formatDate(locale, new Date(r.createdAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {r.changedByName ? ` · ${r.changedByName}` : ''}
            </small>
          </li>
        ))}
      </ol>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('ui.projects.revise')}
        description={t('ui.projects.reviseHint')}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            revise.mutate();
          }}
        >
          <TextField
            label={t('ui.projects.fields.budgetHours')}
            inputMode="decimal"
            dir="ltr"
            value={form.budgetHours}
            onChange={(e) => {
              setForm({ ...form, budgetHours: e.target.value });
            }}
          />
          <TextField
            label={t('ui.projects.fields.budgetAmount')}
            inputMode="decimal"
            dir="ltr"
            placeholder="0.000"
            value={form.budgetAmount}
            onChange={(e) => {
              setForm({ ...form, budgetAmount: e.target.value });
            }}
          />
          <TextArea
            label={t('ui.projects.reason')}
            rows={3}
            value={form.reason}
            onChange={(e) => {
              setForm({ ...form, reason: e.target.value });
            }}
          />
          <FormError error={revise.error} />
          <Button
            type="submit"
            loading={revise.isPending}
            disabled={!form.budgetHours.trim() || !form.reason.trim()}
          >
            {t('ui.projects.saveRevision')}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}

// --- Status ------------------------------------------------------------------------------------

function StatusCard({ project: p }: { project: Project }) {
  const { t } = useI18n();
  const toast = useToast();
  const saved = useSave();
  const [confirm, setConfirm] = useState<ProjectStatus | null>(null);
  const move = useMutation({
    mutationFn: (status: ProjectStatus) =>
      api(`/projects/${p.id}/status`, { method: 'POST', body: { status }, schema: projectSchema }),
    onSuccess: async (updated) => {
      await saved(updated);
      setConfirm(null);
      toast({ tone: 'good', title: t('ui.projects.statusChanged') });
    },
  });
  return (
    <Card title={t('ui.projects.statusTitle')}>
      <div className="flex items-center gap-2">
        <ProjectStatusChip status={p.status} />
      </div>
      {p.nextStatuses.length === 0 && FINAL.includes(p.status) && (
        <small className="text-ink-3">{t('ui.projects.closedHint')}</small>
      )}
      <div className="grid gap-2">
        {p.nextStatuses.map((s) => (
          <Button
            key={s}
            variant={s === 'cancelled' ? 'secondary' : 'primary'}
            loading={move.isPending && move.variables === s}
            onClick={() => {
              move.reset();
              if (FINAL.includes(s)) setConfirm(s);
              else move.mutate(s);
            }}
          >
            {t(`ui.projects.moveTo.${s}`)}
          </Button>
        ))}
      </div>
      {!confirm && <FormError error={move.error} />}
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirm ? t(`ui.projects.moveTo.${confirm}`) : ''}
        description={t('ui.projects.finalHint')}
        closeLabel={t('ui.common.close')}
      >
        <FormError error={move.error} />
        <Button
          loading={move.isPending}
          onClick={() => {
            if (confirm) move.mutate(confirm);
          }}
        >
          {confirm ? t(`ui.projects.moveTo.${confirm}`) : ''}
        </Button>
      </Dialog>
    </Card>
  );
}

// --- Team --------------------------------------------------------------------------------------

function TeamCard({ project: p }: { project: Project }) {
  const { t } = useI18n();
  const toast = useToast();
  const saved = useSave();
  const access = useAccess(true);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const mayEdit = p.actions.includes('team') && can(access.data, 'access.members.read');
  const members = useQuery({
    queryKey: ['members'],
    enabled: open,
    queryFn: () => api('/members', { schema: memberListResponseSchema }),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${p.id}/members`, {
        method: 'PUT',
        body: { memberIds: picked },
        schema: projectSchema,
      }),
    onSuccess: async (updated) => {
      await saved(updated);
      setOpen(false);
      toast({ tone: 'good', title: t('ui.projects.teamSaved') });
    },
  });
  return (
    <Card
      title={t('ui.projects.teamTitle')}
      action={
        mayEdit ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              save.reset();
              setPicked(p.members.map((m) => m.membershipId));
              setOpen(true);
            }}
          >
            {t('ui.projects.editTeam')}
          </Button>
        ) : undefined
      }
    >
      {p.members.length === 0 ? (
        <EmptyState title={t('ui.projects.noTeam')} body={t('ui.states.emptyBody')} />
      ) : (
        <ul className="grid gap-1.5 text-[13.5px]">
          {p.members.map((m) => (
            <li key={m.membershipId} className="flex items-center justify-between gap-2">
              <span>{m.name}</span>
              {m.membershipId === p.manager?.membershipId && (
                <small className="rounded-full bg-lilac px-2 py-0.5 font-semibold text-lilac-ink">
                  {t('ui.projects.managerBadge')}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('ui.projects.editTeam')}
        description={t('ui.projects.teamHint')}
        closeLabel={t('ui.common.close')}
      >
        {members.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
        <div className="grid gap-2">
          {(members.data?.members ?? [])
            .filter((m) => m.status === 'active' && m.membershipId !== p.manager?.membershipId)
            .map((m) => (
              <Checkbox
                key={m.membershipId}
                label={m.name}
                checked={picked.includes(m.membershipId)}
                onCheckedChange={(on) => {
                  setPicked(
                    on ? [...picked, m.membershipId] : picked.filter((id) => id !== m.membershipId),
                  );
                }}
              />
            ))}
        </div>
        <FormError error={save.error} />
        <Button
          className="w-fit"
          loading={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {t('ui.common.save')}
        </Button>
      </Dialog>
    </Card>
  );
}

// --- Activity ----------------------------------------------------------------------------------

function ActivityCard({ project: p }: { project: Project }) {
  const { t, locale } = useI18n();
  const activity = useQuery({
    queryKey: [...projectKey(p.id), 'activity', p.version],
    queryFn: () => api(`/projects/${p.id}/activity`, { schema: projectActivitySchema }),
  });
  const statusName = (s: string | null) =>
    s && (['planned', 'active', 'on_hold', 'completed', 'cancelled'] as string[]).includes(s)
      ? t(`ui.projects.status.${s as ProjectStatus}`)
      : (s ?? '');
  return (
    <Card>
      {activity.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {activity.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, activity.error)}
          reference={errorReference(t, activity.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void activity.refetch()}
        />
      )}
      {activity.data?.items.length === 0 && (
        <EmptyState title={t('ui.projects.noActivity')} body={t('ui.states.emptyBody')} />
      )}
      <ol className="grid gap-3">
        {activity.data?.items.map((item) => (
          <li key={item.id} className="grid gap-0.5 border-s-2 border-lilac ps-3">
            <span className="text-[13.5px]">
              {t(
                `ui.projects.activity.${item.action.replace(/\./g, '_') as 'projects_project_created'}`,
                {
                  actor: item.actorName ?? t('ui.dashboard.system'),
                  from:
                    item.action === 'projects.budget.revised'
                      ? hoursText(locale, t, item.from ?? '0')
                      : statusName(item.from),
                  to:
                    item.action === 'projects.budget.revised'
                      ? hoursText(locale, t, item.to ?? '0')
                      : statusName(item.to),
                },
              )}
            </span>
            <small className="text-ink-3">
              {formatDate(locale, new Date(item.occurredAt), {
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
