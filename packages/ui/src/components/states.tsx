import { CircleAlert, Inbox, Lock, RotateCcw } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';

/** Placeholder shapes while content loads (preferred over spinners for layout stability). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-ctl bg-line-2', className)} />;
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
    <div className="grid justify-items-center gap-2 px-4 py-6 text-center">
      <span
        aria-hidden
        className={cn('grid size-11 place-items-center rounded-[14px] [&_svg]:size-5', tone)}
      >
        {icon}
      </span>
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
