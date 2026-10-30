import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { type Client, clientSchema } from '@ultimate-erp/contracts';
import { Button, ErrorState, LoadingState, StatusChip, Tabs, useToast } from '@ultimate-erp/ui';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useI18n } from '../../app/i18n.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { clientKey } from './keys.js';
import { STATUS_CHIP } from './list.js';
import { ClientContractsTab } from '../contracts/client-tab.js';
import { ActivityTab, CommunicationTab, ContactsTab, DocumentsTab, OverviewTab } from './tabs.js';

/** Client detail with tabs (brief Module B). Tabs for contracts, projects and invoices arrive with those modules. */
export function ClientDetailPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { clientId } = useParams({ from: '/app/clients/$clientId' });
  const access = useAccess(true);
  const client = useQuery({
    queryKey: clientKey(clientId),
    queryFn: () => api(`/clients/${clientId}`, { schema: clientSchema }),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api(`/clients/${clientId}/${archived ? 'archive' : 'restore'}`, {
        method: 'POST',
        schema: clientSchema,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(clientKey(clientId), updated);
      toast({
        tone: 'good',
        title: updated.archived ? t('ui.clients.archived') : t('ui.clients.restored'),
      });
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => {
      toast({ tone: 'bad', title: errorText(t, err) });
    },
  });

  if (client.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (client.isError) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, client.error)}
        reference={errorReference(t, client.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void client.refetch()}
      />
    );
  }
  const c: Client = client.data;
  const canUpdate = can(access.data, 'clients.client.update') && !c.archived;
  const name = locale === 'ar' ? c.legalName.ar : c.legalName.en;

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={name}
        actions={
          can(access.data, 'clients.client.archive') ? (
            <Button
              variant="secondary"
              icon={
                c.archived ? (
                  <ArchiveRestore aria-hidden className="size-4" />
                ) : (
                  <Archive aria-hidden className="size-4" />
                )
              }
              loading={archive.isPending}
              onClick={() => {
                archive.mutate(!c.archived);
              }}
            >
              {c.archived ? t('ui.clients.restore') : t('ui.clients.archive')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span dir="ltr" className="tabular-nums">
          {c.number}
        </span>
        <span aria-hidden>·</span>
        <span>{locale === 'ar' ? c.legalName.en : c.legalName.ar}</span>
        <StatusChip status={STATUS_CHIP[c.status]} label={t(`ui.clients.status.${c.status}`)} />
        {c.archived && <StatusChip status="bad" label={t('ui.clients.archivedBadge')} />}
      </div>
      {c.archived && (
        <p role="status" className="rounded-tile bg-frame p-3 text-[13.5px] text-ink-2">
          {t('ui.clients.archivedNotice')}
        </p>
      )}
      <Tabs
        label={name}
        items={[
          {
            value: 'overview',
            label: t('ui.clients.tabs.overview'),
            content: <OverviewTab client={c} canUpdate={canUpdate} />,
          },
          {
            value: 'contacts',
            label: t('ui.clients.tabs.contacts'),
            content: <ContactsTab clientId={c.id} canUpdate={canUpdate} />,
          },
          {
            value: 'communication',
            label: t('ui.clients.tabs.communication'),
            content: <CommunicationTab clientId={c.id} canUpdate={canUpdate} />,
          },
          {
            value: 'documents',
            label: t('ui.clients.tabs.documents'),
            content: <DocumentsTab clientId={c.id} canUpdate={canUpdate} />,
          },
          ...(can(access.data, 'contracts.contract.read')
            ? [
                {
                  value: 'contracts',
                  label: t('ui.contracts.clientTab'),
                  content: (
                    <ClientContractsTab
                      clientId={c.id}
                      canCreate={can(access.data, 'contracts.contract.manage') && !c.archived}
                    />
                  ),
                },
              ]
            : []),
          {
            value: 'activity',
            label: t('ui.clients.tabs.activity'),
            content: <ActivityTab clientId={c.id} />,
          },
        ]}
      />
    </div>
  );
}
