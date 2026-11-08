import { CircleCheck, CircleAlert, X } from 'lucide-react';
import {
  Dialog as RadixDialog,
  Tabs as RadixTabs,
  Toast as RadixToast,
  Tooltip as RadixTooltip,
} from 'radix-ui';
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useState,
} from 'react';

interface OverlayProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: string | undefined;
  /** Accessible name of the close button (from the catalogs). */
  closeLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Drawer only: which edge it slides from (logical: start = left in English, right in Arabic). */
  side?: 'start' | 'end';
  /** Dialog only: element to focus when it opens (default: the first focusable element). */
  initialFocus?: RefObject<HTMLElement | null>;
}

const OVERLAY =
  'fixed inset-0 z-40 bg-[rgb(23_20_27/0.35)] backdrop-blur-[2px] transition-opacity duration-200 data-[state=closed]:opacity-0';

function CloseButton({ label }: { label: string }) {
  return (
    <RadixDialog.Close
      aria-label={label}
      className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-line-2 text-ink-3 hover:text-ink"
    >
      <X aria-hidden className="size-4" />
    </RadixDialog.Close>
  );
}

function rootProps(open?: boolean, onOpenChange?: (open: boolean) => void) {
  return { ...(open === undefined ? {} : { open }), ...(onOpenChange ? { onOpenChange } : {}) };
}

/** Modal dialog: focus trapped, Escape closes, focus returns to the trigger. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  closeLabel,
  children,
  footer,
  initialFocus,
}: OverlayProps) {
  return (
    <RadixDialog.Root {...rootProps(open, onOpenChange)}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content
          {...(initialFocus
            ? {
                onOpenAutoFocus: (e: Event) => {
                  e.preventDefault();
                  initialFocus.current?.focus();
                },
              }
            : {})}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed start-1/2 top-1/2 z-50 grid w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-card ui-glass-pop p-6 rtl:translate-x-1/2"
        >
          <div className="flex items-start gap-3">
            <RadixDialog.Title className="text-lg font-bold tracking-tight">
              {title}
            </RadixDialog.Title>
            <div className="ms-auto">
              <CloseButton label={closeLabel} />
            </div>
          </div>
          {description && (
            <RadixDialog.Description className="text-[13.5px] text-ink-2">
              {description}
            </RadixDialog.Description>
          )}
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Side panel on the inline-end side (right in English, left in Arabic). */
export function Drawer({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  closeLabel,
  children,
  footer,
  side = 'end',
}: OverlayProps) {
  return (
    <RadixDialog.Root {...rootProps(open, onOpenChange)}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={`fixed inset-y-3 z-50 grid w-[min(420px,calc(100vw-24px))] content-start gap-4 overflow-y-auto rounded-card ui-glass-pop p-6 ${side === 'start' ? 'start-3' : 'end-3'}`}
        >
          <div className="flex items-start gap-3">
            <RadixDialog.Title className="text-lg font-bold tracking-tight">
              {title}
            </RadixDialog.Title>
            <div className="ms-auto">
              <CloseButton label={closeLabel} />
            </div>
          </div>
          {description && (
            <RadixDialog.Description className="text-[13.5px] text-ink-2">
              {description}
            </RadixDialog.Description>
          )}
          {children}
          {footer && <div className="mt-auto flex flex-wrap justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className="z-50 max-w-64 rounded-[10px] bg-ink px-2.5 py-1.5 text-xs font-medium text-card shadow-pop"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <RadixTabs.Root defaultValue={items[0]?.value} className="grid gap-4">
      <RadixTabs.List
        aria-label={label}
        className="inline-flex w-fit gap-1 rounded-full border border-line bg-frame p-1"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-2 data-[state=active]:bg-plum data-[state=active]:text-on-plum"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="text-[13.5px] text-ink-2">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

// --- Toasts -------------------------------------------------------------------------------

interface ToastMessage {
  id: number;
  title: string;
  body?: string | undefined;
  tone: 'good' | 'bad';
}

const ToastContext = createContext<((toast: Omit<ToastMessage, 'id'>) => void) | null>(null);

/** Announces outcomes politely to screen readers; disappears after 5 s. */
export function ToastProvider({
  children,
  closeLabel,
}: {
  children: ReactNode;
  closeLabel: string;
}) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const push = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    setToasts((current) => [...current, { ...toast, id: Date.now() + Math.random() }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      <RadixToast.Provider duration={5000}>
        {children}
        {toasts.map((toast) => (
          <RadixToast.Root
            key={toast.id}
            onOpenChange={(open) => {
              if (!open) setToasts((current) => current.filter((t) => t.id !== toast.id));
            }}
            className="ui-toast flex items-start gap-2.5 rounded-[14px] bg-ink p-3.5 text-card shadow-pop"
          >
            {toast.tone === 'good' ? (
              <CircleCheck aria-hidden className="mt-0.5 size-[18px] shrink-0 text-mint-solid" />
            ) : (
              <CircleAlert aria-hidden className="mt-0.5 size-[18px] shrink-0 text-blush-solid" />
            )}
            <div className="grid gap-0.5">
              <RadixToast.Title className="text-[13px] font-bold">{toast.title}</RadixToast.Title>
              {toast.body && (
                <RadixToast.Description className="text-[13px] opacity-85">
                  {toast.body}
                </RadixToast.Description>
              )}
            </div>
            <RadixToast.Close
              aria-label={closeLabel}
              className="ms-auto opacity-70 hover:opacity-100"
            >
              <X aria-hidden className="size-4" />
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed end-5 bottom-5 z-50 grid w-[min(380px,calc(100vw-40px))] gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside ToastProvider');
  return push;
}
