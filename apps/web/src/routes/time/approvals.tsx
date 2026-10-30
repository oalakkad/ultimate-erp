import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalListResponseSchema, type TimeEntry } from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  TextArea,
  useToast,
} from '@ultimate-erp/ui';
import { useState } from 'react';
import { useI18n } from '../../app/i18n.js';
import { FormError } from '../../components/auth-layout.js';
import { AppPageHeader } from '../../components/page-header.js';
import { api } from '../../lib/api.js';
import { errorReference, errorText } from '../../lib/errors.js';
import { hoursText } from '../projects/shared.js';

/** Submitted time waiting for my approval, grouped by person. */
export function TimeApprovalsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const list = useQuery({
    queryKey: ['time', 'approvals'],
    queryFn: () => api('/approvals/time', { schema: approvalListResponseSchema }),
  });
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api(`/time-entries/${decision}`, {
        method: 'POST',
        body: decision === 'reject' ? { ids: picked, reason } : { ids: picked },
        schema: approvalListResponseSchema,
      }),
    onSuccess: async (_data, decision) => {
      toast({
        tone: 'good',
        title: t(decision === 'approve' ? 'ui.time.approvedDone' : 'ui.time.rejectedDone'),
      });
      setPicked([]);
      setRejecting(false);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['time'] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const groups = new Map<string, TimeEntry[]>();
  for (const e of list.data?.items ?? []) {
    groups.set(e.person.membershipId, [...(groups.get(e.person.membershipId) ?? []), e]);
  }
  const toggle = (id: string, on: boolean) => {
    setPicked(on ? [...picked, id] : picked.filter((p) => p !== id));
  };

  return (
    <div className="grid gap-4">
      <AppPageHeader
        title={t('ui.time.approvalsTitle')}
        actions={
          picked.length > 0 && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  decide.reset();
                  setRejecting(true);
                }}
              >
                {t('ui.time.rejectSelected', { count: picked.length })}
              </Button>
              <Button
                loading={decide.isPending && decide.variables === 'approve'}
                onClick={() => {
                  decide.mutate('approve');
                }}
              >
                {t('ui.time.approveSelected', { count: picked.length })}
              </Button>
            </>
          )
        }
      />
      {!rejecting && <FormError error={decide.error} />}
      {list.isPending && <LoadingState label={t('ui.common.loading')} />}
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
        <Card>
          <EmptyState
            title={t('ui.time.nothingToApprove')}
            body={t('ui.time.nothingToApproveBody')}
          />
        </Card>
      )}
      {[...groups.values()].map((entries) => {
        const person = entries[0]?.person;
        const all = entries.every((e) => picked.includes(e.id));
        return (
          <Card
            key={person?.membershipId}
            title={person?.name ?? ''}
            action={
              <Checkbox
                label={t('ui.time.selectAll')}
                checked={all}
                onCheckedChange={(on) => {
                  const ids = entries.map((e) => e.id);
                  setPicked(
                    on ? [...new Set([...picked, ...ids])] : picked.filter((p) => !ids.includes(p)),
                  );
                }}
              />
            }
          >
            <ul className="grid gap-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
                >
                  <Checkbox
                    label={`${e.task.number} · ${e.task.title}`}
                    checked={picked.includes(e.id)}
                    onCheckedChange={(on) => {
                      toggle(e.id, on);
                    }}
                  />
                  <small className="min-w-0 flex-1 text-ink-3">
                    {formatDate(locale, new Date(`${e.workDate}T12:00:00Z`), {
                      dateStyle: 'medium',
                    })}{' '}
                    · {locale === 'ar' ? e.project.name.ar : e.project.name.en}
                    {e.billable ? '' : ` · ${t('ui.time.nonBillable')}`}
                    {e.description ? ` · ${e.description}` : ''}
                  </small>
                  <b className="tabular-nums">{hoursText(locale, t, e.hours)}</b>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      <Dialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t('ui.time.rejectSelected', { count: picked.length })}
        description={t('ui.time.rejectHint')}
        closeLabel={t('ui.common.close')}
      >
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            decide.mutate('reject');
          }}
        >
          <TextArea
            label={t('ui.time.reason')}
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <FormError error={decide.error} />
          <Button
            type="submit"
            className="w-fit"
            loading={decide.isPending}
            disabled={!reason.trim()}
          >
            {t('ui.time.sendBack')}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
