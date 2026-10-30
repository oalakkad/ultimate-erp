import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import {
  type Contract,
  type ContractAction,
  contractSchema,
  contractVersionListResponseSchema,
  fileDownloadResponseSchema,
  fileSchema,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  LoadingState,
  TextArea,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { Download, Printer } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { ContractStatusChip, contractKey, dateText, kindLabel, moneyText } from './shared.js';

type Transition = Exclude<ContractAction, 'edit'>;
const ORDER: Transition[] = [
  'submit',
  'approve',
  'reject',
  'send',
  'sign',
  'activate',
  'terminate',
];
const NEEDS_REASON: Transition[] = ['reject', 'terminate'];

/** One contract: workflow, terms, text with versions (docs/modules/contracts.md §4). */
export function ContractDetailPage() {
  const { t, locale } = useI18n();
  const { contractId } = useParams({ from: '/app/contracts/$contractId' });
  const contract = useQuery({
    queryKey: contractKey(contractId),
    queryFn: () => api(`/contracts/${contractId}`, { schema: contractSchema }),
  });

  if (contract.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (contract.isError) {
    return (
      <ErrorState
        title={t('ui.states.errorTitle')}
        body={errorText(t, contract.error)}
        reference={errorReference(t, contract.error)}
        retryLabel={t('ui.common.retry')}
        onRetry={() => void contract.refetch()}
      />
    );
  }
  const c = contract.data;
  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={locale === 'ar' ? c.title.ar : c.title.en}
        actions={
          <a
            href={`/contracts/${c.id}/print`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center gap-2 rounded-ctl bg-card px-4 text-[13.5px] font-semibold shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame"
          >
            <Printer aria-hidden className="size-4" />
            {t('ui.contracts.print')}
          </a>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span dir="ltr" className="tabular-nums">
          {c.number}
        </span>
        <span aria-hidden>·</span>
        <span>{kindLabel(t, c.kind)}</span>
        <span aria-hidden>·</span>
        <Link
          to="/clients/$clientId"
          params={{ clientId: c.client.id }}
          className="font-semibold text-plum hover:underline"
        >
          {locale === 'ar' ? c.client.name.ar : c.client.name.en}
        </Link>
        <ContractStatusChip status={c.status} />
      </div>
      {c.status === 'draft' && c.reviewNote && (
        <p role="status" className="rounded-tile bg-butter p-3 text-[13.5px] text-butter-ink">
          {t('ui.contracts.reviewNote', { note: c.reviewNote })}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <TermsCard contract={c} />
          <TextCard contract={c} />
        </div>
        <WorkflowCard contract={c} />
      </div>
    </div>
  );
}

function WorkflowCard({ contract: c }: { contract: Contract }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Transition | null>(null);
  const [reason, setReason] = useState('');
  const [signedOn, setSignedOn] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const run = useMutation({
    mutationFn: async (action: Transition) => {
      let body: object = {};
      if (NEEDS_REASON.includes(action)) body = { reason };
      if (action === 'sign') {
        const file = fileInput.current?.files?.[0];
        if (!file) throw new Error('no file');
        const form = new FormData();
        form.append('file', file);
        const uploaded = await api('/files', { method: 'POST', body: form, schema: fileSchema });
        body = { fileId: uploaded.id, ...(signedOn ? { signedOn } : {}) };
      }
      return api(`/contracts/${c.id}/${action}`, { method: 'POST', body, schema: contractSchema });
    },
    onSuccess: async (updated, action) => {
      queryClient.setQueryData(contractKey(c.id), updated);
      toast({ tone: 'good', title: t(`ui.contracts.done.${action}`) });
      setDialog(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['contracts', 'list'] });
    },
  });
  const download = useMutation({
    mutationFn: () =>
      api(`/contracts/${c.id}/signed-copy/download`, {
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
  const at = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-KW') : '';
  const available = ORDER.filter((a) => c.actions.includes(a));
  const timeline = [
    c.submittedBy && t('ui.contracts.timeline.submitted', { name: c.submittedBy.name }),
    c.approvedBy && t('ui.contracts.timeline.approved', { name: c.approvedBy.name }),
    c.sentAt && t('ui.contracts.timeline.sent', { date: at(c.sentAt) }),
    c.signedAt && t('ui.contracts.timeline.signed', { date: at(c.signedAt) }),
    c.activatedAt && t('ui.contracts.timeline.activated', { date: at(c.activatedAt) }),
    c.terminatedAt &&
      t('ui.contracts.timeline.terminated', {
        date: at(c.terminatedAt),
        reason: c.terminationReason ?? '',
      }),
  ].filter((line): line is string => Boolean(line));

  return (
    <Card title={t('ui.contracts.workflow')}>
      {timeline.length > 0 && (
        <ol className="grid gap-1.5 border-s-2 border-lilac ps-3 text-[13px] text-ink-2">
          {timeline.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
      {c.signedFile && (
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          icon={<Download aria-hidden className="size-4" />}
          loading={download.isPending}
          disabled={c.signedFile.status !== 'clean'}
          onClick={() => {
            download.mutate();
          }}
        >
          {t('ui.contracts.downloadSigned')}
        </Button>
      )}
      <div className="grid gap-2">
        {available.map((action) =>
          NEEDS_REASON.includes(action) || action === 'sign' ? (
            <Button
              key={action}
              variant={action === 'terminate' || action === 'reject' ? 'secondary' : 'primary'}
              onClick={() => {
                run.reset();
                setDialog(action);
              }}
            >
              {t(`ui.contracts.actions.${action}`)}
            </Button>
          ) : (
            <Button
              key={action}
              loading={run.isPending && run.variables === action}
              onClick={() => {
                run.mutate(action);
              }}
            >
              {t(`ui.contracts.actions.${action}`)}
            </Button>
          ),
        )}
      </div>
      {!dialog && <FormError error={run.error} />}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={dialog ? t(`ui.contracts.actions.${dialog}`) : ''}
        description={dialog === 'sign' ? t('ui.contracts.signedCopyHint') : undefined}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (dialog) run.mutate(dialog);
          }}
        >
          {dialog && NEEDS_REASON.includes(dialog) && (
            <TextArea
              label={t('ui.contracts.reason')}
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          )}
          {dialog === 'sign' && (
            <>
              <label className="grid gap-1.5 text-[13px] font-semibold">
                {t('ui.contracts.signedCopy')}
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="text-[13px] font-normal"
                />
              </label>
              <TextField
                label={t('ui.contracts.signedOn')}
                type="date"
                value={signedOn}
                onChange={(e) => {
                  setSignedOn(e.target.value);
                }}
              />
            </>
          )}
          <FormError error={run.error} />
          <Button
            type="submit"
            loading={run.isPending}
            disabled={Boolean(dialog && NEEDS_REASON.includes(dialog) && !reason.trim())}
          >
            {dialog ? t(`ui.contracts.actions.${dialog}`) : ''}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}

function TermsCard({ contract: c }: { contract: Contract }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    startDate: c.startDate ?? '',
    endDate: c.endDate ?? '',
    valueAmount: c.valueAmount ?? '',
    paymentTerms: c.paymentTerms ?? '',
    renewalNoticeDays: String(c.renewalNoticeDays),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/contracts/${c.id}`, {
        method: 'PATCH',
        body: {
          version: c.version,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          valueAmount: form.valueAmount.trim() || null,
          paymentTerms: form.paymentTerms,
          renewalNoticeDays: Number(form.renewalNoticeDays || '30'),
        },
        schema: contractSchema,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(contractKey(c.id), updated);
      setEditing(false);
      toast({ tone: 'good', title: t('ui.contracts.saved') });
    },
  });
  const row = (label: string, value: string, span = '') => (
    <div className={`grid gap-0.5 ${span}`}>
      <dt className="text-[12px] font-semibold text-ink-3">{label}</dt>
      <dd className="text-[14px]">{value || '—'}</dd>
    </div>
  );
  if (editing) {
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
              label={t('ui.contracts.fields.startDate')}
              type="date"
              value={form.startDate}
              onChange={(e) => {
                setForm({ ...form, startDate: e.target.value });
              }}
            />
            <TextField
              label={t('ui.contracts.fields.endDate')}
              type="date"
              value={form.endDate}
              onChange={(e) => {
                setForm({ ...form, endDate: e.target.value });
              }}
            />
            <TextField
              label={t('ui.contracts.fields.valueAmount')}
              inputMode="decimal"
              dir="ltr"
              value={form.valueAmount}
              onChange={(e) => {
                setForm({ ...form, valueAmount: e.target.value });
              }}
            />
            <TextField
              label={t('ui.contracts.fields.renewalNoticeDays')}
              type="number"
              min={0}
              max={365}
              value={form.renewalNoticeDays}
              onChange={(e) => {
                setForm({ ...form, renewalNoticeDays: e.target.value });
              }}
            />
          </div>
          <TextArea
            label={t('ui.contracts.fields.paymentTerms')}
            rows={3}
            value={form.paymentTerms}
            onChange={(e) => {
              setForm({ ...form, paymentTerms: e.target.value });
            }}
          />
          <FormError error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              {t('ui.contracts.save')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
              }}
            >
              {t('ui.contracts.cancel')}
            </Button>
          </div>
        </form>
      </Card>
    );
  }
  return (
    <Card
      action={
        c.actions.includes('edit') ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('ui.contracts.edit')}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {row(t('ui.contracts.fields.startDate'), dateText(locale, c.startDate))}
        {row(t('ui.contracts.fields.endDate'), dateText(locale, c.endDate))}
        {row(t('ui.contracts.fields.valueAmount'), moneyText(locale, c))}
        {row(t('ui.contracts.fields.renewalNoticeDays'), String(c.renewalNoticeDays))}
        {row(t('ui.contracts.fields.paymentTerms'), c.paymentTerms ?? '', 'sm:col-span-2')}
      </dl>
    </Card>
  );
}

function TextCard({ contract: c }: { contract: Contract }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ['contracts', c.id, 'versions', c.currentVersion],
    queryFn: () =>
      api(`/contracts/${c.id}/versions`, { schema: contractVersionListResponseSchema }),
  });
  const latest = versions.data?.items[0];
  const [draft, setDraft] = useState<{ bodyEn: string; bodyAr: string; changeNote: string } | null>(
    null,
  );
  const editable = c.actions.includes('edit');
  const save = useMutation({
    mutationFn: () =>
      api(`/contracts/${c.id}/versions`, {
        method: 'POST',
        body: draft ?? {},
        schema: contractSchema,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(contractKey(c.id), updated);
      toast({ tone: 'good', title: t('ui.contracts.versionSaved', { n: updated.currentVersion }) });
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['contracts', c.id, 'versions'] });
    },
  });

  if (versions.isPending)
    return (
      <Card title={t('ui.contracts.text')}>
        <LoadingState label={t('ui.common.loading')} lines={3} />
      </Card>
    );
  const current = draft ?? {
    bodyEn: latest?.bodyEn ?? '',
    bodyAr: latest?.bodyAr ?? '',
    changeNote: '',
  };
  return (
    <Card title={t('ui.contracts.text')}>
      {!latest && !editable && (
        <p className="text-[13.5px] text-ink-2">{t('ui.contracts.noText')}</p>
      )}
      {editable ? (
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!latest && <p className="text-[13.5px] text-ink-2">{t('ui.contracts.noText')}</p>}
          <TextArea
            label={t('ui.contracts.textEn')}
            dir="ltr"
            lang="en"
            rows={8}
            value={current.bodyEn}
            onChange={(e) => {
              setDraft({ ...current, bodyEn: e.target.value });
            }}
          />
          <TextArea
            label={t('ui.contracts.textAr')}
            dir="rtl"
            lang="ar"
            rows={8}
            value={current.bodyAr}
            onChange={(e) => {
              setDraft({ ...current, bodyAr: e.target.value });
            }}
          />
          <TextField
            label={t('ui.contracts.changeNote')}
            value={current.changeNote}
            onChange={(e) => {
              setDraft({ ...current, changeNote: e.target.value });
            }}
          />
          <FormError error={save.error} />
          <Button
            type="submit"
            className="w-fit"
            loading={save.isPending}
            disabled={!draft || (!draft.bodyEn.trim() && !draft.bodyAr.trim())}
          >
            {t('ui.contracts.saveVersion')}
          </Button>
        </form>
      ) : (
        latest && (
          <div className="grid gap-4 md:grid-cols-2">
            <div dir="ltr" lang="en" className="text-[14px] whitespace-pre-wrap">
              {latest.bodyEn}
            </div>
            <div dir="rtl" lang="ar" className="text-[14px] whitespace-pre-wrap">
              {latest.bodyAr}
            </div>
          </div>
        )
      )}
      {(versions.data?.items.length ?? 0) > 0 && (
        <details className="rounded-tile bg-frame p-3">
          <summary className="cursor-pointer text-[13px] font-semibold">
            {t('ui.contracts.versions')}
          </summary>
          <ol className="mt-2 grid gap-2 text-[13px]">
            {versions.data?.items.map((v) => (
              <li key={v.versionNo} className="text-ink-2">
                <b className="text-ink">{t('ui.contracts.versionLabel', { n: v.versionNo })}</b>
                {' · '}
                {new Date(v.createdAt).toLocaleString(
                  locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-KW',
                )}
                {v.authorName ? ` · ${v.authorName}` : ''}
                {v.changeNote ? ` · ${v.changeNote}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}
