import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '../core/i18n';
import { errorReference, errorText } from '../lib/errors';
import { Button } from './controls';
import { Text } from './text';
import { radius, space, useTheme } from './theme';

/** Every screen shows one of these while loading, when empty, on error or when denied. */

export function Loading() {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={styles.box}
      accessibilityRole="progressbar"
      accessibilityLabel={t('ui.common.loading')}
    >
      <ActivityIndicator color={theme.plum} />
    </View>
  );
}

export function Empty({ title, body }: { title?: string; body?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.box, styles.panel, { backgroundColor: theme.frame }]}>
      <Text level="label" tone="ink2">
        {title ?? t('ui.states.emptyTitle')}
      </Text>
      <Text level="caption" tone="ink3" style={styles.center}>
        {body ?? t('ui.states.emptyBody')}
      </Text>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const reference = errorReference(t, error);
  return (
    <View
      style={[styles.box, styles.panel, { backgroundColor: theme.blush.bg }]}
      accessibilityRole="alert"
    >
      <Text level="label" color={theme.blush.ink}>
        {t('ui.states.errorTitle')}
      </Text>
      <Text level="caption" color={theme.blush.ink} style={styles.center}>
        {errorText(t, error)}
      </Text>
      {reference ? (
        <Text level="caption" color={theme.blush.ink}>
          {reference}
        </Text>
      ) : null}
      {onRetry ? <Button label={t('ui.common.retry')} variant="ghost" onPress={onRetry} /> : null}
    </View>
  );
}

export function Denied() {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.box, styles.panel, { backgroundColor: theme.butter.bg }]}>
      <Text level="label" color={theme.butter.ink}>
        {t('ui.states.deniedTitle')}
      </Text>
      <Text level="caption" color={theme.butter.ink} style={styles.center}>
        {t('ui.states.deniedBody')}
      </Text>
    </View>
  );
}

/** Inline problem under a form (same wording as the error state, without the panel). */
export function FormError({ error }: { error: unknown }) {
  const theme = useTheme();
  const { t } = useI18n();
  if (error === null || error === undefined) return null;
  const reference = errorReference(t, error);
  return (
    <View accessibilityRole="alert" style={styles.formError}>
      <Text level="caption" color={theme.bad}>
        {errorText(t, error)}
        {reference ? ` ${reference}` : ''}
      </Text>
    </View>
  );
}

/** A one-line confirmation after an action (mint, as in the web's success toasts). */
export function Notice({ text, tone = 'mint' }: { text: string; tone?: 'mint' | 'butter' }) {
  const theme = useTheme();
  const colours = theme[tone];
  return (
    <View style={[styles.notice, { backgroundColor: colours.bg }]} accessibilityRole="alert">
      <Text level="label" color={colours.ink}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.xxl,
  },
  panel: { borderRadius: radius.tile, paddingHorizontal: space.lg },
  center: { textAlign: 'center' },
  formError: { paddingVertical: space.xs },
  notice: { borderRadius: radius.tile, padding: space.lg },
});
