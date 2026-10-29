import { Check } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type ReactNode } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  /** Second line, e.g. a company's web address. */
  hint?: string | undefined;
  icon?: ReactNode;
  current?: boolean;
  onSelect: () => void;
}

/**
 * Dropdown menu (company switcher, row actions). Keyboard: arrows move, Enter selects,
 * Escape closes, typing jumps to an item; focus returns to the trigger.
 */
export function Menu({
  trigger,
  label,
  items,
  footer,
}: {
  trigger: ReactNode;
  /** Accessible name of the menu. */
  label: string;
  items: MenuItem[];
  /** Items after a separator (e.g. "All companies"). */
  footer?: MenuItem[];
}) {
  const row = (item: MenuItem) => (
    <DropdownMenu.Item
      key={item.key}
      onSelect={item.onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 py-2 text-[13.5px] outline-none data-[highlighted]:bg-frame"
    >
      {item.icon && <span className="text-ink-3 [&>svg]:size-4">{item.icon}</span>}
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-semibold">{item.label}</span>
        {item.hint && (
          <small className="truncate text-[11.5px] text-ink-3" dir="ltr">
            {item.hint}
          </small>
        )}
      </span>
      {item.current && <Check aria-hidden className="size-4 text-plum" />}
    </DropdownMenu.Item>
  );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          align="start"
          sideOffset={6}
          className="z-50 grid min-w-[240px] gap-0.5 rounded-tile border border-line bg-card p-1.5 shadow-pop"
        >
          {items.map(row)}
          {footer && footer.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              {footer.map(row)}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
