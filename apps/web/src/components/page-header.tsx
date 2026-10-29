import { useNavigate } from '@tanstack/react-router';
import { PageHeader } from '@ultimate-erp/ui';
import { type ReactNode } from 'react';
import { useI18n } from '../app/i18n.js';

/** Page title with "Home ›" breadcrumbs (none on the dashboard itself) and page actions. */
export function AppPageHeader({
  title,
  home = true,
  actions,
}: {
  title: string;
  home?: boolean;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <PageHeader
      title={title}
      crumbsLabel={t('ui.shell.breadcrumbs')}
      crumbs={
        home
          ? [
              {
                label: t('ui.shell.home'),
                href: '/',
                onClick: (e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  void navigate({ to: '/' });
                },
              },
            ]
          : []
      }
      actions={actions}
    />
  );
}
