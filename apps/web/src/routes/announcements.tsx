import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  announcementListResponseSchema,
  announcementPreviewSchema,
  announcementSchema,
  type Role,
  ROLES,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  LoadingState,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { FormError } from '../components/auth-layout.js';
import { AppPageHeader } from '../components/page-header.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { can, useAccess } from '../lib/session.js';

/** Company announcements: everyone reads; publishers write, after confirming the recipient count. */
export function AnnouncementsPage() {
  const { t, locale } = useI18n();
  const access = useAccess(true);
  const list = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api('/announcements', { schema: announcementListResponseSchema }),
  });
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.announcements.title')} />
      {can(access.data, 'announcements.publish') && <PublishCard />}
      <Card>
        {list.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
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
          <EmptyState title={t('ui.announcements.empty')} body={t('ui.announcements.emptyBody')} />
        )}
        <ul className="grid gap-3">
          {list.data?.items.map((a) => (
            <li key={a.id} className="grid gap-1.5 rounded-tile bg-frame p-4">
              <h2 className="text-[15px] font-bold">{locale === 'ar' ? a.title.ar : a.title.en}</h2>
              <p className="whitespace-pre-line text-[13.5px]">
                {locale === 'ar' ? a.body.ar : a.body.en}
              </p>
              <small className="text-ink-3">
                {t('ui.announcements.by', {
                  name: a.publishedByName ?? '',
                  date: formatDate(locale, new Date(a.publishedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })}
                {' · '}
                {a.roles.length === 0
                  ? t('ui.announcements.toEveryone')
                  : t('ui.announcements.toRoles', {
                      roles: a.roles.map((r) => t(`roles.${r}`)).join('، '),
                    })}
              </small>
              {a.delivery && (
                <small className="text-ink-3">{t('ui.announcements.delivery', a.delivery)}</small>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PublishCard() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });
  const [roles, setRoles] = useState<Role[]>([]);
  const [email, setEmail] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
  };
  const preview = useMutation({
    mutationFn: () =>
      api('/announcements/preview', {
        method: 'POST',
        body: { roles },
        schema: announcementPreviewSchema,
      }),
    onSuccess: (data) => {
      setCount(data.recipients);
    },
  });
  const publish = useMutation({
    mutationFn: () =>
      api('/announcements', {
        method: 'POST',
        body: { ...form, roles, email, confirmRecipients: count ?? 0 },
        schema: announcementSchema,
      }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.announcements.published') });
      setForm({ titleEn: '', titleAr: '', bodyEn: '', bodyAr: '' });
      setCount(null);
      await queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
  const filled = Object.values(form).every((v) => v.trim());
  return (
    <Card title={t('ui.announcements.newTitle')}>
      <small className="text-ink-3">{t('ui.announcements.safety')}</small>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField
          label={t('ui.announcements.titleEn')}
          dir="ltr"
          lang="en"
          value={form.titleEn}
          onChange={set('titleEn')}
        />
        <TextField
          label={t('ui.announcements.titleAr')}
          dir="rtl"
          lang="ar"
          value={form.titleAr}
          onChange={set('titleAr')}
        />
        <TextArea
          label={t('ui.announcements.bodyEn')}
          dir="ltr"
          lang="en"
          rows={4}
          value={form.bodyEn}
          onChange={set('bodyEn')}
        />
        <TextArea
          label={t('ui.announcements.bodyAr')}
          dir="rtl"
          lang="ar"
          rows={4}
          value={form.bodyAr}
          onChange={set('bodyAr')}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-semibold">{t('ui.announcements.audience')}</legend>
        <small className="text-ink-3">{t('ui.announcements.everyone')}</small>
        <div className="flex flex-wrap gap-3">
          {ROLES.map((r) => (
            <Checkbox
              key={r}
              label={t(`roles.${r}`)}
              checked={roles.includes(r)}
              onCheckedChange={(on) => {
                setRoles(on ? [...roles, r] : roles.filter((x) => x !== r));
                setCount(null);
              }}
            />
          ))}
        </div>
      </fieldset>
      <Checkbox label={t('ui.announcements.email')} checked={email} onCheckedChange={setEmail} />
      {count === null ? (
        <Button
          variant="secondary"
          className="w-fit"
          loading={preview.isPending}
          disabled={!filled}
          onClick={() => {
            preview.mutate();
          }}
        >
          {t('ui.announcements.checkRecipients')}
        </Button>
      ) : (
        <div className="grid gap-2">
          <p role="status" className="text-[13.5px] font-semibold">
            {t('ui.announcements.willReach', { count })}
          </p>
          <Button
            className="w-fit"
            loading={publish.isPending}
            disabled={!filled || count === 0}
            onClick={() => {
              publish.mutate();
            }}
          >
            {t('ui.announcements.publish', { count })}
          </Button>
        </div>
      )}
      <FormError error={preview.error ?? publish.error} />
    </Card>
  );
}
