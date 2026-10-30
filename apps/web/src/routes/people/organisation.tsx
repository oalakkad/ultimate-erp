import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  departmentListResponseSchema,
  employeeListResponseSchema,
  orgChartSchema,
  teamListResponseSchema,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  LoadingState,
  SelectField,
  TextField,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { can, useAccess } from '../../lib/session.js';

/** Departments, teams and reporting lines. */
export function OrganisationPage() {
  const { t } = useI18n();
  const access = useAccess(true);
  const canEdit = can(access.data, 'people.org.manage');
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.people.organisation')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DepartmentsCard canEdit={canEdit} />
        <TeamsCard canEdit={canEdit} />
      </div>
      <OrgChartCard />
    </div>
  );
}

function DepartmentsCard({ canEdit }: { canEdit: boolean }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [names, setNames] = useState({ nameEn: '', nameAr: '' });
  const list = useQuery({
    queryKey: ['departments'],
    queryFn: () => api('/departments', { schema: departmentListResponseSchema }),
  });
  const add = useMutation({
    mutationFn: () =>
      api('/departments', { method: 'POST', body: names, schema: departmentListResponseSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(['departments'], data);
      setNames({ nameEn: '', nameAr: '' });
    },
  });
  const items = (list.data?.items ?? []).filter((d) => !d.archived);
  return (
    <Card title={t('ui.people.departments')}>
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.data && items.length === 0 && (
        <small className="text-ink-3">{t('ui.people.noDepartments')}</small>
      )}
      <ul className="grid gap-1.5 text-[13.5px]">
        {items.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2">
            <span>{locale === 'ar' ? d.name.ar : d.name.en}</span>
            <small className="text-ink-3">{t('ui.people.peopleCount', { count: d.people })}</small>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          noValidate
          className="grid gap-2 sm:grid-cols-3 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <TextField
            label={t('ui.people.nameEn')}
            dir="ltr"
            lang="en"
            value={names.nameEn}
            onChange={(e) => {
              setNames({ ...names, nameEn: e.target.value });
            }}
          />
          <TextField
            label={t('ui.people.nameAr')}
            dir="rtl"
            lang="ar"
            value={names.nameAr}
            onChange={(e) => {
              setNames({ ...names, nameAr: e.target.value });
            }}
          />
          <Button
            type="submit"
            loading={add.isPending}
            disabled={!names.nameEn.trim() || !names.nameAr.trim()}
          >
            {t('ui.people.addDepartment')}
          </Button>
        </form>
      )}
      <FormError error={add.error} />
    </Card>
  );
}

function TeamsCard({ canEdit }: { canEdit: boolean }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [names, setNames] = useState({ nameEn: '', nameAr: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [lead, setLead] = useState('none');
  const [picked, setPicked] = useState<string[]>([]);
  const list = useQuery({
    queryKey: ['teams'],
    queryFn: () => api('/teams', { schema: teamListResponseSchema }),
  });
  const people = useQuery({
    queryKey: ['people', 'list', ''],
    enabled: editing !== null,
    queryFn: () => api('/people', { schema: employeeListResponseSchema }),
  });
  const add = useMutation({
    mutationFn: () =>
      api('/teams', { method: 'POST', body: names, schema: teamListResponseSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(['teams'], data);
      setNames({ nameEn: '', nameAr: '' });
    },
  });
  const save = useMutation({
    mutationFn: async (teamId: string) => {
      await api(`/teams/${teamId}`, {
        method: 'PATCH',
        body: { leadMembershipId: lead === 'none' ? null : lead },
        schema: teamListResponseSchema,
      });
      return api(`/teams/${teamId}/members`, {
        method: 'PUT',
        body: { memberIds: picked },
        schema: teamListResponseSchema,
      });
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(['teams'], data);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });
  const items = (list.data?.items ?? []).filter((x) => !x.archived);
  const team = items.find((x) => x.id === editing);
  const active = (people.data?.items ?? []).filter((p) => p.status !== 'left');
  return (
    <Card title={t('ui.people.teamsTitle')}>
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {list.data && items.length === 0 && (
        <small className="text-ink-3">{t('ui.people.noTeams')}</small>
      )}
      <ul className="grid gap-2 text-[13.5px]">
        {items.map((x) => (
          <li key={x.id} className="grid gap-1 rounded-tile bg-frame p-3">
            <div className="flex items-center justify-between gap-2">
              <b>{locale === 'ar' ? x.name.ar : x.name.en}</b>
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    save.reset();
                    setLead(x.lead?.membershipId ?? 'none');
                    setPicked(x.members.map((m) => m.membershipId));
                    setEditing(x.id);
                  }}
                >
                  {t('ui.common.edit')}
                </Button>
              )}
            </div>
            <small className="text-ink-2">
              {t('ui.people.teamLine', { lead: x.lead?.name ?? '—', count: x.members.length })}
            </small>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          noValidate
          className="grid gap-2 sm:grid-cols-3 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <TextField
            label={t('ui.people.teamNameEn')}
            dir="ltr"
            lang="en"
            value={names.nameEn}
            onChange={(e) => {
              setNames({ ...names, nameEn: e.target.value });
            }}
          />
          <TextField
            label={t('ui.people.teamNameAr')}
            dir="rtl"
            lang="ar"
            value={names.nameAr}
            onChange={(e) => {
              setNames({ ...names, nameAr: e.target.value });
            }}
          />
          <Button
            type="submit"
            loading={add.isPending}
            disabled={!names.nameEn.trim() || !names.nameAr.trim()}
          >
            {t('ui.people.addTeam')}
          </Button>
        </form>
      )}
      <FormError error={add.error} />
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        title={team ? (locale === 'ar' ? team.name.ar : team.name.en) : ''}
        description={t('ui.people.teamHint')}
        closeLabel={t('ui.common.close')}
      >
        <SelectField
          label={t('ui.people.teamLead')}
          placeholder={t('ui.people.noLead')}
          value={lead}
          onValueChange={setLead}
          options={[
            { value: 'none', label: t('ui.people.noLead') },
            ...active.map((p) => ({ value: p.membershipId, label: p.name })),
          ]}
        />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-semibold">{t('ui.people.teamMembers')}</legend>
          {active.map((p) => (
            <Checkbox
              key={p.membershipId}
              label={p.name}
              checked={picked.includes(p.membershipId)}
              onCheckedChange={(on) => {
                setPicked(
                  on ? [...picked, p.membershipId] : picked.filter((id) => id !== p.membershipId),
                );
              }}
            />
          ))}
        </fieldset>
        <FormError error={save.error} />
        <Button
          className="w-fit"
          loading={save.isPending}
          onClick={() => {
            if (editing) save.mutate(editing);
          }}
        >
          {t('ui.common.save')}
        </Button>
      </Dialog>
    </Card>
  );
}

function OrgChartCard() {
  const { t, locale } = useI18n();
  const chart = useQuery({
    queryKey: ['people', 'org-chart'],
    queryFn: () => api('/org-chart', { schema: orgChartSchema }),
  });
  const nodes = chart.data?.nodes ?? [];
  const ids = new Set(nodes.map((n) => n.membershipId));
  const childrenOf = (id: string | null) =>
    nodes
      .filter((n) =>
        id === null
          ? !n.managerMembershipId || !ids.has(n.managerMembershipId)
          : n.managerMembershipId === id,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  const render = (id: string | null, depth: number, seen: Set<string>): React.ReactNode => {
    const kids = childrenOf(id).filter((k) => !seen.has(k.membershipId));
    if (kids.length === 0) return null;
    return (
      <ul className={depth > 0 ? 'grid gap-1.5 border-s-2 border-lilac ps-4' : 'grid gap-1.5'}>
        {kids.map((k) => (
          <li key={k.membershipId} className="grid gap-1.5">
            <span className="text-[13.5px]">
              <Link
                to="/people/$membershipId"
                params={{ membershipId: k.membershipId }}
                className="font-semibold hover:underline"
              >
                {k.name}
              </Link>
              {(locale === 'ar' ? k.jobTitle.ar : k.jobTitle.en) && (
                <small className="text-ink-3">
                  {' '}
                  · {locale === 'ar' ? k.jobTitle.ar : k.jobTitle.en}
                </small>
              )}
            </span>
            {render(k.membershipId, depth + 1, new Set([...seen, k.membershipId]))}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <Card title={t('ui.people.reportingLines')}>
      {chart.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
      {chart.data && nodes.length === 0 && (
        <EmptyState title={t('ui.people.empty')} body={t('ui.people.emptyBody')} />
      )}
      {render(null, 0, new Set())}
    </Card>
  );
}
