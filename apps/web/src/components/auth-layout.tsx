import { Card, Logo } from '@ultimate-erp/ui';
import {
  CalendarDays,
  CircleAlert,
  Clock,
  FileSignature,
  FolderKanban,
  type LucideIcon,
  QrCode,
  Receipt,
  Users,
  Wallet,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch, ThemeSwitch } from '../app/switches.js';
import { errorReference, errorText } from '../lib/errors.js';
import { useTenant } from '../lib/session.js';

/** The modules shown on the sign-in showcase: real module names, a pastel tone each. */
const SHOWCASE: {
  key:
    'clients' | 'contracts' | 'projects' | 'time' | 'leave' | 'attendance' | 'payroll' | 'invoices';
  icon: LucideIcon;
  tone: string;
}[] = [
  { key: 'clients', icon: Users, tone: 'bg-sky text-sky-ink' },
  { key: 'contracts', icon: FileSignature, tone: 'bg-lilac text-lilac-ink' },
  { key: 'projects', icon: FolderKanban, tone: 'bg-mint text-mint-ink' },
  { key: 'time', icon: Clock, tone: 'bg-butter text-butter-ink' },
  { key: 'attendance', icon: QrCode, tone: 'bg-mint text-mint-ink' },
  { key: 'leave', icon: CalendarDays, tone: 'bg-butter text-butter-ink' },
  { key: 'payroll', icon: Wallet, tone: 'bg-blush text-blush-ink' },
  { key: 'invoices', icon: Receipt, tone: 'bg-lilac text-lilac-ink' },
];

/**
 * Account pages: the form card beside a plum showcase panel (the firm's modules as pastel tiles,
 * rising in once). On narrow screens the panel folds to a slim band above the card.
 */
export function AuthLayout({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const tenant = useTenant().data;
  const subtitle = tenant
    ? locale === 'ar'
      ? tenant.name.ar
      : tenant.name.en
    : t('ui.app.tagline');
  return (
    <div className="grid min-h-screen content-center bg-ground px-3 py-6 sm:px-6 sm:py-10">
      <div className="ui-rise mx-auto grid w-full max-w-[1080px] overflow-hidden rounded-[24px] border-[6px] border-card bg-frame shadow-frame lg:grid-cols-[minmax(0,1fr)_460px] lg:rounded-frame">
        <aside className="relative flex flex-col justify-between gap-6 overflow-hidden bg-plum p-6 text-on-plum lg:gap-10 lg:p-12">
          <div
            aria-hidden
            className="absolute -end-20 -top-20 size-64 rounded-full bg-lilac-solid/20"
          />
          <div
            aria-hidden
            className="absolute -start-16 bottom-10 size-48 rounded-full bg-mint-solid/15"
          />
          <div className="relative flex items-center gap-2.5">
            <span aria-hidden className="relative size-[34px] shrink-0">
              <span className="absolute start-0 top-0 size-[22px] rounded-lg bg-on-plum" />
              <span className="absolute end-0 bottom-0 size-[22px] rounded-lg bg-lilac-solid" />
            </span>
            <b className="text-base font-extrabold tracking-tight">Ultimate</b>
          </div>
          <div className="relative grid gap-3">
            <h2 className="font-display text-[34px] leading-[1.05] italic lg:text-[46px]">
              {t('ui.auth.showcaseTitle')}
            </h2>
            <p className="max-w-[46ch] text-[14px] text-on-plum/75 lg:text-[15px]">
              {t('ui.auth.showcaseBody')}
            </p>
          </div>
          <ul
            className="ui-stagger relative hidden grid-cols-2 gap-3 lg:grid"
            aria-label={t('ui.auth.showcaseModules')}
          >
            {SHOWCASE.map(({ key, icon: Icon, tone }) => (
              <li
                key={key}
                className={`flex items-center gap-3 rounded-tile px-4 py-3.5 text-[13.5px] font-semibold ${tone}`}
              >
                <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={1.8} />
                {t(`ui.shell.${key}`)}
              </li>
            ))}
          </ul>
          <ul
            className="relative flex flex-wrap gap-2 lg:hidden"
            aria-label={t('ui.auth.showcaseModules')}
          >
            {SHOWCASE.slice(0, 5).map(({ key, tone }) => (
              <li key={key} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${tone}`}>
                {t(`ui.shell.${key}`)}
              </li>
            ))}
          </ul>
        </aside>
        <section className="grid content-center gap-4 p-5 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Logo subtitle={subtitle} />
            <div className="flex items-center gap-2">
              <ThemeSwitch />
              <LanguageSwitch />
            </div>
          </div>
          <Card>
            <h1 className="text-[22px] font-extrabold tracking-tight">{title}</h1>
            {children}
          </Card>
          {footer && (
            <div className="grid justify-items-center gap-1.5 text-[13px] text-ink-2">{footer}</div>
          )}
        </section>
      </div>
    </div>
  );
}

/** A failed action: what happened (translated) and the reference to quote to support. */
export function FormError({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  const reference = errorReference(t, error);
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-ctl bg-blush px-3.5 py-3 text-[13px] text-blush-ink"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="grid gap-0.5">
        <span className="font-semibold">{errorText(t, error)}</span>
        {reference && <span className="num text-xs opacity-80">{reference}</span>}
      </div>
    </div>
  );
}

/** Class for inline text links on the account pages. */
export const LINK_CLASS = 'font-semibold text-plum underline-offset-4 hover:underline';
