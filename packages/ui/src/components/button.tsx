import { LoaderCircle } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '../lib/cn.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  // One plum primary action per area (design-system.md §4).
  primary:
    'bg-plum text-on-plum shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(23_20_27/0.2)] hover:bg-plum-hover',
  secondary: 'bg-card text-ink shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-frame',
  ghost: 'bg-transparent text-ink-2 hover:bg-frame hover:text-ink',
  danger: 'bg-blush text-blush-ink hover:bg-blush-solid hover:text-white',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  /** Shows a spinner, sets aria-busy and blocks clicks while an action runs. */
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-ctl font-bold whitespace-nowrap',
        'transition-[background-color,transform,color] duration-150 active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        size === 'md' ? 'h-10 px-4 text-[13.5px]' : 'h-8 px-3 text-[12.5px]',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  /** Small dot, e.g. unread notifications. */
  dot?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  dot,
  className,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'ui-glass relative grid size-11 place-items-center rounded-full text-ink-2',
        'transition-colors hover:text-ink [&_svg]:size-[18px] [&_svg]:stroke-[1.8]',
        className,
      )}
      {...props}
    >
      {children}
      {dot && (
        <span className="absolute end-2.5 top-2.5 size-2 rounded-full border-2 border-card bg-blush-solid" />
      )}
    </button>
  );
}
