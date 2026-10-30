import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  isRole,
  type Notification,
  notificationListResponseSchema,
  okResponseSchema,
  unreadCountResponseSchema,
} from '@ultimate-erp/contracts';
import { formatDate } from '@ultimate-erp/i18n';
import { Button, Drawer, EmptyState, ErrorState, IconButton, LoadingState } from '@ultimate-erp/ui';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { api } from '../lib/api.js';
import { errorReference, errorText } from '../lib/errors.js';
import { safeReturnTo } from '../lib/navigation.js';

const UNREAD_KEY = ['notifications', 'unread'] as const;
const LIST_KEY = ['notifications', 'list'] as const;

/** The sentence for one notification, in the reader's language. */
function useNotificationText() {
  const { t } = useI18n();
  return (item: Notification) => {
    switch (item.type) {
      case 'access.member_joined':
        return t('ui.notifications.types.access_member_joined', { name: item.params.name ?? '' });
      case 'access.roles_changed': {
        const roles = (item.params.roles ?? '')
          .split(',')
          .filter(isRole)
          .map((role) => t(`roles.${role}`))
          .join(' · ');
        return t('ui.notifications.types.access_roles_changed', { roles });
      }
      case 'contracts.submitted':
      case 'contracts.approved':
      case 'contracts.rejected':
      case 'contracts.renewal_due':
      case 'contracts.expired': {
        const key = item.type.replace('.', '_') as 'contracts_expired';
        return t(`ui.notifications.types.${key}`, {
          number: item.params.number ?? '',
          endDate: item.params.endDate ?? '',
        });
      }
    }
  };
}

/**
 * Bell in the top bar: unread count (refreshed every minute and when the tab regains focus)
 * and a panel with my notifications. Opening one marks it read and follows its link — the
 * target page checks access as usual (a link never grants access).
 */
export function NotificationBell() {
  const { t, locale } = useI18n();
  const text = useNotificationText();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const unread = useQuery({
    queryKey: UNREAD_KEY,
    refetchInterval: 60_000,
    queryFn: () => api('/notifications/unread-count', { schema: unreadCountResponseSchema }),
  });
  const list = useInfiniteQuery({
    queryKey: LIST_KEY,
    enabled: open,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api(`/notifications${pageParam ? `?cursor=${pageParam}` : ''}`, {
        schema: notificationListResponseSchema,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/read`, { method: 'POST', schema: okResponseSchema }),
    onSettled: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST', schema: okResponseSchema }),
    onSettled: refresh,
  });

  const count = unread.data?.count ?? 0;
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const openItem = (item: Notification) => {
    if (!item.read) markRead.mutate(item.id);
    setOpen(false);
    const link = safeReturnTo(item.link);
    if (link) void navigate({ href: link });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      trigger={
        <IconButton label={t('ui.notifications.open', { count })} dot={count > 0}>
          <Bell aria-hidden />
        </IconButton>
      }
      title={t('ui.notifications.title')}
      closeLabel={t('ui.common.close')}
      footer={
        count > 0 ? (
          <Button
            variant="secondary"
            loading={markAll.isPending}
            onClick={() => {
              markAll.mutate();
            }}
          >
            {t('ui.notifications.markAllRead')}
          </Button>
        ) : undefined
      }
    >
      {list.isPending && <LoadingState label={t('ui.common.loading')} lines={3} />}
      {list.isError && (
        <ErrorState
          title={t('ui.states.errorTitle')}
          body={errorText(t, list.error)}
          reference={errorReference(t, list.error)}
          retryLabel={t('ui.common.retry')}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.isSuccess && items.length === 0 && (
        <EmptyState title={t('ui.notifications.empty')} body={t('ui.states.emptyBody')} />
      )}
      <ul
        className="grid max-h-[calc(100vh-220px)] gap-2 overflow-y-auto"
        aria-label={t('ui.notifications.title')}
      >
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                openItem(item);
              }}
              className={`grid w-full gap-1 rounded-tile p-3 text-start hover:bg-frame ${item.read ? '' : 'bg-lilac/40'}`}
            >
              <span className="flex items-start gap-2 text-[13.5px]">
                {!item.read && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-plum">
                    <span className="sr-only">{t('ui.notifications.unread')}</span>
                  </span>
                )}
                <span className={item.read ? 'text-ink-2' : 'font-semibold'}>{text(item)}</span>
              </span>
              <small className="text-ink-3">
                {formatDate(locale, new Date(item.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          variant="ghost"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('ui.notifications.older')}
        </Button>
      )}
    </Drawer>
  );
}
