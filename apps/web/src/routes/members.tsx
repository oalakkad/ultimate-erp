import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canGrant,
  createInvitationRequestSchema,
  invitationListResponseSchema,
  invitationSchema,
  memberListResponseSchema,
  okResponseSchema,
  type Role,
  ROLES,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,
  SelectField,
  StatusChip,
  TextField,
  useToast,
} from '@ultimate-erp/ui';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { type z } from 'zod';
import { useI18n } from '../app/i18n.js';
import { FormError } from '../components/auth-layout.js';
import { AppPageHeader } from '../components/page-header.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { can, useAccess } from '../lib/session.js';
import { useSearchParam } from '../lib/use-search-param.js';

type Member = z.infer<typeof memberListResponseSchema>['members'][number];
type InviteForm = z.input<typeof createInvitationRequestSchema>;

/**
 * Members of this company. Buttons appear only when the person holds the permission and the
 * separation-of-duties rule allows the grant (canGrant) — UX only; the server decides.
 */
export function MembersPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const access = useAccess(true);
  const mine = access.data;
  const canInvite = can(mine, 'access.members.invite');
  const canAssign = can(mine, 'access.roles.assign');
  const canManage = can(mine, 'access.members.manage');
  const myRoles = mine?.roles ?? [];
  const grantable = ROLES.filter((role) => canGrant(myRoles, [role]));

  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api('/members', { schema: memberListResponseSchema }),
  });
  const invitations = useQuery({
    queryKey: ['invitations'],
    enabled: canInvite,
    queryFn: () => api('/invitations', { schema: invitationListResponseSchema }),
  });

  // "Invite a colleague" from the command palette (?invite=1) opens the dialog directly,
  // once; after that the dialog is controlled by its own buttons.
  const inviteRequested = useSearchParam('invite') === '1' && canInvite;
  const [inviteState, setInviteOpen] = useState<boolean | null>(null);
  const inviteOpen = inviteState ?? inviteRequested;
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const inviteForm = useForm<InviteForm>({
    resolver: zodResolver(createInvitationRequestSchema),
    defaultValues: { email: '', role: 'employee' },
  });
  const invite = useMutation({
    mutationFn: (body: InviteForm) =>
      api('/invitations', { method: 'POST', body, schema: invitationSchema }),
    onSuccess: async (created) => {
      toast({ tone: 'good', title: t('ui.members.invited', { email: created.email }) });
      setInviteOpen(false);
      inviteForm.reset();
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/invitations/${id}`, { method: 'DELETE', schema: okResponseSchema }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.members.revoked') });
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => {
      toast({ tone: 'bad', title: errorText(t, err) });
    },
  });
  const remove = useMutation({
    mutationFn: (member: Member) =>
      api(`/members/${member.membershipId}/remove`, { method: 'POST', schema: okResponseSchema }),
    onSuccess: async (_result, member) => {
      toast({ tone: 'good', title: t('ui.members.removed', { name: member.name }) });
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });

  if (access.isPending) return <LoadingState label={t('ui.common.loading')} />;
  if (!can(mine, 'access.members.read')) {
    return <PermissionDenied title={t('ui.states.deniedTitle')} body={t('ui.states.deniedBody')} />;
  }

  const date = (iso: string) => formatDate(locale, new Date(iso), { dateStyle: 'medium' });
  const pending = invitations.data?.invitations.filter((i) => i.status === 'pending') ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <AppPageHeader title={t('ui.members.title')} />
        {canInvite && (
          <div className="ms-auto">
            <Dialog
              open={inviteOpen}
              onOpenChange={(open) => {
                setInviteOpen(open);
                if (!open) invite.reset();
              }}
              trigger={
                <Button icon={<UserPlus aria-hidden className="size-4" />}>
                  {t('ui.members.invite')}
                </Button>
              }
              title={t('ui.members.inviteTitle')}
              description={t('ui.members.inviteBody')}
              closeLabel={t('ui.common.close')}
            >
              <form
                noValidate
                className="grid gap-4"
                onSubmit={(e) =>
                  void inviteForm.handleSubmit((v) => {
                    invite.mutate(v);
                  })(e)
                }
              >
                <TextField
                  label={t('ui.auth.email')}
                  type="email"
                  autoComplete="off"
                  error={inviteForm.formState.errors.email ? t('ui.validation.email') : undefined}
                  {...inviteForm.register('email')}
                />
                <Controller
                  control={inviteForm.control}
                  name="role"
                  render={({ field }) => (
                    <SelectField
                      label={t('ui.members.role')}
                      placeholder={t('ui.members.role')}
                      value={field.value}
                      onValueChange={field.onChange}
                      options={grantable.map((role) => ({
                        value: role,
                        label: t(`roles.${role}`),
                      }))}
                    />
                  )}
                />
                <FormError error={invite.error} />
                <Button type="submit" loading={invite.isPending}>
                  {t('ui.members.sendInvite')}
                </Button>
              </form>
            </Dialog>
          </div>
        )}
      </div>

      <Card>
        {members.isPending && <LoadingState label={t('ui.common.loading')} />}
        {members.isError && (
          <ErrorState
            title={t('ui.states.errorTitle')}
            body={errorText(t, members.error)}
            reference={errorReference(t, members.error)}
            retryLabel={t('ui.common.retry')}
            onRetry={() => void members.refetch()}
          />
        )}
        {members.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-[13.5px]">
              <thead className="text-[12px] text-ink-3">
                <tr>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.members.colName')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.members.colRoles')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('ui.members.colJoined')}
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">{t('ui.members.changeRoles')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.data.members.map((member) => {
                  const isMe = member.membershipId === mine?.membershipId;
                  const mayEdit = !isMe && canAssign && canGrant(myRoles, member.roles);
                  const mayRemove = !isMe && canManage && canGrant(myRoles, member.roles);
                  return (
                    <tr key={member.membershipId} className="border-t border-line">
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={member.name}
                            initials={member.name.slice(0, 2).toUpperCase()}
                            size={36}
                          />
                          <div className="min-w-0">
                            <b className="block truncate">
                              {member.name}{' '}
                              {isMe && <span className="text-ink-3">({t('ui.members.you')})</span>}
                            </b>
                            <small className="block truncate text-ink-3" dir="ltr">
                              {member.email}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        {member.roles.map((role) => t(`roles.${role}`)).join(' · ')}
                      </td>
                      <td className="py-3">{member.joinedAt ? date(member.joinedAt) : '—'}</td>
                      <td className="py-3">
                        <div className="flex justify-end gap-2">
                          {mayEdit && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setEditing(member);
                              }}
                            >
                              {t('ui.members.changeRoles')}
                            </Button>
                          )}
                          {mayRemove && (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setRemoving(member);
                              }}
                            >
                              {t('ui.members.remove')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canInvite && (
        <Card title={t('ui.members.pending')}>
          {invitations.isPending && <LoadingState label={t('ui.common.loading')} lines={2} />}
          {invitations.isError && (
            <ErrorState
              title={t('ui.states.errorTitle')}
              body={errorText(t, invitations.error)}
              reference={errorReference(t, invitations.error)}
              retryLabel={t('ui.common.retry')}
              onRetry={() => void invitations.refetch()}
            />
          )}
          {invitations.data && pending.length === 0 && (
            <EmptyState title={t('ui.members.noPending')} body={t('ui.members.inviteBody')} />
          )}
          <ul className="grid gap-2">
            {pending.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-tile bg-frame p-3"
              >
                <div className="min-w-0 flex-1">
                  <b className="block truncate" dir="ltr">
                    {item.email}
                  </b>
                  <small className="text-ink-3">
                    {t(`roles.${item.role}`)} ·{' '}
                    {t('ui.members.expiresOn', { date: date(item.expiresAt) })}
                  </small>
                  {item.delivery === 'failed' && (
                    <span className="mt-1 block">
                      <StatusChip status="bad" label={t('ui.members.deliveryFailed')} />
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={revoke.isPending && revoke.variables === item.id}
                  onClick={() => {
                    revoke.mutate(item.id);
                  }}
                >
                  {t('ui.members.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <RolesDialog
          member={editing}
          grantable={grantable}
          myRoles={myRoles}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title={t('ui.members.removeTitle', { name: removing?.name ?? '' })}
        description={t('ui.members.removeBody')}
        closeLabel={t('ui.common.close')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRemoving(null);
              }}
            >
              {t('ui.common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (removing) remove.mutate(removing);
              }}
            >
              {t('ui.members.remove')}
            </Button>
          </>
        }
      >
        <FormError error={remove.error} />
      </Dialog>
    </div>
  );
}

function RolesDialog({
  member,
  grantable,
  myRoles,
  onClose,
}: {
  member: Member;
  grantable: Role[];
  myRoles: Role[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<Role[]>(member.roles);
  const save = useMutation({
    mutationFn: () =>
      api(`/members/${member.membershipId}/roles`, {
        method: 'PUT',
        body: { roles },
        schema: okResponseSchema,
      }),
    onSuccess: async () => {
      toast({ tone: 'good', title: t('ui.members.rolesSaved') });
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
  });
  const toggle = (role: Role, on: boolean) => {
    setRoles((current) => (on ? [...current, role] : current.filter((r) => r !== role)));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('ui.members.changeRolesTitle', { name: member.name })}
      closeLabel={t('ui.common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('ui.common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={roles.length === 0 || !canGrant(myRoles, roles)}
            onClick={() => {
              save.mutate();
            }}
          >
            {t('ui.members.saveRoles')}
          </Button>
        </>
      }
    >
      <fieldset className="grid gap-2">
        <legend className="sr-only">{t('ui.members.colRoles')}</legend>
        {grantable.map((role) => (
          <Checkbox
            key={role}
            label={t(`roles.${role}`)}
            checked={roles.includes(role)}
            onCheckedChange={(on) => {
              toggle(role, on);
            }}
          />
        ))}
      </fieldset>
      <FormError error={save.error} />
    </Dialog>
  );
}
