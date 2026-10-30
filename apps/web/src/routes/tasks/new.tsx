import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  clientListResponseSchema,
  projectHoursSchema,
  projectListResponseSchema,
  projectSchema,
  TASK_PRIORITIES,
  type TaskPriority,
  taskSchema,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
  Checkbox,
  SelectField,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { useSearchParam } from '../../lib/use-search-param.js';
import { hoursText } from '../projects/shared.js';
import {
  AllocationImpact,
  type AllocationRow,
  useAllocationPreview,
  validHours,
} from './shared.js';

/**
 * New task, following the brief's allocation workflow: client → project → its budget → task →
 * people → hours each → effect on remaining hours and workloads → validated → saved atomically.
 */
export function NewTaskPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const presetProject = useSearchParam('projectId') ?? '';
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState(presetProject);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    startDate: '',
    dueDate: '',
    estimatedHours: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [key]: e.target.value });
  };

  const clients = useQuery({
    queryKey: ['clients', 'picker'],
    queryFn: () => api('/clients?limit=100&sort=name', { schema: clientListResponseSchema }),
  });
  const project = useQuery({
    queryKey: ['projects', 'detail', projectId],
    enabled: Boolean(projectId),
    queryFn: () => api(`/projects/${projectId}`, { schema: projectSchema }),
  });
  const chosenClient = clientId || project.data?.client.id || '';
  const projects = useQuery({
    queryKey: ['projects', 'client', chosenClient],
    enabled: Boolean(chosenClient),
    queryFn: () =>
      api(`/projects?clientId=${chosenClient}&limit=100`, { schema: projectListResponseSchema }),
  });
  const hours = useQuery({
    queryKey: ['projects', 'detail', projectId, 'hours'],
    enabled: Boolean(projectId),
    queryFn: () => api(`/projects/${projectId}/hours`, { schema: projectHoursSchema }),
  });
  const preview = useAllocationPreview(projectId, rows);
  const team = project.data?.members ?? [];
  const openProjects = (projects.data?.items ?? []).filter(
    (p) => p.status !== 'completed' && p.status !== 'cancelled',
  );

  const create = useMutation({
    mutationFn: () =>
      api('/tasks', {
        method: 'POST',
        body: {
          projectId,
          title: form.title,
          description: form.description,
          priority,
          startDate: form.startDate || null,
          dueDate: form.dueDate || null,
          estimatedHours: form.estimatedHours.trim() || null,
          allocations: rows.map((r) => ({ membershipId: r.membershipId, hours: r.hours.trim() })),
          ...(override ? { override: true, overrideReason } : {}),
        },
        schema: taskSchema,
      }),
    onSuccess: async (task) => {
      toast({ tone: 'good', title: t('ui.tasks.created', { number: task.number }) });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await navigate({ to: '/tasks/$taskId', params: { taskId: task.id } });
    },
  });
  const fieldError = (path: string) =>
    isApiError(create.error) && create.error.details.some((d) => d.path === path)
      ? path === 'dueDate'
        ? t('ui.tasks.dueBeforeStart')
        : t('ui.validation.required')
      : undefined;
  const overBudget = preview.data?.overBudget ?? false;
  const blocked = overBudget && !(override && overrideReason.trim());

  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.tasks.new')} />
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Card title={t('ui.tasks.stepProject')}>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label={t('ui.tasks.fields.client')}
              placeholder={t('ui.tasks.fields.client')}
              value={chosenClient}
              onValueChange={(v) => {
                setClientId(v);
                setProjectId('');
                setRows([]);
              }}
              options={(clients.data?.items ?? []).map((c) => ({
                value: c.id,
                label: `${c.number} · ${locale === 'ar' ? c.legalName.ar : c.legalName.en}`,
              }))}
            />
            <SelectField
              label={t('ui.tasks.fields.project')}
              placeholder={t('ui.tasks.fields.project')}
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setRows([]);
              }}
              error={fieldError('projectId')}
              options={openProjects.map((p) => ({
                value: p.id,
                label: `${p.number} · ${locale === 'ar' ? p.name.ar : p.name.en}`,
              }))}
            />
          </div>
          {hours.data && (
            <p className="text-[13.5px] text-ink-2">
              {t('ui.tasks.projectBudget', {
                budgeted: hoursText(locale, t, hours.data.budgeted),
                allocated: hoursText(locale, t, hours.data.allocated),
                remaining: hoursText(locale, t, hours.data.remaining),
              })}
            </p>
          )}
        </Card>

        <Card title={t('ui.tasks.stepTask')}>
          <TextField
            label={t('ui.tasks.fields.title')}
            value={form.title}
            onChange={set('title')}
            error={fieldError('title')}
          />
          <div className="grid gap-4 md:grid-cols-4">
            <SelectField
              label={t('ui.tasks.fields.priority')}
              placeholder={t('ui.tasks.fields.priority')}
              value={priority}
              onValueChange={(v) => {
                setPriority(v as TaskPriority);
              }}
              options={TASK_PRIORITIES.map((p) => ({
                value: p,
                label: t(`ui.tasks.priority.${p}`),
              }))}
            />
            <TextField
              label={t('ui.tasks.fields.startDate')}
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
            />
            <TextField
              label={t('ui.tasks.fields.dueDate')}
              type="date"
              value={form.dueDate}
              onChange={set('dueDate')}
              error={fieldError('dueDate')}
            />
            <TextField
              label={t('ui.tasks.fields.estimatedHours')}
              inputMode="decimal"
              dir="ltr"
              value={form.estimatedHours}
              onChange={set('estimatedHours')}
            />
          </div>
          <TextArea
            label={t('ui.tasks.fields.description')}
            rows={3}
            value={form.description}
            onChange={set('description')}
          />
        </Card>

        <Card title={t('ui.tasks.stepPeople')}>
          {!projectId && <small className="text-ink-3">{t('ui.tasks.pickProjectFirst')}</small>}
          <AllocationEditor team={team} rows={rows} onChange={setRows} />
          <AllocationImpact preview={preview} />
          {overBudget && preview.data?.canOverride && (
            <div className="grid gap-2">
              <Checkbox
                label={t('ui.tasks.override')}
                checked={override}
                onCheckedChange={setOverride}
              />
              {override && (
                <TextArea
                  label={t('ui.tasks.overrideReason')}
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => {
                    setOverrideReason(e.target.value);
                  }}
                />
              )}
            </div>
          )}
        </Card>
        <FormError error={create.error} />
        <Button
          type="submit"
          className="w-fit"
          loading={create.isPending}
          disabled={!projectId || !form.title.trim() || !validHours(rows) || blocked}
        >
          {t('ui.tasks.create')}
        </Button>
      </form>
    </div>
  );
}

/** Choose team members and the hours each one is allocated. */
export function AllocationEditor({
  team,
  rows,
  onChange,
}: {
  team: { membershipId: string; name: string }[];
  rows: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="grid gap-2">
      {team.map((m) => {
        const row = rows.find((r) => r.membershipId === m.membershipId);
        return (
          <li key={m.membershipId} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1 pb-2.5">
              <Checkbox
                label={m.name}
                checked={row !== undefined}
                onCheckedChange={(on) => {
                  onChange(
                    on
                      ? [...rows, { membershipId: m.membershipId, hours: '' }]
                      : rows.filter((r) => r.membershipId !== m.membershipId),
                  );
                }}
              />
            </div>
            {row && (
              <div className="w-36">
                <TextField
                  label={t('ui.tasks.hoursFor', { name: m.name })}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0"
                  value={row.hours}
                  onChange={(e) => {
                    onChange(
                      rows.map((r) =>
                        r.membershipId === m.membershipId ? { ...r, hours: e.target.value } : r,
                      ),
                    );
                  }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
