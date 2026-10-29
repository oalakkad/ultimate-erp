import { Dialog } from '@ultimate-erp/ui';
import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../app/i18n.js';
import { type Command, filterCommands } from '../lib/commands.js';

const GROUP_ORDER: Command['group'][] = ['pages', 'actions', 'members'];

/**
 * Ctrl K / ⌘ K palette (brief Phase 2 "global search"): pages, actions and people in one
 * keyboard-first list. Combobox pattern: focus stays in the field, arrows move the active
 * option (aria-activedescendant), Enter runs it, Escape closes.
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: results.filter((c) => c.group === group),
  })).filter((g) => g.items.length > 0);
  const ordered = groups.flatMap((g) => g.items);

  const setOpen = (next: boolean) => {
    if (!next) {
      setQuery('');
      setActive(0);
    }
    onOpenChange(next);
  };

  const run = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, ordered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(ordered[active]);
    }
  };
  const groupLabel = {
    pages: t('ui.palette.groupPages'),
    actions: t('ui.palette.groupActions'),
    members: t('ui.palette.groupMembers'),
  };
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('ui.palette.title')}
      closeLabel={t('ui.common.close')}
      initialFocus={inputRef}
    >
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={ordered.length > 0 ? optionId(active) : undefined}
        aria-label={t('ui.palette.placeholder')}
        placeholder={t('ui.palette.placeholder')}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="h-11 w-full rounded-ctl border border-line-2 bg-card px-3.5 text-[14px] outline-none focus:border-plum"
      />
      <div
        id={listId}
        role="listbox"
        aria-label={t('ui.palette.results')}
        className="grid max-h-[50vh] gap-3 overflow-y-auto"
      >
        {groups.map(({ group, items }) => (
          <div key={group} role="group" aria-label={groupLabel[group]} className="grid gap-0.5">
            <span
              aria-hidden
              className="px-2 text-[11px] font-bold tracking-[0.06em] text-ink-3 uppercase"
            >
              {groupLabel[group]}
            </span>
            {items.map((command) => {
              const index = ordered.indexOf(command);
              return (
                <div
                  key={command.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => {
                    setActive(index);
                  }}
                  onClick={() => {
                    run(command);
                  }}
                  className="grid cursor-pointer rounded-ctl px-2.5 py-2 text-[13.5px] aria-selected:bg-lilac/50"
                >
                  <span className="font-semibold">{command.label}</span>
                  {command.hint && (
                    <small className="text-ink-3" dir="ltr">
                      {command.hint}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {ordered.length === 0 && (
          <p role="status" className="px-2 py-3 text-[13.5px] text-ink-2">
            {t('ui.palette.noResults', { query })}
          </p>
        )}
      </div>
      <small className="text-ink-3">{t('ui.palette.hint')}</small>
    </Dialog>
  );
}
