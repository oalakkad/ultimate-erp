import { type NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatDate } from '@ultimate-erp/i18n';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useI18n } from '../core/i18n';
import { type RootParamList } from '../core/routes';
import { codeFromScan } from '../lib/scan-link';
import { Button, Field } from '../ui/controls';
import { FormError, Notice } from '../ui/states';
import { Card, Screen, Stack } from '../ui/surfaces';
import { Text } from '../ui/text';
import { radius, space, useTheme } from '../ui/theme';
import { useCheck } from './attendance-shared';

type Props = NativeStackScreenProps<RootParamList, 'Scan'>;

/**
 * Reads the kiosk QR (the web scan link) and records the check-in/out with the code inside it.
 * Each code is valid for one 30-second window and one use per person, so a scan is final.
 */
export function ScanScreen({ navigation }: Props) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const check = useCheck();
  const [rejected, setRejected] = useState(false);
  const [typed, setTyped] = useState('');
  const busy = useRef(false);

  const submit = (data: string) => {
    if (busy.current) return;
    const code = codeFromScan(data);
    if (!code) {
      setRejected(true);
      return;
    }
    busy.current = true;
    setRejected(false);
    check.mutate(code, {
      onSettled: () => {
        busy.current = false;
      },
    });
  };
  const last = check.data?.events.at(-1);
  const cameraPossible = Platform.OS !== 'web';

  return (
    <Screen>
      {last ? (
        <Card>
          <Notice
            text={t(last.kind === 'in' ? 'ui.attendance.recordedIn' : 'ui.attendance.recordedOut', {
              time: formatDate(locale, new Date(last.at), { timeStyle: 'short' }),
            })}
          />
          <Button
            label={t('ui.attendance.myAttendance')}
            onPress={() => {
              navigation.goBack();
            }}
          />
        </Card>
      ) : (
        <Stack>
          <Text tone="ink2">{t('ui.mobile.scanHint')}</Text>
          {cameraPossible ? (
            permission?.granted ? (
              <View style={[styles.camera, { borderColor: theme.line2 }]}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={
                    check.isPending
                      ? undefined
                      : ({ data }) => {
                          submit(data);
                        }
                  }
                />
              </View>
            ) : (
              <Card>
                <Text tone="ink2">{t('ui.mobile.cameraPermission')}</Text>
                <Button
                  label={t('ui.mobile.allowCamera')}
                  onPress={() => {
                    void requestPermission();
                  }}
                />
              </Card>
            )
          ) : (
            <Card>
              <Text tone="ink2">{t('ui.mobile.cameraUnavailable')}</Text>
              <Field
                label={t('ui.auth.code')}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                autoCorrect={false}
                testID="scan-code"
              />
              <Button
                label={t('ui.attendance.confirmScan')}
                loading={check.isPending}
                disabled={typed.trim() === ''}
                onPress={() => {
                  submit(typed);
                }}
                testID="scan-submit"
              />
            </Card>
          )}
          {rejected ? <Notice tone="butter" text={t('ui.mobile.invalidCode')} /> : null}
          <FormError error={check.error} />
          {check.isError ? (
            <Button
              label={t('ui.mobile.scanAgain')}
              variant="ghost"
              onPress={() => {
                check.reset();
              }}
            />
          ) : null}
        </Stack>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: {
    aspectRatio: 1,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    marginVertical: space.sm,
  },
});
