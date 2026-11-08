import { ChevronRight, Search } from 'lucide-react';
import { Direction, Tooltip as RadixTooltip } from 'radix-ui';
import { type MouseEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { ToastProvider } from './overlays.js';

/** Wraps the app: text direction for Radix components, tooltip timing, toasts. */
export function UiProvider({
  dir,
  closeLabel,
  children,
}: {
  dir: 'ltr' | 'rtl';
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <Direction.Provider dir={dir}>
      <RadixTooltip.Provider>
        <ToastProvider closeLabel={closeLabel}>{children}</ToastProvider>
      </RadixTooltip.Provider>
    </Direction.Provider>
  );
}

export function Logo({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <div aria-hidden className="relative size-[34px] shrink-0">
        <span className="absolute start-0 top-0 size-[22px] rounded-lg bg-plum" />
        <span className="absolute end-0 bottom-0 size-[22px] rounded-lg bg-lilac-solid opacity-85" />
      </div>
      <div className="min-w-0">
        <b className="block text-base leading-tight font-extrabold tracking-tight">Ultimate</b>
        {subtitle && <small className="block truncate text-[11.5px] text-ink-3">{subtitle}</small>}
      </div>
    </div>
  );
}

/** Full-window layout on the wallpaper: a floating glass sidebar beside the main column. */
export function AppFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh gap-3 p-2.5 sm:p-3 md:grid-cols-[264px_minmax(0,1fr)]">
      {sidebar}
      <main className="grid min-w-0 content-start gap-5 px-1.5 py-2 md:px-4 md:pt-3 md:pb-6">
        {children}
      </main>
    </div>
  );
}

export function Sidebar({
  label,
  header,
  profile,
  children,
  footer,
}: {
  /** Accessible name of the navigation landmark. */
  label: string;
  header: ReactNode;
  profile?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <aside className="sticky top-3 hidden h-[calc(100dvh-1.5rem)] flex-col gap-[18px] overflow-y-auto rounded-frame ui-glass px-4 py-5 md:flex">
      {header}
      {profile}
      <nav aria-label={label} className="grid gap-3.5">
        {children}
      </nav>
      {footer && <div className="mt-auto grid gap-0.5">{footer}</div>}
    </aside>
  );
}

export function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="px-3 pb-1 text-[11px] font-bold tracking-[0.06em] text-ink-3 uppercase [:root[lang=ar]_&]:tracking-normal">
        {title}
      </span>
      {children}
    </div>
  );
}

/** A navigation link. `current` marks where you are in plum (design-system.md §1). */
export function NavItem({
  href,
  icon,
  label,
  current,
  badge,
  onClick,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  current?: boolean;
  badge?: ReactNode;
  /** Lets the app switch pages without a reload (the href still works for new tabs). */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex items-center gap-[11px] rounded-ctl px-3 py-[9px] text-[13.5px] font-medium text-ink-2 transition-colors [&>svg]:size-[18px] [&>svg]:stroke-[1.8]',
        current
          ? 'bg-plum font-semibold text-on-plum shadow-[0_10px_20px_-10px_rgb(59_31_62/0.7)]'
          : 'hover:bg-frame hover:text-ink',
      )}
    >
      {icon}
      <span>{label}</span>
      {badge && <span className="ms-auto">{badge}</span>}
    </a>
  );
}

/** Profile card in the sidebar (check-in/out buttons join it in the attendance phase). */
export function ProfileCard({
  avatar,
  name,
  subtitle,
}: {
  avatar: ReactNode;
  name: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-tile bg-frame p-3.5">
      {avatar}
      <div className="min-w-0">
        <b className="block truncate text-[14px] font-bold">{name}</b>
        <small className="block truncate text-xs text-ink-3">{subtitle}</small>
      </div>
    </div>
  );
}

export interface Crumb {
  label: string;
  href?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** Page title with breadcrumbs and page actions (one per screen, inside <main>). */
export function PageHeader({
  title,
  crumbs = [],
  crumbsLabel,
  actions,
}: {
  title: string;
  crumbs?: Crumb[];
  /** Accessible name of the breadcrumb navigation. */
  crumbsLabel: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid min-w-0 gap-1">
        {crumbs.length > 0 && (
          <nav aria-label={crumbsLabel}>
            <ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-ink-3">
              {crumbs.map((crumb) => (
                <li key={crumb.label} className="flex items-center gap-1">
                  {crumb.href ? (
                    <a
                      href={crumb.href}
                      onClick={crumb.onClick}
                      className="hover:text-ink hover:underline"
                    >
                      {crumb.label}
                    </a>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                  <ChevronRight aria-hidden className="mirror size-3.5" />
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em]">{title}</h1>
      </div>
      {actions && <div className="ms-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Topbar({ search, actions }: { search?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {search}
      <span className="flex-1" />
      {actions}
    </div>
  );
}

/** Search entry in the top bar: a button that opens the command palette. */
export function SearchBox({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={shortcut ? 'Control+K Meta+K' : undefined}
      className="ui-glass flex h-11 max-w-[420px] min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 text-start text-ink-3 hover:text-ink"
    >
      <Search aria-hidden className="size-[18px]" />
      <span className="truncate">{label}</span>
      {shortcut && (
        <kbd className="ms-auto rounded-[7px] bg-frame px-1.5 py-0.5 font-ui text-[11px] font-semibold text-ink-2">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

/** Pill-shaped segmented control (theme and language switches). */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; lang?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-full border border-line bg-card p-[3px] shadow-card"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.lang}
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
          className="rounded-full px-3 py-[5px] text-[12.5px] font-semibold text-ink-2 aria-pressed:bg-plum aria-pressed:text-on-plum"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
