import { type ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from './theme';

type Level = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'number' | 'display';

const SIZES: Record<Level, TextStyle> = {
  title: { fontSize: 26, fontWeight: '800', lineHeight: 32 },
  heading: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  label: { fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  caption: { fontSize: 12.5, fontWeight: '500', lineHeight: 17 },
  number: { fontSize: 30, fontWeight: '800', lineHeight: 34, fontVariant: ['tabular-nums'] },
  display: { fontSize: 26, fontWeight: '700', fontStyle: 'italic', lineHeight: 32 },
};

interface TextProps {
  level?: Level;
  tone?: 'ink' | 'ink2' | 'ink3' | 'plum' | 'inherit';
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: ReactNode;
  accessibilityRole?: 'header' | 'text';
}

/** Text with the design system's type scale. Alignment follows the layout direction (I18nManager). */
export function Text({
  level = 'body',
  tone = 'ink',
  color,
  style,
  numberOfLines,
  children,
  accessibilityRole,
}: TextProps) {
  const theme = useTheme();
  const tones = { ink: theme.ink, ink2: theme.ink2, ink3: theme.ink3, plum: theme.plum };
  const resolved = color ?? (tone === 'inherit' ? undefined : tones[tone]);
  return (
    <RNText
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      {...(accessibilityRole === undefined ? {} : { accessibilityRole })}
      style={[SIZES[level], { color: resolved }, style]}
    >
      {children}
    </RNText>
  );
}
