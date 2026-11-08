import { Logo } from '@ultimate-erp/ui';
import {
  CircleAlert,
  Clock,
  CornerDownRight,
  FileSignature,
  FolderKanban,
  type LucideIcon,
  Receipt,
  Users,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useI18n } from '../app/i18n.js';
import { LanguageToggle, ThemeToggle } from '../app/switches.js';
import { errorReference, errorText } from '../lib/errors.js';
import { useTenant } from '../lib/session.js';

/** Three facts about the product (true of every installation), each keyed by a pastel dot. */
const FACTS = [
  { term: 'ui.auth.factLanguagesTerm', text: 'ui.auth.factLanguages', dot: 'bg-sky-solid' },
  { term: 'ui.auth.factMoneyTerm', text: 'ui.auth.factMoney', dot: 'bg-mint-solid' },
  { term: 'ui.auth.factSecurityTerm', text: 'ui.auth.factSecurity', dot: 'bg-butter-solid' },
] as const;

/** How work moves through the product, in real module names; each keeps its area colour. */
const FLOW: {
  key: 'clients' | 'contracts' | 'projects' | 'time' | 'invoices';
  icon: LucideIcon;
  tone: string;
}[] = [
  { key: 'clients', icon: Users, tone: 'bg-sky text-sky-ink' },
  { key: 'contracts', icon: FileSignature, tone: 'bg-lilac text-lilac-ink' },
  { key: 'projects', icon: FolderKanban, tone: 'bg-mint text-mint-ink' },
  { key: 'time', icon: Clock, tone: 'bg-butter text-butter-ink' },
  { key: 'invoices', icon: Receipt, tone: 'bg-blush text-blush-ink' },
];

/**
 * Account pages (sign-in, sign-up, two-factor, password, invitation, companies): a plum brand
 * panel beside the form, filling the window inside the app frame. The panel carries the brand,
 * today's date (Gregorian and Hijri), one statement and three product facts — no decoration.
 * Below `lg` the panel is dropped and the logo moves above the form.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  /** One sentence under the title saying what to do here. */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const tenant = useTenant().data;
  const companyName = tenant ? (locale === 'ar' ? tenant.name.ar : tenant.name.en) : undefined;
  return (
    <div className="min-h-dvh bg-ground p-2 sm:p-3">
      <div className="ui-rise mx-auto grid min-h-[calc(100dvh-1rem)] max-w-[1440px] overflow-hidden rounded-[24px] border-[6px] border-card bg-card shadow-frame sm:min-h-[calc(100dvh-1.5rem)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)] lg:rounded-frame">
        <aside className="m-2 hidden flex-col justify-between gap-10 rounded-[22px] bg-plum p-10 text-on-plum lg:flex xl:p-12">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="relative size-[34px] shrink-0">
                <span className="absolute start-0 top-0 size-[22px] rounded-lg bg-on-plum" />
                <span className="absolute end-0 bottom-0 size-[22px] rounded-lg bg-lilac-solid" />
              </span>
              <b className="text-base font-extrabold tracking-tight">Ultimate</b>
            </div>
            <TodayLine />
          </div>
          <div className="grid gap-4">
            <p className="text-[12px] font-semibold tracking-wide text-on-plum/80">
              {t('ui.auth.flowLabel')}
            </p>
            <ol className="ui-stagger grid gap-2.5">
              {FLOW.map(({ key, icon: Icon, tone }, index) => (
                <li
                  key={key}
                  className="flex items-center gap-2.5"
                  style={{ marginInlineStart: `${index * 34}px` }}
                >
                  <span className="num w-5 text-[11.5px] font-bold text-on-plum/80">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    className={`flex items-center gap-2.5 rounded-full py-2 ps-3 pe-4 text-[13.5px] font-semibold ${tone}`}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.8} />
                    {key === 'time' ? t('ui.auth.flowTime') : t(`ui.shell.${key}`)}
                  </span>
                  {index < FLOW.length - 1 && (
                    <CornerDownRight
                      aria-hidden
                      className="size-4 text-on-plum/40 rtl:-scale-x-100"
                      strokeWidth={2}
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
          <div className="grid gap-10">
            <div className="grid gap-4">
              <p className="text-[13px] font-semibold text-on-plum/80">{t('ui.app.tagline')}</p>
              <h2 className="max-w-[15ch] text-[42px] leading-[1.04] font-extrabold tracking-[-0.03em] text-balance xl:text-[50px]">
                {t('ui.auth.showcaseTitle')}
              </h2>
            </div>
            <div className="grid gap-4 border-t border-on-plum/15 pt-6">
              <p className="text-[12px] font-semibold tracking-wide text-on-plum/80">
                {t('ui.auth.factsLabel')}
              </p>
              <dl className="ui-stagger grid grid-cols-3 gap-6">
                {FACTS.map((fact) => (
                  <div key={fact.term} className="grid content-start gap-1.5">
                    <dt className="num flex items-center gap-2 text-[17px] font-extrabold tracking-tight">
                      <span aria-hidden className={`size-2 shrink-0 rounded-[3px] ${fact.dot}`} />
                      <bdi>{t(fact.term)}</bdi>
                    </dt>
                    <dd className="text-[12.5px] leading-snug text-on-plum/80">{t(fact.text)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </aside>
        <main className="flex min-w-0 flex-col p-5 sm:p-8 lg:p-10">
          <header className="flex items-center gap-3">
            <div className="lg:hidden">
              <Logo />
            </div>
            <div className="ms-auto flex items-center gap-1.5">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </header>
          <div className="mx-auto grid w-full max-w-[400px] flex-1 content-start gap-7 pt-12 pb-6 sm:content-center sm:py-10">
            <div className="grid gap-2.5">
              {companyName && !title.includes(companyName) && (
                <span className="w-fit rounded-full bg-lilac px-3 py-1 text-[12.5px] font-semibold text-lilac-ink">
                  {companyName}
                </span>
              )}
              <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em]">
                {title}
              </h1>
              {subtitle && <p className="text-[14.5px] text-ink-2">{subtitle}</p>}
            </div>
            <div className="grid gap-4">{children}</div>
            {footer && (
              <div className="grid gap-1.5 border-t border-line pt-5 text-[13.5px] text-ink-2">
                {footer}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Today in the reader's language, Gregorian and Hijri (Umm al-Qura), as Kuwaiti offices write it. */
function TodayLine() {
  const { locale } = useI18n();
  const now = new Date();
  const tag = locale === 'ar' ? 'ar-KW' : 'en-GB';
  const gregorian = new Intl.DateTimeFormat(`${tag}-u-nu-latn`, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  const hijri = new Intl.DateTimeFormat(`${tag}-u-ca-islamic-umalqura-nu-latn`, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return (
    <p className="grid justify-items-end gap-0.5 text-end text-[12.5px] text-on-plum/80">
      <time dateTime={now.toISOString().slice(0, 10)} className="font-semibold text-on-plum">
        {gregorian}
      </time>
      <span>{hijri}</span>
    </p>
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
