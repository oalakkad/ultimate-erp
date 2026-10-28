import { Link } from '@tanstack/react-router';
import { Card, Logo } from '@ultimate-erp/ui';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch, ThemeSwitch } from '../app/switches.js';

/** Temporary start page: honest about what exists until the real screens arrive in 1.4b. */
export function HomePage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto grid min-h-screen max-w-xl content-center gap-5 px-4 py-10">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
      <Card>
        <Logo subtitle={t('ui.app.tagline')} />
        <p className="text-[15px] text-ink-2">{t('ui.app.comingSoon')}</p>
        <Link
          to="/gallery"
          className="inline-flex h-10 w-fit items-center gap-2 rounded-ctl bg-plum px-4 text-[13.5px] font-bold text-on-plum hover:bg-plum-hover"
        >
          {t('ui.app.openGallery')}
          <ArrowRight aria-hidden className="mirror size-4" />
        </Link>
      </Card>
    </div>
  );
}
