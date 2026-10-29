import { Link } from '@tanstack/react-router';
import { Card, EmptyState } from '@ultimate-erp/ui';
import { UserPlus } from 'lucide-react';
import { useI18n } from '../app/i18n.js';
import { AppPageHeader } from '../components/page-header.js';
import { can, useAccess } from '../lib/session.js';

/** Honest empty dashboard: no figures until the modules that produce them exist. */
export function DashboardPage() {
  const { t } = useI18n();
  const access = useAccess(true);
  return (
    <div className="grid gap-4">
      <AppPageHeader title={t('ui.dashboard.title')} home={false} />
      <Card>
        <EmptyState
          title={t('ui.dashboard.emptyTitle')}
          body={t('ui.dashboard.emptyBody')}
          action={
            can(access.data, 'access.members.invite') ? (
              <Link
                to="/members"
                className="inline-flex h-10 items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover"
              >
                <UserPlus aria-hidden className="size-4" />
                {t('ui.dashboard.inviteCta')}
              </Link>
            ) : undefined
          }
        />
      </Card>
    </div>
  );
}
