import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Switch,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { Text } from './text';
import { radius, space, useTheme } from './theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: ReactNode;
  testID?: string;
}

/** One plum primary action per area; ghost for the rest; danger for destructive ones. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  icon,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;
  const colours = {
    primary: { bg: theme.plum, fg: theme.onPlum, border: theme.plum },
    ghost: { bg: theme.card, fg: theme.ink, border: theme.line2 },
    danger: { bg: theme.blush.bg, fg: theme.blush.ink, border: theme.blush.bg },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colours.bg, borderColor: colours.border },
        pressed && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colours.fg} /> : icon}
      <Text level="label" color={colours.fg}>
        {label}
      </Text>
    </Pressable>
  );
}

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  testID?: string;
}

/** Labelled text input with error and hint lines (radius 12, hairline border, plum on focus). */
export function Field({ label, error, hint, testID, ...input }: FieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text level="label" tone="ink2">
        {label}
      </Text>
      <TextInput
        {...input}
        {...(testID === undefined ? {} : { testID })}
        accessibilityLabel={label}
        placeholderTextColor={theme.ink3}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            backgroundColor: theme.card,
            color: theme.ink,
            borderColor: error ? theme.bad : focused ? theme.plum : theme.line2,
          },
          input.multiline === true && styles.multiline,
        ]}
      />
      {error ? (
        <Text level="caption" color={theme.bad}>
          {error}
        </Text>
      ) : hint ? (
        <Text level="caption" tone="ink3">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** A labelled on/off switch. */
export function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text level="label">{label}</Text>
        {hint ? (
          <Text level="caption" tone="ink3">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: theme.plum, false: theme.line2 }}
      />
    </View>
  );
}

/** A horizontal set of choices, one selected (segmented control). */
export function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segments, { backgroundColor: theme.line }]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              onChange(option.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && { backgroundColor: theme.card }]}
          >
            <Text level="caption" tone={selected ? 'ink' : 'ink2'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A list of choices shown as selectable rows (replaces a native picker: works everywhere). */
export function Choices<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (next: T) => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text level="label" tone="ink2">
        {label}
      </Text>
      <View style={[styles.choices, { borderColor: theme.line2 }]}>
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                onChange(option.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={[
                styles.choice,
                index < options.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: theme.line,
                },
                selected && { backgroundColor: theme.lilac.bg },
              ]}
            >
              <View style={[styles.radio, { borderColor: selected ? theme.plum : theme.line2 }]}>
                {selected ? (
                  <View style={[styles.radioDot, { backgroundColor: theme.plum }]} />
                ) : null}
              </View>
              <View style={styles.toggleText}>
                <Text level="label">{option.label}</Text>
                {option.hint ? (
                  <Text level="caption" tone="ink3">
                    {option.hint}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.55 },
  field: { gap: 6 },
  input: {
    minHeight: 46,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  toggleText: { flex: 1, gap: 2 },
  segments: { flexDirection: 'row', borderRadius: radius.control, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    borderRadius: radius.control - 3,
    paddingVertical: 8,
    alignItems: 'center',
  },
  choices: { borderWidth: 1, borderRadius: radius.control, overflow: 'hidden' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: 12 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
