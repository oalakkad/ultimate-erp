import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { clientSchema, POSSIBLE_DUPLICATE } from '@ultimate-erp/contracts';
import { Button, Card, useToast } from '@ultimate-erp/ui';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api, isApiError } from '../../lib/api.js';
import { ClientForm, type ClientFormValues } from './client-form.js';

/** New client (docs/modules/clients.md §7.1): duplicate CR refused, similar name confirmed. */
export function NewClientPage() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingDuplicate, setPendingDuplicate] = useState<ClientFormValues | null>(null);
  const create = useMutation({
    mutationFn: (values: ClientFormValues) =>
      api('/clients', { method: 'POST', body: values, schema: clientSchema }),
    onSuccess: async (client) => {
      toast({ tone: 'good', title: t('ui.clients.created', { number: client.number }) });
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await navigate({ to: '/clients/$clientId', params: { clientId: client.id } });
    },
    onError: (err, values) => {
      if (isApiError(err, 'CONFLICT') && err.details.some((d) => d.code === POSSIBLE_DUPLICATE)) {
        setPendingDuplicate(values);
      }
    },
  });
  const duplicate =
    isApiError(create.error, 'CONFLICT') &&
    create.error.details.some((d) => d.code === POSSIBLE_DUPLICATE);

  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.clients.new')} />
      <Card>
        {duplicate && pendingDuplicate && (
          <div
            role="alert"
            className="flex flex-wrap items-start gap-3 rounded-tile bg-butter p-3.5 text-butter-ink"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-[18px] shrink-0" />
            <div className="grid flex-1 gap-1">
              <b>{t('ui.clients.duplicateTitle')}</b>
              <span className="text-[13.5px]">{t('ui.clients.duplicateBody')}</span>
            </div>
            <Button
              variant="secondary"
              loading={create.isPending}
              onClick={() => {
                create.mutate({ ...pendingDuplicate, confirmDuplicate: true });
              }}
            >
              {t('ui.clients.createAnyway')}
            </Button>
          </div>
        )}
        <ClientForm
          defaultValues={{
            legalNameEn: '',
            legalNameAr: '',
            type: 'company',
            status: 'prospect',
            country: 'KW',
          }}
          submitLabel={t('ui.clients.create')}
          pending={create.isPending}
          serverErrors={isApiError(create.error) ? create.error.details : undefined}
          onSubmit={(values) => {
            create.mutate(values);
          }}
        />
        {!duplicate && !isApiError(create.error, 'CONFLICT') && <FormError error={create.error} />}
      </Card>
    </div>
  );
}
