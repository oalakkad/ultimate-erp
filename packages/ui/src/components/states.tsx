import { CircleAlert, Inbox, Lock, RotateCcw } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';

/** Placeholder shapes while content loads (preferred over spinners for layout stability). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('ui-shimmer rounded-ctl', className)} />;
}

/** A labelled loading region: screen readers hear the label, sighted users see skeletons. */
export function LoadingState({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-2.5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

/**
 * The state's mark (design-system.md §5): its icon on a tinted tile, with one sheet of paper
 * set behind it. Still and quiet on purpose; hidden from assistive technology.
 */
function StateMark({ icon, tone }: { icon: ReactNode; tone: string }) {
  return (
    <div aria-hidden className="relative mb-1 size-14">
      <span className="absolute inset-0 translate-x-1.5 -translate-y-1 rotate-6 rounded-[14px] border border-line bg-card shadow-card rtl:-translate-x-1.5 rtl:-rotate-6" />
      <span
        className={cn(
          'ui-gloss absolute inset-0 grid place-items-center rounded-[14px] [&_svg]:size-6',
          tone,
        )}
      >
        {icon}
      </span>
    </div>
  );
}

function StateFrame({
  icon,
  tone,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="ui-rise grid justify-items-center gap-2 px-4 py-6 text-center">
      <StateMark icon={icon} tone={tone} />
      <b className="text-[14px] font-bold text-ink">{title}</b>
      <p className="max-w-80 text-[13px] text-ink-2">{body}</p>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <StateFrame icon={<Inbox />} tone="bg-sky text-sky-ink" title={title} body={body}>
      {action}
    </StateFrame>
  );
}

/**
 * Honest error with a recovery path (brief §3): what happened, the request reference to quote
 * to support (the API's X-Request-Id), and a retry button.
 */
export function ErrorState({
  title,
  body,
  reference,
  retryLabel,
  onRetry,
}: {
  title: string;
  body: string;
  /** Already-translated "Reference: …" text, if a request ID is known. */
  reference?: string | undefined;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert">
      <StateFrame icon={<CircleAlert />} tone="bg-blush text-blush-ink" title={title} body={body}>
        {reference && <p className="num text-xs text-ink-3">{reference}</p>}
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw aria-hidden className="mirror size-4" />}
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      </StateFrame>
    </div>
  );
}

export function PermissionDenied({ title, body }: { title: string; body: string }) {
  return <StateFrame icon={<Lock />} tone="bg-butter text-butter-ink" title={title} body={body} />;
}
