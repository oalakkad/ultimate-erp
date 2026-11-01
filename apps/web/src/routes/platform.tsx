import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import {
  type PlatformCompany,
  platformAuditListResponseSchema,
  platformCompanyListResponseSchema,
  platformCompanySchema,
  platformMeResponseSchema,
  platformOverviewSchema,
} from '@ultimate-erp/contracts';
import { formatDate, formatNumber } from '@ultimate-erp/i18n';
import {
  Avatar,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Logo,
  SelectField,
  StatusChip,
  TextArea,
  TextField,
  Tile,
} from '@ultimate-erp/ui';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch, ThemeSwitch } from '../app/switches.js';
import { FormError } from '../components/auth-layout.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { useMe } from '../lib/session.js';
import { useDebounced } from '../lib/use-debounced.js';

/** Whether this signed-in person may open the console (the server decides; this only shows a link). */
export function usePlatformAccess(enabled: boolean) {
  return useQuery({
    queryKey: ['platform', 'me'],
    enabled,
    queryFn: () => api('/platform/me', { schema: platformMeResponseSchema }),
  });
}

const megabytes = (bytes: string) => Math.round(Number(bytes) / 1_048_576);

/**
 * The founder's view of the installation: every company, its size and activity, suspend /
 * reactivate with a recorded reason. Main address only; nothing here opens a company's data.
 */
export function PlatformPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const access = usePlatformAccess(Boolean(me.data));
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [target, setTarget] = useState<PlatformCompany | null>(null);
  const [reason, setReason] = useState('');
  const query = useDebounced(search, 300);

  const overview = useQuery({
    queryKey: ['platform', 'overview'],
    enabled: access.data?.founder === true,
    queryFn: () => api('/platform/overview', { schema: platformOverviewSchema }),
  });
  const companies = useQuery({
    queryKey: ['platform', 'companies', query, status],
    enabled: access.data?.founder === true,
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('search', query.trim());
      if (status !== 'all') params.set('status', status);
      const qs = params.toString();
      return api(`/platform/companies${qs ? `?${qs}` : ''}`, {
        schema: platformCompanyListResponseSchema,
      });
    },
  });
  const audit = useQuery({
    queryKey: ['platform', 'audit'],
    enabled: access.data?.founder === true,
    queryFn: () => api('/platform/audit-events', { schema: platformAuditListResponseSchema }),
  });
  const setCompanyStatus = useMutation({
    mutationFn: (input: { company: PlatformCompany; status: 'active' | 'suspended' }) =>
      api(`/platform/companies/${input.company.tenantId}/status`, {
        method: 'POST',
        body: { status: input.status, reason: reason.trim() },
        schema: platformCompanySchema,
      }),
    onSuccess: () => {
      setTarget(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });

  if (me.isPending || (me.data && access.isPending)) {
    return <LoadingState label={t('ui.common.loading')} />;
  }
  if (!me.data) return <Navigate to="/sign-in" search={{ returnTo: '/platform' }} />;
  if (access.isError) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, access.error)}
        reference={errorReference(t, access.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void access.refetch()}
      />
    );
  }
  if (!access.data?.founder) return <Navigate to="/companies" />;

  const name = (c: PlatformCompany) => (locale === 'ar' ? c.name.ar : c.name.en);
  const date = (iso: string | null, withTime = false) =>
    iso
      ? formatDate(
          locale,
          new Date(iso),
          withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
        )
      : '—';
  const n = (value: number) => formatNumber(locale, value);
  const o = overview.data;
  const nextStatus = target?.status === 'active' ? 'suspended' : 'active';

  return (
    <div className="grid min-h-screen content-start gap-5 bg-ground px-3 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-[1180px] gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo subtitle={t('ui.platform.subtitle')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/companies"
              className="inline-flex items-center gap-1.5 rounded-ctl px-3 py-2 text-[13px] font-semibold text-plum hover:bg-card"
            >
              <ArrowLeft aria-hidden className="mirror size-4" />
              {t('ui.companies.title')}
            </Link>
            <ThemeSwitch />
            <LanguageSwitch />
          </div>
        </header>

        <div className="ui-rise flex items-start gap-3 rounded-card border border-line bg-card p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-tile bg-plum-soft text-plum">
            <ShieldCheck aria-hidden className="size-5" />
          </span>
          <div className="grid gap-1">
            <h1 className="text-[22px] font-extrabold tracking-tight">{t('ui.platform.title')}</h1>
            <p className="text-[13.5px] text-ink-2">{t('ui.platform.body')}</p>
          </div>
        </div>

        {overview.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, overview.error)}
            reference={errorReference(t, overview.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void overview.refetch()}
          />
        )}
        {o && (
          <section
            aria-label={t('ui.platform.overview')}
            className="ui-stagger grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            <Tile tone="lilac" label={t('ui.platform.companies')} value={n(o.companies)} />
            <Tile tone="mint" label={t('ui.platform.active')} value={n(o.companiesActive)} />
            <Tile
              tone={o.companiesSuspended > 0 ? 'blush' : 'sky'}
              label={t('ui.platform.suspended')}
              value={n(o.companiesSuspended)}
            />
            <Tile tone="sky" label={t('ui.platform.new30d')} value={n(o.companiesNew30d)} />
            <Tile tone="butter" label={t('ui.platform.people')} value={n(o.people)} />
            <Tile tone="sky" label={t('ui.platform.accounts')} value={n(o.accounts)} />
            <Tile tone="mint" label={t('ui.platform.signIns7d')} value={n(o.signIns7d)} />
            <Tile
              tone="lilac"
              label={t('ui.platform.storage')}
              value={n(megabytes(o.filesBytes))}
              unit="MB"
            />
          </section>
        )}

        <Card title={t('ui.platform.companiesTitle')}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <TextField
              label={t('ui.platform.search')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder={t('ui.platform.searchPlaceholder')}
            />
            <SelectField
              label={t('ui.platform.status')}
              placeholder={t('ui.platform.status')}
              value={status}
              onValueChange={(v) => {
                setStatus(v as typeof status);
              }}
              options={[
                { value: 'all', label: t('ui.platform.statusAll') },
                { value: 'active', label: t('ui.platform.active') },
                { value: 'suspended', label: t('ui.platform.suspended') },
              ]}
            />
          </div>
          {companies.isPending && <LoadingState label={t('ui.common.loading')} lines={4} />}
          {companies.isError && (
            <ErrorState
              title={t('ui.states.errorTitle')}
              body={errorText(t, companies.error)}
              reference={errorReference(t, companies.error)}
              retryLabel={t('ui.common.retry')}
              onRetry={() => void companies.refetch()}
            />
          )}
          {companies.data?.items.length === 0 && (
            <EmptyState
              title={t('ui.platform.noCompanies')}
              body={t('ui.platform.noCompaniesBody')}
            />
          )}
          {companies.data && companies.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="text-start text-[12px] text-ink-3">
                    <th className="py-2 pe-3 text-start font-semibold">
                      {t('ui.platform.colCompany')}
                    </th>
                    <th className="py-2 pe-3 text-start font-semibold">
                      {t('ui.platform.colOwners')}
                    </th>
                    <th className="py-2 pe-3 text-end font-semibold">
                      {t('ui.platform.colPeople')}
                    </th>
                    <th className="py-2 pe-3 text-start font-semibold">
                      {t('ui.platform.colLastActivity')}
                    </th>
                    <th className="py-2 pe-3 text-start font-semibold">
                      {t('ui.platform.colCreated')}
                    </th>
                    <th className="py-2 pe-3 text-start font-semibold">
                      {t('ui.platform.status')}
                    </th>
                    <th className="py-2 text-end font-semibold">
                      <span className="sr-only">{t('ui.platform.colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="ui-stagger">
                  {companies.data.items.map((c) => (
                    <tr key={c.tenantId} className="border-t border-line align-top">
                      <td className="py-3 pe-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            name={name(c)}
                            initials={name(c).slice(0, 2).toUpperCase()}
                            size={34}
                          />
                          <div className="min-w-0">
                            <b className="block truncate">{name(c)}</b>
                            <small className="block truncate text-ink-3" dir="ltr">
                              {c.url ? c.url.replace(/^https?:\/\//, '') : c.slug}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pe-3 text-ink-2">
                        {c.owners.length === 0
                          ? '—'
                          : c.owners.map((owner) => (
                              <span key={owner.email} className="block truncate" dir="ltr">
                                {owner.name} · {owner.email}
                              </span>
                            ))}
                      </td>
                      <td className="num py-3 pe-3 text-end">
                        {n(c.activeMembers)}
                        {c.pendingInvitations > 0 && (
                          <small className="block text-ink-3">
                            {t('ui.platform.pending', { count: c.pendingInvitations })}
                          </small>
                        )}
                      </td>
                      <td className="py-3 pe-3 text-ink-2">{date(c.lastActivityAt, true)}</td>
                      <td className="py-3 pe-3 text-ink-2">{date(c.createdAt)}</td>
                      <td className="py-3 pe-3">
                        <StatusChip
                          status={c.status === 'active' ? 'good' : 'bad'}
                          label={t(`ui.platform.${c.status}`)}
                        />
                      </td>
                      <td className="py-3 text-end">
                        <Button
                          size="sm"
                          variant={c.status === 'active' ? 'ghost' : 'primary'}
                          onClick={() => {
                            setTarget(c);
                            setReason('');
                          }}
                        >
                          {c.status === 'active'
                            ? t('ui.platform.suspend')
                            : t('ui.platform.reactivate')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('ui.platform.auditTitle')}>
          <p className="text-[13px] text-ink-3">{t('ui.platform.auditBody')}</p>
          {audit.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
          {audit.isError && (
            <ErrorState
              title={t('ui.states.errorTitle')}
              body={errorText(t, audit.error)}
              reference={errorReference(t, audit.error)}
              retryLabel={t('ui.common.retry')}
              onRetry={() => void audit.refetch()}
            />
          )}
          {audit.data?.items.length === 0 && (
            <EmptyState title={t('ui.platform.noAudit')} body={t('ui.platform.noAuditBody')} />
          )}
          <ul className="grid gap-2">
            {audit.data?.items.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-tile bg-frame px-3.5 py-2.5 text-[13px]"
              >
                <span className="font-semibold">
                  {t(
                    e.action === 'platform.company.suspended'
                      ? 'ui.platform.actionSuspended'
                      : 'ui.platform.actionReactivated',
                    {
                      company: e.company?.slug ?? '—',
                      name: e.actorName ?? '—',
                    },
                  )}
                </span>
                {typeof e.details.reason === 'string' && (
                  <span className="text-ink-2">
                    {t('ui.platform.reasonLine', { reason: e.details.reason })}
                  </span>
                )}
                <span className="ms-auto text-ink-3">{date(e.occurredAt, true)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={
          target
            ? t(
                nextStatus === 'suspended'
                  ? 'ui.platform.suspendTitle'
                  : 'ui.platform.reactivateTitle',
                { company: name(target) },
              )
            : ''
        }
        description={t(
          nextStatus === 'suspended' ? 'ui.platform.suspendBody' : 'ui.platform.reactivateBody',
        )}
        closeLabel={t('ui.common.close')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setTarget(null);
              }}
            >
              {t('ui.common.cancel')}
            </Button>
            <Button
              variant={nextStatus === 'suspended' ? 'danger' : 'primary'}
              loading={setCompanyStatus.isPending}
              disabled={reason.trim().length === 0}
              onClick={() => {
                if (target) setCompanyStatus.mutate({ company: target, status: nextStatus });
              }}
            >
              {nextStatus === 'suspended' ? t('ui.platform.suspend') : t('ui.platform.reactivate')}
            </Button>
          </>
        }
      >
        <TextArea
          label={t('ui.platform.reason')}
          hint={t('ui.platform.reasonHint')}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        <FormError error={setCompanyStatus.error} />
      </Dialog>
    </div>
  );
}
