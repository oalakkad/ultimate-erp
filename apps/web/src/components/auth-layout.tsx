import { Card, Logo } from '@ultimate-erp/ui';
import { CircleAlert } from 'lucide-react';
import { type ReactNode } from 'react';
import { useI18n } from '../app/i18n.js';
import { LanguageSwitch, ThemeSwitch } from '../app/switches.js';
import { errorReference, errorText } from '../lib/errors.js';
import { useTenant } from '../lib/session.js';

/** Centered card for sign-in and other account pages; shows the company on its own address. */
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
  return (
    <div className="mx-auto grid min-h-screen max-w-[440px] content-center gap-4 px-4 py-10">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
      <Card>
        <Logo
          subtitle={
            tenant ? (locale === 'ar' ? tenant.name.ar : tenant.name.en) : t('ui.app.tagline')
          }
        />
        <h1 className="text-[22px] font-extrabold tracking-tight">{title}</h1>
        {children}
      </Card>
      {footer && (
        <div className="grid justify-items-center gap-1.5 text-[13px] text-ink-2">{footer}</div>
      )}
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
