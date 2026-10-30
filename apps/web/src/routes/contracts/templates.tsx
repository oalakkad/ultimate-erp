import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONTRACT_KINDS,
  type ContractKind,
  type ContractTemplate,
  TEMPLATE_PLACEHOLDERS,
  templateListResponseSchema,
  templateSchema,
} from '@ultimate-erp/contracts';
import {
  Button,
  Card,
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
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { can, useAccess } from '../../lib/session.js';
import { kindLabel } from './shared.js';

type Draft = { kind: ContractKind; name: string; bodyEn: string; bodyAr: string };

/** Reusable bilingual templates (Owner/CEO edit; everyone with contract access reads). */
export function ContractTemplatesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const access = useAccess(true);
  const canManage = can(access.data, 'contracts.template.manage');
  const templates = useQuery({
    queryKey: ['contract-templates'],
    queryFn: () => api('/contract-templates', { schema: templateListResponseSchema }),
  });
  const [editing, setEditing] = useState<ContractTemplate | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>({
    kind: 'engagement_letter',
    name: '',
    bodyEn: '',
    bodyAr: '',
  });

  const save = useMutation({
    mutationFn: (archive?: boolean) =>
      editing === 'new'
        ? api('/contract-templates', { method: 'POST', body: draft, schema: templateSchema })
        : api(`/contract-templates/${editing?.id ?? ''}`, {
            method: 'PATCH',
            body: archive
              ? { version: editing?.version, archived: true }
              : {
                  version: editing?.version,
                  name: draft.name,
                  bodyEn: draft.bodyEn,
                  bodyAr: draft.bodyAr,
                },
            schema: templateSchema,
          }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.contracts.templateSaved') });
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['contract-templates'] });
    },
  });
  const open = (tpl: ContractTemplate | 'new') => {
    save.reset();
    setDraft(
      tpl === 'new'
        ? { kind: 'engagement_letter', name: '', bodyEn: '', bodyAr: '' }
        : { kind: tpl.kind, name: tpl.name, bodyEn: tpl.bodyEn, bodyAr: tpl.bodyAr },
    );
    setEditing(tpl);
  };

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.contracts.templatesTitle')}
        actions={
          canManage ? (
            <Button
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => {
                open('new');
              }}
            >
              {t('ui.contracts.newTemplate')}
            </Button>
          ) : undefined
        }
      />
      <Card>
        {templates.isPending && <LoadingState label={t('ui.common.loading')} />}
        {templates.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, templates.error)}
            reference={errorReference(t, templates.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void templates.refetch()}
          />
        )}
        {templates.data?.items.length === 0 && (
          <EmptyState title={t('ui.contracts.noTemplates')} body={t('ui.states.emptyBody')} />
        )}
        <ul className="grid gap-2">
          {templates.data?.items.map((tpl) => (
            <li
              key={tpl.id}
              className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
            >
              <div className="grid min-w-0 flex-1">
                <b>{tpl.name}</b>
                <small className="text-ink-3">{kindLabel(t, tpl.kind)}</small>
              </div>
              {tpl.archived && <StatusChip status="bad" label={t('ui.clients.archivedBadge')} />}
              {canManage && !tpl.archived && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    open(tpl);
                  }}
                >
                  {t('ui.contracts.editTemplate')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        title={editing === 'new' ? t('ui.contracts.newTemplate') : t('ui.contracts.editTemplate')}
        description={t('ui.contracts.placeholders', {
          list: TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' '),
        })}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(false);
          }}
        >
          {editing === 'new' && (
            <SelectField
              label={t('ui.contracts.fields.kind')}
              placeholder={t('ui.contracts.fields.kind')}
              value={draft.kind}
              onValueChange={(v) => {
                setDraft({ ...draft, kind: v as ContractKind });
              }}
              options={CONTRACT_KINDS.map((k) => ({ value: k, label: kindLabel(t, k) }))}
            />
          )}
          <TextField
            label={t('ui.contracts.templateName')}
            value={draft.name}
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
            }}
          />
          <TextArea
            label={t('ui.contracts.textEn')}
            dir="ltr"
            lang="en"
            rows={6}
            value={draft.bodyEn}
            onChange={(e) => {
              setDraft({ ...draft, bodyEn: e.target.value });
            }}
          />
          <TextArea
            label={t('ui.contracts.textAr')}
            dir="rtl"
            lang="ar"
            rows={6}
            value={draft.bodyAr}
            onChange={(e) => {
              setDraft({ ...draft, bodyAr: e.target.value });
            }}
          />
          <FormError error={save.error} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!draft.name.trim() || !draft.bodyEn.trim() || !draft.bodyAr.trim()}
            >
              {t('ui.contracts.save')}
            </Button>
            {editing !== 'new' && editing && (
              <Button
                variant="ghost"
                onClick={() => {
                  save.mutate(true);
                }}
              >
                {t('ui.contracts.archiveTemplate')}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </div>
  );
}
