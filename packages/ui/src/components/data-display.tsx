import {
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  TriangleAlert,
} from 'lucide-react';
import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/** White card with optional header and action (design-system.md: radius 20, padding 20). */
export function Card({
  title,
  action,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { title?: string; action?: ReactNode }) {
  return (
    <section
      className={cn(
        'grid min-w-0 content-start gap-4 rounded-card border border-line bg-card p-5 shadow-card',
        className,
      )}
      {...props}
    >
      {(title ?? action) && (
        <div className="flex items-center gap-2.5">
          {title && <h3 className="text-base font-bold tracking-tight">{title}</h3>}
          {action && <div className="ms-auto">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = 'mint' | 'blush' | 'lilac' | 'butter' | 'sky';

const TONES: Record<Tone, string> = {
  mint: 'bg-mint text-mint-ink',
  blush: 'bg-blush text-blush-ink',
  lilac: 'bg-lilac text-lilac-ink',
  butter: 'bg-butter text-butter-ink',
  sky: 'bg-sky text-sky-ink',
};

/** Pastel tile: colour identifies an area or measure, the value stays in ink colour. */
export function Tile({
  tone,
  label,
  value,
  unit,
  icon,
}: {
  tone: Tone;
  label: string;
  value: string;
  unit?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5 rounded-tile px-4 py-3.5', TONES[tone])}>
      <div className="flex items-center justify-between text-[13px] font-semibold">
        <span>{label}</span>
        {icon && (
          <span
            aria-hidden
            className="grid size-[26px] place-items-center rounded-lg bg-card [&_svg]:size-4"
          >
            {icon}
          </span>
        )}
      </div>
      <b className="num text-[22px] font-extrabold tracking-tight text-ink">
        {value}
        {unit && <small className="ms-1 text-xs font-bold opacity-70">{unit}</small>}
      </b>
    </div>
  );
}

/** Small statistic with an optional change chip. Financial figures never animate. */
export function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: ReactNode;
  delta?: { direction: 'up' | 'down'; text: string } | undefined;
}) {
  return (
    <div className="grid min-w-[150px] gap-1 rounded-tile border border-line bg-card px-4 py-3">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <b className="num flex items-center gap-2 text-[22px] font-extrabold tracking-tight">
        {value}
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[11.5px] font-bold',
              delta.direction === 'up' ? 'bg-mint text-mint-ink' : 'bg-blush text-blush-ink',
            )}
          >
            {delta.direction === 'up' ? (
              <ArrowUpRight aria-hidden className="mirror size-3 stroke-[2.4]" />
            ) : (
              <ArrowDownRight aria-hidden className="mirror size-3 stroke-[2.4]" />
            )}
            {delta.text}
          </span>
        )}
      </b>
    </div>
  );
}

export type Status = 'good' | 'warn' | 'bad' | 'info';

const STATUS: Record<Status, { className: string; Icon: typeof CircleCheck }> = {
  good: { className: 'bg-mint text-mint-ink', Icon: CircleCheck },
  warn: { className: 'bg-butter text-butter-ink', Icon: TriangleAlert },
  bad: { className: 'bg-blush text-blush-ink', Icon: CircleAlert },
  info: { className: 'bg-sky text-sky-ink', Icon: CircleDashed },
};

/** Status is always icon + label, never colour alone (design-system.md §4). */
export function StatusChip({ status, label }: { status: Status; label: string }) {
  const { className, Icon } = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        className,
      )}
    >
      <Icon aria-hidden className="size-[13px] stroke-[2.2]" />
      {label}
    </span>
  );
}

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="num min-w-[22px] rounded-full bg-blush px-1.5 py-px text-center text-[11px] font-bold text-blush-ink">
      {children}
    </span>
  );
}

const GRADIENTS = [
  'from-[#f2a38c] to-[#d9577a]',
  'from-[#8fb8ff] to-[#5a62e8]',
  'from-[#8fe0b8] to-[#2a9d74]',
  'from-[#ffd27a] to-[#e38b2c]',
  'from-[#c7a6ff] to-[#7c4fd8]',
  'from-[#9be7f0] to-[#2b8fb8]',
];

/** Initials on a gradient (fallback until people upload photos). Same name → same colour. */
export function Avatar({
  name,
  initials,
  size = 40,
}: {
  name: string;
  initials: string;
  size?: number;
}) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      role="img"
      aria-label={name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      className={cn(
        'grid shrink-0 place-items-center rounded-[30%] bg-linear-140 font-bold text-white',
        GRADIENTS[hash % GRADIENTS.length],
      )}
    >
      <span aria-hidden>{initials}</span>
    </span>
  );
}

/** Greeting name in the display face (Instrument Serif italic / Amiri). Never for data. */
export function DisplayName({ children }: { children: ReactNode }) {
  return (
    <h1 className="font-display text-[clamp(34px,4vw,46px)] leading-[1.05] font-normal tracking-tight italic [:root[lang=ar]_&]:leading-[1.35] [:root[lang=ar]_&]:font-bold [:root[lang=ar]_&]:not-italic">
      {children}
    </h1>
  );
}
