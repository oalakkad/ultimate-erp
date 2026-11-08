import { Check, LayoutGrid, List } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Avatar, type Status } from './data-display.js';

// Workspace building blocks (design-system.md §8, 2026-11-08): the pieces every module page is
// composed from — card/table switch, entity cards, avatar stacks, toned progress, distribution
// bars, rings and the guided-flow stepper. Colour always comes with text (never alone).

/** Initials for an avatar: first letters of the first two words ("Sara Al-Hajri" → "SA"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[1]?.[0] ?? '') : '')).toUpperCase();
}

export type ViewMode = 'cards' | 'table';

/** Card ⇄ table switch. Labels are visible to assistive technology and as tooltips. */
export function ViewToggle({
  label,
  value,
  onChange,
  cardsLabel,
  tableLabel,
}: {
  label: string;
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  cardsLabel: string;
  tableLabel: string;
}) {
  const options = [
    { value: 'cards' as const, text: cardsLabel, Icon: LayoutGrid },
    { value: 'table' as const, text: tableLabel, Icon: List },
  ];
  return (
    <div
      role="group"
      aria-label={label}
      className="ui-glass inline-flex h-10 items-center gap-0.5 rounded-full p-[3px]"
    >
      {options.map(({ value: v, text, Icon }) => (
        <button
          key={v}
          type="button"
          title={text}
          aria-pressed={value === v}
          onClick={() => {
            onChange(v);
          }}
          className="inline-flex h-full items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-ink-2 transition-colors duration-150 hover:text-ink aria-pressed:bg-plum aria-pressed:text-on-plum aria-pressed:shadow-[0_6px_14px_-6px_rgb(59_31_62/0.6)]"
        >
          <Icon aria-hidden className="size-4" />
          <span className="max-sm:sr-only">{text}</span>
        </button>
      ))}
    </div>
  );
}

/** Responsive grid for entity cards (one column on phones, up to four on wide screens). */
export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'ui-stagger grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

const ACCENT: Record<'mint' | 'blush' | 'lilac' | 'butter' | 'sky' | 'plum', string> = {
  mint: 'before:bg-mint-solid',
  blush: 'before:bg-blush-solid',
  lilac: 'before:bg-lilac-solid',
  butter: 'before:bg-butter-solid',
  sky: 'before:bg-sky-solid',
  plum: 'before:bg-plum',
};

/**
 * A record as a glass card: a coloured top accent (status or area), header, body and a footer
 * line. The whole card is the link target (rendered by the caller as `<a>`/`<Link>` around it
 * or via `as`), and lifts on hover/focus.
 */
export function EntityCard({
  accent,
  header,
  children,
  footer,
  className,
}: {
  accent?: keyof typeof ACCENT | undefined;
  header: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'ui-glass ui-card-hover relative grid h-full min-w-0 content-start gap-3.5 overflow-hidden rounded-tile p-4 pt-5',
        accent &&
          'before:absolute before:inset-x-4 before:top-0 before:h-[3px] before:rounded-b-full before:content-[""]',
        accent && ACCENT[accent],
        className,
      )}
    >
      {header}
      {children}
      {footer && (
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px] text-ink-2">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Overlapping avatars with a "+N" chip; the full list is in the accessible name. */
export function AvatarStack({
  names,
  max = 4,
  size = 28,
  label,
}: {
  names: string[];
  max?: number;
  size?: number;
  /** Accessible name, e.g. "Assigned to Sara, Omar". */
  label: string;
}) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span role="img" aria-label={label} title={names.join(', ')} className="flex items-center">
      {shown.map((name, i) => (
        <span
          key={`${name}-${String(i)}`}
          aria-hidden
          className="rounded-[32%] ring-2 ring-[var(--pop)] [&:not(:first-child)]:-ms-2"
        >
          <Avatar name={name} initials={initialsOf(name)} size={size} />
        </span>
      ))}
      {rest > 0 && (
        <span
          aria-hidden
          style={{ height: size, minWidth: size }}
          className="num -ms-2 grid place-items-center rounded-[32%] bg-plum-soft px-1 text-[11px] font-bold text-ink-2 ring-2 ring-[var(--pop)]"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

const PROGRESS: Record<Status | 'neutral', { track: string; fill: string }> = {
  good: { track: 'bg-mint', fill: 'bg-mint-solid' },
  warn: { track: 'bg-butter', fill: 'bg-butter-solid' },
  bad: { track: 'bg-blush', fill: 'bg-blush-solid' },
  info: { track: 'bg-sky', fill: 'bg-sky-solid' },
  neutral: { track: 'bg-lilac', fill: 'bg-lilac-solid' },
};

/**
 * Progress with meaning: the tone says whether the value is fine (good), close (warn) or over
 * (bad). Values above `max` fill the bar and the caller shows the overrun in text.
 */
export function Progress({
  label,
  value,
  max,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  label: string;
  value: number;
  max: number;
  tone?: Status | 'neutral';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        'w-full overflow-hidden rounded-full',
        size === 'sm' ? 'h-1.5' : 'h-2',
        PROGRESS[tone].track,
        className,
      )}
    >
      <div
        className={cn('ui-fill-x h-full rounded-full', PROGRESS[tone].fill)}
        style={{ inlineSize: `${String(pct)}%` }}
      />
    </div>
  );
}

/** Tone for "used of budget": ≤ 80 % good, ≤ 100 % warn, above bad (projects decision 2026-10-30). */
export function budgetTone(used: number, budget: number): Status | 'neutral' {
  if (budget <= 0) return 'neutral';
  const r = used / budget;
  return r > 1 ? 'bad' : r >= 0.8 ? 'warn' : 'good';
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** Already formatted value for the legend (e.g. "KWD 6,500.000"). */
  display: string;
  /** CSS colour (a token, e.g. `var(--series-1)` or `var(--blush-solid)`). */
  color: string;
}

/**
 * One horizontal bar split into parts (e.g. receivables by age), with a legend that carries the
 * numbers. The legend is the accessible representation; the bar is decorative.
 */
export function DistributionBar({
  label,
  segments,
  onSelect,
}: {
  label: string;
  segments: Segment[];
  onSelect?: ((key: string) => void) | undefined;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  return (
    <div className="grid gap-3">
      <div aria-hidden className="flex h-3 w-full gap-[3px] overflow-hidden rounded-full bg-line">
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.key}
                className="ui-fill-x h-full first:rounded-s-full last:rounded-e-full"
                style={{ flexGrow: s.value, flexBasis: 0, background: s.color }}
              />
            ))}
      </div>
      <ul aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
        {segments.map((s) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label}
              </span>
              <b className="num text-[14.5px] font-extrabold tracking-tight">{s.display}</b>
            </>
          );
          return (
            <li key={s.key}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(s.key);
                  }}
                  className="grid w-full gap-0.5 rounded-ctl px-2.5 py-2 text-start transition-colors hover:bg-frame focus-visible:bg-frame"
                >
                  {body}
                </button>
              ) : (
                <div className="grid gap-0.5 px-2.5 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Circular gauge (e.g. leave days left of entitlement). The centre text is the caller's. */
export function Ring({
  label,
  value,
  max,
  color,
  size = 76,
  children,
}: {
  label: string;
  value: number;
  max: number;
  color?: string | undefined;
  size?: number;
  children?: ReactNode;
}) {
  const r = 15.5;
  const stroke = color ?? 'var(--lilac-solid)';
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--line-2)" strokeWidth="3.2" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray={`${String(pct * c)} ${String(c)}`}
          className="ui-ring-draw"
        />
      </svg>
      <span className="relative grid place-items-center text-center leading-tight">{children}</span>
    </div>
  );
}

export interface WizardStep {
  key: string;
  title: string;
  /** One short line under the title in the step list. */
  hint?: string;
}

/**
 * Guided flow frame: numbered steps (done ✓ / current / upcoming) with a progress line, the
 * current step's content, and Back / Next / finish actions. The parent owns the step index and
 * validation (Next calls `onNext`, which should validate and then advance).
 */
export function Wizard({
  label,
  steps,
  current,
  onStepClick,
  children,
  aside,
  footer,
  progressLabel,
}: {
  label: string;
  steps: WizardStep[];
  current: number;
  /** Lets people jump back to a finished step. */
  onStepClick?: ((index: number) => void) | undefined;
  children: ReactNode;
  /** Optional context column (live summary, guidance). */
  aside?: ReactNode;
  footer: ReactNode;
  /** e.g. "Step 2 of 6". */
  progressLabel: string;
}) {
  const pct = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 100;
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_300px]">
      <nav aria-label={label} className="ui-glass h-fit rounded-card p-4 lg:sticky lg:top-4">
        <div className="mb-3 grid gap-2 px-1">
          <span className="text-[12px] font-semibold text-ink-2">{progressLabel}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-lilac">
            <div
              className="h-full rounded-full bg-plum transition-[inline-size] duration-500 ease-[var(--ease)]"
              style={{ inlineSize: `${String(pct)}%` }}
            />
          </div>
        </div>
        <ol className="grid gap-1 max-lg:flex max-lg:overflow-x-auto">
          {steps.map((step, i) => {
            const state = i < current ? 'done' : i === current ? 'current' : 'next';
            const clickable = onStepClick && i < current;
            const inner = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'num grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold transition-colors',
                    state === 'done' && 'bg-mint-solid text-white',
                    state === 'current' &&
                      'bg-plum text-on-plum shadow-[0_6px_14px_-6px_rgb(59_31_62/0.7)]',
                    state === 'next' && 'bg-line text-ink-3',
                  )}
                >
                  {state === 'done' ? <Check className="size-3.5 stroke-[3]" /> : i + 1}
                </span>
                <span className="grid min-w-0 text-start">
                  <span
                    className={cn(
                      'truncate text-[13px] font-semibold',
                      state === 'next' ? 'text-ink-3' : 'text-ink',
                    )}
                  >
                    {step.title}
                  </span>
                  {step.hint && (
                    <span className="truncate text-[11.5px] text-ink-3 max-lg:hidden">
                      {step.hint}
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={step.key} className="min-w-0 max-lg:shrink-0">
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => {
                      onStepClick(i);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-ctl px-2 py-2 hover:bg-frame"
                  >
                    {inner}
                  </button>
                ) : (
                  <div
                    aria-current={state === 'current' ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-ctl px-2 py-2',
                      state === 'current' && 'bg-plum-soft',
                    )}
                  >
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <section className="ui-glass grid min-w-0 content-start gap-5 rounded-card p-5 sm:p-6">
        <div key={current} className="ui-step grid min-w-0 gap-5">
          {children}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">{footer}</div>
      </section>
      {aside && <aside className="grid h-fit content-start gap-4 max-xl:hidden">{aside}</aside>}
    </div>
  );
}

/** Section heading inside a workspace page: title, optional count and trailing actions. */
export function SectionTitle({
  title,
  count,
  action,
}: {
  title: string;
  count?: number | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
      {count !== undefined && (
        <span className="num rounded-full bg-plum-soft px-2 py-px text-[11.5px] font-bold text-ink-2">
          {count}
        </span>
      )}
      {action && <div className="ms-auto flex items-center gap-2">{action}</div>}
    </div>
  );
}
