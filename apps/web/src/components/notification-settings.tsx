import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationPreferencesResponseSchema } from '@ultimate-erp/contracts';
import { Card, Checkbox, LoadingState, useToast } from '@ultimate-erp/ui';
import { useI18n } from '../app/i18n.js';
import { api } from '../lib/api.js';
import { FormError } from './auth-layout.js';

/** My notification choices in this company: in the app, and an email copy. */
export function NotificationSettingsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['notifications', 'preferences'];
  const prefs = useQuery({
    queryKey: key,
    queryFn: () =>
      api('/notifications/preferences', { schema: notificationPreferencesResponseSchema }),
  });
  const save = useMutation({
    mutationFn: (item: { type: string; inApp: boolean; email: boolean }) =>
      api('/notifications/preferences', {
        method: 'PUT',
        body: { items: [item] },
        schema: notificationPreferencesResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      toast({ tone: 'good', title: t('ui.notifications.saved') });
    },
  });
  return (
    <Card title={t('ui.notifications.preferencesTitle')}>
      <small className="text-ink-3">{t('ui.notifications.preferencesHint')}</small>
      {prefs.isPending && <LoadingState label={t('ui.common.loading')} lines={3} />}
      {prefs.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="text-[12px] text-ink-3">
              <tr>
                <th scope="col" className="py-2 text-start font-semibold">
                  {t('ui.notifications.colType')}
                </th>
                <th scope="col" className="py-2 text-start font-semibold">
                  {t('ui.notifications.colInApp')}
                </th>
                <th scope="col" className="py-2 text-start font-semibold">
                  {t('ui.notifications.colEmail')}
                </th>
              </tr>
            </thead>
            <tbody>
              {prefs.data.items.map((p) => {
                const label = t(
                  `ui.notifications.typeLabel.${p.type.replace('.', '_') as 'tasks_assigned'}`,
                );
                return (
                  <tr key={p.type} className="border-t border-line">
                    <td className="py-2">{label}</td>
                    <td className="py-2">
                      {p.mandatory ? (
                        <small className="text-ink-3">{t('ui.notifications.always')}</small>
                      ) : (
                        <Checkbox
                          label={`${t('ui.notifications.colInApp')}: ${label}`}
                          hideLabel
                          checked={p.inApp}
                          onCheckedChange={(on) => {
                            save.mutate({ type: p.type, inApp: on, email: p.email });
                          }}
                        />
                      )}
                    </td>
                    <td className="py-2">
                      <Checkbox
                        label={`${t('ui.notifications.colEmail')}: ${label}`}
                        hideLabel
                        checked={p.email}
                        onCheckedChange={(on) => {
                          save.mutate({ type: p.type, inApp: p.inApp, email: on });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <FormError error={save.error} />
    </Card>
  );
}
