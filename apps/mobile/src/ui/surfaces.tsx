import { type ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './text';
import { radius, space, type ToneName, useTheme } from './theme';

interface ScreenProps {
  children: ReactNode;
  /** Pull-to-refresh handler (lists). */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Without scrolling (camera). */
  fixed?: boolean;
}

/** The page: soft frame, safe-area aware, scrollable, 16 px gutters. */
export function Screen({ children, onRefresh, refreshing = false, fixed = false }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: space.lg,
    paddingBottom: insets.bottom + space.xxl,
    paddingStart: space.lg,
    paddingEnd: space.lg,
  };
  if (fixed) {
    return <View style={[styles.fill, { backgroundColor: theme.frame }, padding]}>{children}</View>;
  }
  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: theme.frame }]}
      contentContainerStyle={[padding, styles.column]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

interface CardProps {
  children: ReactNode;
  title?: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

/** White card, radius 20, hairline border; optional title row with an action. */
export function Card({
  children,
  title,
  action,
  style,
  onPress,
  accessibilityLabel,
  testID,
}: CardProps) {
  const theme = useTheme();
  const body = (
    <>
      {title !== undefined || action !== undefined ? (
        <View style={styles.titleRow}>
          {title !== undefined ? (
            <Text level="heading" accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      ) : null}
      {children}
    </>
  );
  const base = [
    styles.card,
    { backgroundColor: theme.card, borderColor: theme.line },
    style,
  ] as StyleProp<ViewStyle>;
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
        {...(testID === undefined ? {} : { testID })}
        style={({ pressed }) => [base, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View style={base} {...(testID === undefined ? {} : { testID })}>
      {body}
    </View>
  );
}

interface TileProps {
  tone: ToneName;
  label: string;
  value: string;
  hint?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Pastel tile with a heavy number: colour carries meaning (design-system.md §6). */
export function Tile({ tone, label, value, hint, onPress, style }: TileProps) {
  const theme = useTheme();
  const colours = theme[tone];
  const content = (
    <>
      <Text level="caption" color={colours.ink}>
        {label}
      </Text>
      <Text level="number" color={colours.ink}>
        {value}
      </Text>
      {hint !== undefined ? (
        <Text level="caption" color={colours.ink}>
          {hint}
        </Text>
      ) : null}
    </>
  );
  const base = [styles.tile, { backgroundColor: colours.bg }, style];
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [base, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={base}>{content}</View>
  );
}

/** A tappable list row inside a card: title, subtitle, trailing element. */
export function Row({
  title,
  subtitle,
  trailing,
  onPress,
  last = false,
  testID,
}: {
  title: string;
  subtitle?: string | undefined;
  trailing?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const inner = (
    <>
      <View style={styles.rowText}>
        <Text level="label" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text level="caption" tone="ink3" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );
  const base = [styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.line }];
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => [base, pressed && styles.pressed]}
    >
      {inner}
    </Pressable>
  ) : (
    <View style={base} {...(testID === undefined ? {} : { testID })}>
      {inner}
    </View>
  );
}

/** Small coloured pill for a state; always next to its label text. */
export function Chip({ tone, label }: { tone: ToneName | 'neutral'; label: string }) {
  const theme = useTheme();
  const bg = tone === 'neutral' ? theme.line : theme[tone].bg;
  const ink = tone === 'neutral' ? theme.ink2 : theme[tone].ink;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text level="caption" color={ink}>
        {label}
      </Text>
    </View>
  );
}

export function Stack({
  gap = space.md,
  children,
  style,
}: {
  gap?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Inline({
  gap = space.sm,
  children,
  style,
  wrap = false,
}: {
  gap?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  return <View style={[styles.inline, { gap }, wrap && styles.wrap, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { gap: space.lg },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.xl,
    gap: space.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  pressed: { opacity: 0.85 },
  tile: { borderRadius: radius.tile, padding: space.lg, gap: 2, minWidth: 120, flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  rowText: { flex: 1, gap: 2 },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  inline: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
});
