import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Checkbox as RadixCheckbox, Select as RadixSelect } from 'radix-ui';
import {
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from 'react';
import { cn } from '../lib/cn.js';

const CONTROL =
  'w-full rounded-ctl border border-line-2 bg-card px-3.5 text-ink placeholder:text-ink-3 ' +
  'transition-[border-color,box-shadow] duration-150 focus-visible:border-focus focus-visible:outline-none ' +
  'focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus)_25%,transparent)] ' +
  'aria-invalid:border-bad disabled:opacity-60';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optionalLabel?: string | undefined;
  /** A small link or button at the end of the label row, e.g. "Forgot password?". */
  labelAction?: ReactNode;
  children: ReactNode;
}

/** Label, hint and error wiring shared by all fields (aria-describedby, aria-invalid). */
function FieldShell({
  id,
  label,
  hint,
  error,
  optionalLabel,
  labelAction,
  children,
}: FieldShellProps) {
  const labelEl = (
    <label htmlFor={id} className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
      {label}
      {optionalLabel && <span className="text-xs font-medium text-ink-3">{optionalLabel}</span>}
    </label>
  );
  return (
    <div className="grid gap-1.5">
      {labelAction ? (
        <div className="flex items-baseline justify-between gap-3">
          {labelEl}
          <span className="text-[12.5px]">{labelAction}</span>
        </div>
      ) : (
        labelEl
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[12.5px] font-medium text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /** Shown next to the label when the field is not required, e.g. "Optional". */
  optionalLabel?: string | undefined;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hint,
  error,
  optionalLabel,
  className,
  ...props
}: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(CONTROL, 'h-11', className)}
        {...props}
      />
    </FieldShell>
  );
}

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type'> {
  /** Accessible names of the eye button, e.g. "Show password" / "Hide password". */
  showLabel: string;
  hideLabel: string;
  labelAction?: ReactNode;
}

/** A password input with a show/hide button at its end (mirrors in RTL via logical padding). */
export function PasswordField({
  label,
  hint,
  error,
  optionalLabel,
  labelAction,
  showLabel,
  hideLabel,
  className,
  ...props
}: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optionalLabel={optionalLabel}
      labelAction={labelAction}
    >
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(CONTROL, 'h-11 pe-11', className)}
          {...props}
        />
        <button
          type="button"
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          aria-controls={id}
          title={visible ? hideLabel : showLabel}
          onClick={() => {
            setVisible((v) => !v);
          }}
          className="absolute inset-y-0 end-0 grid w-11 place-items-center rounded-e-ctl text-ink-3 transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
        >
          {visible ? (
            <EyeOff aria-hidden className="size-[18px]" strokeWidth={1.8} />
          ) : (
            <Eye aria-hidden className="size-[18px]" strokeWidth={1.8} />
          )}
        </button>
      </div>
    </FieldShell>
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optionalLabel?: string | undefined;
}

export function TextArea({
  label,
  hint,
  error,
  optionalLabel,
  className,
  ...props
}: TextAreaProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(CONTROL, 'min-h-24 py-2.5', className)}
        {...props}
      />
    </FieldShell>
  );
}

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Keep the label for screen readers only (e.g. in a table whose header says it). */
  hideLabel?: boolean;
}

export function Checkbox({ label, onCheckedChange, hideLabel = false, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5">
      <RadixCheckbox.Root
        id={id}
        onCheckedChange={(value) => onCheckedChange?.(value === true)}
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-md border border-line-2 bg-card',
          'data-[state=checked]:border-plum data-[state=checked]:bg-plum data-[state=checked]:text-on-plum',
        )}
        {...props}
      >
        <RadixCheckbox.Indicator>
          <Check aria-hidden className="size-3.5 stroke-3" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-[13.5px] text-ink'}>
        {label}
      </label>
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  placeholder: string;
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  /** E.g. while the options are still loading (an empty open list would not refresh). */
  disabled?: boolean | undefined;
}

/** Accessible select (Radix): keyboard, typeahead, right-to-left aware via DirectionProvider. */
export function SelectField({
  label,
  placeholder,
  options,
  value,
  onValueChange,
  hint,
  error,
  disabled,
}: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <RadixSelect.Root
        {...(disabled ? { disabled: true } : {})}
        {...(value === undefined ? {} : { value })}
        {...(onValueChange ? { onValueChange } : {})}
      >
        <RadixSelect.Trigger
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(
            CONTROL,
            'flex h-11 items-center justify-between gap-2 text-start data-placeholder:text-ink-3',
          )}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon>
            <ChevronDown aria-hidden className="size-4 text-ink-3" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={6}
            className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-ctl ui-glass-pop p-1 shadow-pop"
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-[13.5px] text-ink outline-none data-highlighted:bg-frame"
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <Check aria-hidden className="size-4 text-plum" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </FieldShell>
  );
}
