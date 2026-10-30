import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Client,
  clientActivitySchema,
  clientDocumentListResponseSchema,
  type employeeDocumentListResponseSchema,
  clientSchema,
  contactListResponseSchema,
  contactSchema,
  fileDownloadResponseSchema,
  fileSchema,
  INTERACTION_KINDS,
  interactionListResponseSchema,
  interactionSchema,
} from '@ultimate-erp/contracts';
import { formatDate, formatNumber } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  StatusChip,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { Download, Plus, Star, Upload } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { api, isApiError } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { ClientForm, formValuesOf } from './client-form.js';
import { clientKey } from './keys.js';

/** Loading / error frame shared by the tabs. */
function Loaded<T>({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => unknown;
  };
  children: (data: T) => ReactNode;
}) {
  const { t } = useI18n();
  if (query.isPending) return <LoadingState label={t('ui.common.loading')} lines={2} />;
  if (query.isError || query.data === undefined) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, query.error)}
        reference={errorReference(t, query.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <>{children(query.data)}</>;
}

// --- Overview ----------------------------------------------------------------------------------

export function OverviewTab({ client, canUpdate }: { client: Client; canUpdate: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (values: ReturnType<typeof formValuesOf>) =>
      api(`/clients/${client.id}`, {
        method: 'PATCH',
        body: { ...values, version: client.version },
        schema: clientSchema,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(clientKey(client.id), updated);
      setEditing(false);
      toast({ tone: 'good', title: t('ui.clients.saved') });
      await queryClient.invalidateQueries({ queryKey: ['clients', 'list'] });
    },
    onError: async (err) => {
      if (isApiError(err, 'CONFLICT') && err.details.some((d) => d.path === 'version')) {
        toast({ tone: 'bad', title: t('ui.clients.staleEdit') });
        setEditing(false);
        await queryClient.invalidateQueries({ queryKey: clientKey(client.id) });
      }
    },
  });

  if (editing) {
    return (
      <Card>
        <ClientForm
          defaultValues={formValuesOf(client)}
          submitLabel={t('ui.clients.save')}
          pending={save.isPending}
          serverErrors={isApiError(save.error) ? save.error.details : undefined}
          onSubmit={(values) => {
            save.mutate(values);
          }}
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                save.reset();
              }}
            >
              {t('ui.clients.cancel')}
            </Button>
          }
        />
      </Card>
    );
  }
  const row = (label: string, value: string | null, ltr = false) => (
    <div className="grid gap-0.5">
      <dt className="text-[12px] font-semibold text-ink-3">{label}</dt>
      <dd className="text-[14px]" dir={ltr ? 'ltr' : undefined}>
        {value ?? '—'}
      </dd>
    </div>
  );
  return (
    <Card
      action={
        canUpdate ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('ui.clients.edit')}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {row(t('ui.clients.fields.legalNameEn'), client.legalName.en)}
        {row(t('ui.clients.fields.legalNameAr'), client.legalName.ar)}
        {row(t('ui.clients.fields.type'), t(`ui.clients.type.${client.type}`))}
        {row(t('ui.clients.fields.commercialRegistration'), client.commercialRegistration, true)}
        {row(t('ui.clients.fields.industry'), client.industry)}
        {row(t('ui.clients.fields.email'), client.email, true)}
        {row(t('ui.clients.fields.phone'), client.phone, true)}
        {row(t('ui.clients.fields.website'), client.website, true)}
        {row(t('ui.clients.fields.city'), client.city)}
        {row(t('ui.clients.fields.addressLine'), client.addressLine)}
        {row(t('ui.clients.fields.country'), client.country, true)}
      </dl>
    </Card>
  );
}

// --- Contacts ----------------------------------------------------------------------------------

export function ContactsTab({ clientId, canUpdate }: { clientId: string; canUpdate: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['clients', clientId, 'contacts'];
  const contacts = useQuery({
    queryKey: key,
    queryFn: () => api(`/clients/${clientId}/contacts`, { schema: contactListResponseSchema }),
  });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    position: '',
    email: '',
    phone: '',
    isPrimary: false,
    isAuthorizedRepresentative: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: () =>
      api(`/clients/${clientId}/contacts`, { method: 'POST', body: draft, schema: contactSchema }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.clients.contacts.added') });
      setOpen(false);
      setDraft({
        name: '',
        position: '',
        email: '',
        phone: '',
        isPrimary: false,
        isAuthorizedRepresentative: false,
      });
      await refresh();
    },
  });
  const change = useMutation({
    mutationFn: ({ id, archive }: { id: string; archive?: boolean }) =>
      archive
        ? api(`/clients/${clientId}/contacts/${id}/archive`, {
            method: 'POST',
            schema: contactSchema,
          })
        : api(`/clients/${clientId}/contacts/${id}`, {
            method: 'PATCH',
            body: { isPrimary: true },
            schema: contactSchema,
          }),
    onSettled: refresh,
    onError: (err) => {
      toast({ tone: 'bad', title: errorText(t, err) });
    },
  });

  return (
    <Card
      action={
        canUpdate ? (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) add.reset();
            }}
            trigger={
              <Button size="sm" icon={<Plus aria-hidden className="size-4" />}>
                {t('ui.clients.contacts.add')}
              </Button>
            }
            title={t('ui.clients.contacts.add')}
            closeLabel={t('ui.common.close')}
          >
            <form
              noValidate
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <TextField
                label={t('ui.clients.contacts.name')}
                value={draft.name}
                onChange={(e) => {
                  setDraft({ ...draft, name: e.target.value });
                }}
              />
              <TextField
                label={t('ui.clients.contacts.position')}
                value={draft.position}
                onChange={(e) => {
                  setDraft({ ...draft, position: e.target.value });
                }}
              />
              <TextField
                label={t('ui.clients.contacts.email')}
                type="email"
                dir="ltr"
                value={draft.email}
                onChange={(e) => {
                  setDraft({ ...draft, email: e.target.value });
                }}
              />
              <TextField
                label={t('ui.clients.contacts.phone')}
                type="tel"
                dir="ltr"
                value={draft.phone}
                onChange={(e) => {
                  setDraft({ ...draft, phone: e.target.value });
                }}
              />
              <Checkbox
                label={t('ui.clients.contacts.primary')}
                checked={draft.isPrimary}
                onCheckedChange={(v) => {
                  setDraft({ ...draft, isPrimary: v });
                }}
              />
              <Checkbox
                label={t('ui.clients.contacts.representative')}
                checked={draft.isAuthorizedRepresentative}
                onCheckedChange={(v) => {
                  setDraft({ ...draft, isAuthorizedRepresentative: v });
                }}
              />
              <FormError error={add.error} />
              <Button type="submit" loading={add.isPending} disabled={!draft.name.trim()}>
                {t('ui.clients.contacts.add')}
              </Button>
            </form>
          </Dialog>
        ) : undefined
      }
    >
      <Loaded query={contacts}>
        {(data) => {
          const active = data.items.filter((c) => !c.archived);
          if (active.length === 0)
            return (
              <EmptyState title={t('ui.clients.contacts.none')} body={t('ui.states.emptyBody')} />
            );
          return (
            <ul className="grid gap-2">
              {active.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
                >
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <b className="flex flex-wrap items-center gap-2">
                      {c.name}
                      {c.isPrimary && (
                        <StatusChip status="good" label={t('ui.clients.contacts.primary')} />
                      )}
                      {c.isAuthorizedRepresentative && (
                        <StatusChip status="info" label={t('ui.clients.contacts.representative')} />
                      )}
                    </b>
                    <small className="text-ink-2">
                      {[c.position, c.email, c.phone].filter(Boolean).join(' · ') || '—'}
                    </small>
                  </div>
                  {canUpdate && (
                    <div className="flex gap-1.5">
                      {!c.isPrimary && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Star aria-hidden className="size-4" />}
                          onClick={() => {
                            change.mutate({ id: c.id });
                          }}
                        >
                          {t('ui.clients.contacts.makePrimary')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          change.mutate({ id: c.id, archive: true });
                        }}
                      >
                        {t('ui.clients.contacts.archive')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
    </Card>
  );
}

// --- Communication history ----------------------------------------------------------------------

const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function CommunicationTab({
  clientId,
  canUpdate,
}: {
  clientId: string;
  canUpdate: boolean;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['clients', clientId, 'interactions'];
  const history = useQuery({
    queryKey: key,
    queryFn: () =>
      api(`/clients/${clientId}/interactions`, { schema: interactionListResponseSchema }),
  });
  const contacts = useQuery({
    queryKey: ['clients', clientId, 'contacts'],
    enabled: canUpdate,
    queryFn: () => api(`/clients/${clientId}/contacts`, { schema: contactListResponseSchema }),
  });
  const [kind, setKind] = useState<(typeof INTERACTION_KINDS)[number]>('call');
  const [when, setWhen] = useState(localNow);
  const [contactId, setContactId] = useState('none');
  const [summary, setSummary] = useState('');
  const log = useMutation({
    mutationFn: () =>
      api(`/clients/${clientId}/interactions`, {
        method: 'POST',
        body: {
          kind,
          occurredAt: new Date(when).toISOString(),
          summary,
          contactId: contactId === 'none' ? null : contactId,
        },
        schema: interactionSchema,
      }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.clients.interactions.logged') });
      setSummary('');
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <div className="grid gap-4">
      {canUpdate && (
        <Card>
          <form
            noValidate
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              log.mutate();
            }}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <SelectField
                label={t('ui.clients.interactions.kind')}
                placeholder={t('ui.clients.interactions.kind')}
                value={kind}
                onValueChange={(v) => {
                  setKind(v as typeof kind);
                }}
                options={INTERACTION_KINDS.map((k) => ({
                  value: k,
                  label: t(`ui.clients.interactions.kinds.${k}`),
                }))}
              />
              <TextField
                label={t('ui.clients.interactions.when')}
                type="datetime-local"
                value={when}
                onChange={(e) => {
                  setWhen(e.target.value);
                }}
              />
              <SelectField
                label={t('ui.clients.interactions.contact')}
                placeholder={t('ui.clients.interactions.noContact')}
                value={contactId}
                onValueChange={setContactId}
                options={[
                  { value: 'none', label: t('ui.clients.interactions.noContact') },
                  ...(contacts.data?.items
                    .filter((c) => !c.archived)
                    .map((c) => ({ value: c.id, label: c.name })) ?? []),
                ]}
              />
            </div>
            <TextArea
              label={t('ui.clients.interactions.summary')}
              value={summary}
              maxLength={4000}
              rows={3}
              onChange={(e) => {
                setSummary(e.target.value);
              }}
            />
            <FormError error={log.error} />
            <Button
              type="submit"
              className="w-fit"
              loading={log.isPending}
              disabled={!summary.trim() || !when}
            >
              {t('ui.clients.interactions.log')}
            </Button>
          </form>
        </Card>
      )}
      <Card>
        <Loaded query={history}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState
                title={t('ui.clients.interactions.none')}
                body={t('ui.states.emptyBody')}
              />
            ) : (
              <ol className="grid gap-3">
                {data.items.map((i) => (
                  <li key={i.id} className="grid gap-1 border-s-2 border-lilac ps-3">
                    <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                      <b className="text-ink-2">{t(`ui.clients.interactions.kinds.${i.kind}`)}</b>
                      {i.contact && <span>· {i.contact.name}</span>}
                      <span>
                        ·{' '}
                        {formatDate(locale, new Date(i.occurredAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                      {i.authorName && (
                        <span>· {t('ui.clients.interactions.by', { name: i.authorName })}</span>
                      )}
                    </span>
                    <p className="text-[14px] whitespace-pre-wrap">{i.summary}</p>
                  </li>
                ))}
              </ol>
            )
          }
        </Loaded>
      </Card>
    </div>
  );
}

// --- Documents ---------------------------------------------------------------------------------

const DOC_STATUS = {
  pending: 'info',
  clean: 'good',
  infected: 'bad',
  scan_failed: 'warn',
} as const;

/** Attached documents of a client or project; `basePath` is e.g. `/clients/<id>`. */
export function DocumentsTab({
  basePath,
  canUpdate,
  schema = clientDocumentListResponseSchema,
}: {
  basePath: string;
  canUpdate: boolean;
  /** Employee documents carry a category and a confidential flag as well. */
  schema?: typeof clientDocumentListResponseSchema | typeof employeeDocumentListResponseSchema;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = [basePath, 'documents'];
  const documents = useQuery({
    queryKey: key,
    queryFn: () => api(`${basePath}/documents`, { schema }),
    // While a file is being scanned, check again every few seconds.
    refetchInterval: (q) =>
      q.state.data?.items.some((d) => d.file.status === 'pending') ? 3000 : false,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await api('/files', { method: 'POST', body: form, schema: fileSchema });
      return api(`${basePath}/documents`, {
        method: 'POST',
        body: { fileId: uploaded.id },
        schema,
      });
    },
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.clients.documents.attached') });
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onSettled: () => {
      if (input.current) input.current.value = '';
    },
  });
  const download = useMutation({
    mutationFn: (fileId: string) =>
      api(`${basePath}/documents/${fileId}/download`, {
        method: 'POST',
        schema: fileDownloadResponseSchema,
      }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (err) => {
      toast({ tone: 'bad', title: errorText(t, err) });
    },
  });
  const detach = useMutation({
    mutationFn: (fileId: string) => api(`${basePath}/documents/${fileId}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Card
      action={
        canUpdate ? (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              id={`upload-${basePath.replace(/W/g, '-')}`}
              aria-label={t('ui.clients.documents.upload')}
              tabIndex={-1}
              accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.csv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
            <Button
              size="sm"
              icon={<Upload aria-hidden className="size-4" />}
              loading={upload.isPending}
              onClick={() => input.current?.click()}
            >
              {t('ui.clients.documents.upload')}
            </Button>
          </>
        ) : undefined
      }
    >
      {canUpdate && <small className="text-ink-3">{t('ui.clients.documents.uploadHint')}</small>}
      <FormError error={upload.error} />
      <Loaded query={documents}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title={t('ui.clients.documents.none')} body={t('ui.states.emptyBody')} />
          ) : (
            <ul className="grid gap-2">
              {data.items.map(({ file, addedAt, addedByName }) => (
                <li
                  key={file.id}
                  className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
                >
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <b className="truncate">{file.name}</b>
                    <small className="text-ink-3">
                      {formatNumber(locale, Math.max(1, Math.round(file.sizeBytes / 1024)))} KB ·{' '}
                      {formatDate(locale, new Date(addedAt), { dateStyle: 'medium' })}
                      {addedByName ? ` · ${addedByName}` : ''}
                    </small>
                  </div>
                  <StatusChip
                    status={DOC_STATUS[file.status]}
                    label={t(`ui.clients.documents.status.${file.status}`)}
                  />
                  {file.status === 'clean' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Download aria-hidden className="size-4" />}
                      loading={download.isPending && download.variables === file.id}
                      onClick={() => {
                        download.mutate(file.id);
                      }}
                    >
                      {t('ui.clients.documents.download')}
                    </Button>
                  )}
                  {canUpdate && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        detach.mutate(file.id);
                      }}
                    >
                      {t('ui.clients.documents.detach')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Card>
  );
}

// --- Activity ----------------------------------------------------------------------------------

export function ActivityTab({ clientId }: { clientId: string }) {
  const { t, locale } = useI18n();
  const activity = useQuery({
    queryKey: ['clients', clientId, 'activity'],
    queryFn: () => api(`/clients/${clientId}/activity`, { schema: clientActivitySchema }),
  });
  return (
    <Card>
      <Loaded query={activity}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title={t('ui.clients.activity.none')} body={t('ui.states.emptyBody')} />
          ) : (
            <ol className="grid gap-3">
              {data.items.map((item) => (
                <li key={item.id} className="grid gap-0.5 border-s-2 border-lilac ps-3">
                  <span className="text-[13.5px]">
                    {t(
                      `ui.clients.activity.text.${item.action.replace(/\./g, '_') as 'clients_client_created'}`,
                      {
                        actor: item.actorName ?? t('ui.dashboard.system'),
                      },
                    )}
                  </span>
                  {item.fields.length > 0 && (
                    <small className="text-ink-2">
                      {t('ui.clients.activity.fields', {
                        fields: item.fields
                          .map((f) =>
                            f in FIELD_KEYS
                              ? t(`ui.clients.fields.${FIELD_KEYS[f as keyof typeof FIELD_KEYS]}`)
                              : f,
                          )
                          .join('، '),
                      })}
                    </small>
                  )}
                  <small className="text-ink-3">
                    {formatDate(locale, new Date(item.occurredAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </small>
                </li>
              ))}
            </ol>
          )
        }
      </Loaded>
    </Card>
  );
}

/** Changed field names from the API → catalog keys. */
const FIELD_KEYS = {
  legalNameEn: 'legalNameEn',
  legalNameAr: 'legalNameAr',
  type: 'type',
  status: 'status',
  commercialRegistration: 'commercialRegistration',
  industry: 'industry',
  email: 'email',
  phone: 'phone',
  website: 'website',
  addressLine: 'addressLine',
  city: 'city',
  country: 'country',
} as const;
