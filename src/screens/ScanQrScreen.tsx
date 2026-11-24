import React, { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../config/brand';
import { ActivityIndicator, Animated, Linking, View } from 'react-native';
import { StackActions, useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Icon, PressableScale, Text } from '../components/ui';
import { PRODUCTS } from '../config/products';
import { offers } from '../services';
import { useApp } from '../state/AppState';
import { colors, radius, space, touch } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { HeaderDockSlot } from '../components/assistant/HeaderDockSlot';
import { HeaderVoiceMic } from '../voice/HeaderVoiceMic';
import { ZippyTipSlot } from '../components/assistant/ZippyTipSlot';

const FRAME = 260;

/**
 * Live camera QR scanner (expo-camera CameraView barcode scanning, QR only).
 * The customer's IDFC FIRST app QR carries a signed offer token → resolveOfferFromQr.
 * Handles: permission loading / ask / denied (retry + open settings), mount errors, bad QR.
 * "Simulate successful scan" is shown in every build (live QR isn't switched on yet) and resolves a demo token.
 * Zippy's tip appears above the bottom buttons (ZippyTipSlot), never over the frame.
 */
export default function ScanQrScreen() {
  const nav = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { product, condition, startJourney } = useApp();
  const [perm, requestPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const locked = useRef(false); // one scan at a time
  const asked = useRef(false);
  const line = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(line, { toValue: 1, duration: 1400, useNativeDriver: true }),
      Animated.timing(line, { toValue: 0, duration: 1400, useNativeDriver: true }),
    ]));
    loop.start(); return () => loop.stop();
  }, [line]);

  // Ask once automatically when the dealer opens the scanner for the first time.
  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain && perm.status === 'undetermined' && !asked.current) { asked.current = true; requestPerm(); }
  }, [perm, requestPerm]);

  const resolve = async (payload: string) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setErr(null);
    const r = await offers.resolveOfferFromQr(payload, product, condition);
    setBusy(false);
    if (r.ok) {
      // v1.2.8: celebrate the pre-approved offer (~1.6 s, automatic), then Vehicle & EMI. Replacing the scanner
      // means back from Asset goes Home, not into the camera; OfferReveal owns the haptics.
      startJourney(r.data); nav.dispatch(StackActions.replace('OfferReveal')); setTimeout(() => { locked.current = false; }, 800); return;
    }
    haptic.error(); setErr(r.message);
    setTimeout(() => { locked.current = false; }, 1500); // let the dealer re-aim
  };
  const onScan = (res: BarcodeScanningResult) => { if (!locked.current && res.data) resolve(res.data); };

  const granted = !!perm?.granted;
  const denied = !!perm && !perm.granted && perm.status === 'denied';
  const p = PRODUCTS[product];

  return (
    <View style={{ flex: 1, backgroundColor: '#0E0E10' }}>
      {granted && focused && !camErr && (
        <CameraView style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy ? undefined : onScan}
          onMountError={(e) => setCamErr(e.message || 'Camera could not start.')} accessibilityLabel="Camera viewfinder" />
      )}
      {/* dim outside the frame */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: granted && !camErr ? 'rgba(0,0,0,0.35)' : 'transparent' }} />

      <View style={{ paddingTop: insets.top, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs }}>
        <PressableScale onPress={() => nav.goBack()} accessibilityRole="button" accessibilityLabel="Close scanner" style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={28} color="#fff" />
        </PressableScale>
        {/* Left spacer balances the two right-hand slots, so the title stays centred. */}
        <View style={{ width: touch.min }} />
        <Text variant="h3" color="#fff" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>Scan Customer QR</Text>
        <HeaderDockSlot size={touch.min} />
        <HeaderVoiceMic onDark />
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.lg }}>
        {!perm ? (
          <ActivityIndicator color="#fff" accessibilityLabel="Checking camera permission" />
        ) : !granted || camErr ? (
          <PermissionCard denied={denied || !perm.canAskAgain} camErr={camErr}
            onAllow={async () => { setCamErr(null); const r = await requestPerm(); if (!r.granted && !r.canAskAgain) haptic.error(); }}
            onSettings={() => { Linking.openSettings().catch(() => {}); }} />
        ) : (
          <>
            <Text variant="body" color="rgba(255,255,255,0.92)" style={{ textAlign: 'center' }}>
              Point at the {condition === 'used' ? 'used ' : ''}{p.label.toLowerCase()} offer QR in the customer's IDFC FIRST app
            </Text>
            <View style={{ width: FRAME, height: FRAME }} accessibilityLabel="Scanning frame">
              <View style={{ flex: 1, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }}>
                <Animated.View style={{ position: 'absolute', left: 16, right: 16, height: 2, backgroundColor: colors.cta, top: 16, transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME - 34] }) }] }} />
              </View>
              {[0, 1, 2, 3].map((c) => (
                <View key={c} style={{ position: 'absolute', width: 40, height: 40, borderColor: colors.cta,
                  top: c < 2 ? 0 : undefined, bottom: c >= 2 ? 0 : undefined, left: c % 2 === 0 ? 0 : undefined, right: c % 2 === 1 ? 0 : undefined,
                  borderTopWidth: c < 2 ? 4 : 0, borderBottomWidth: c >= 2 ? 4 : 0, borderLeftWidth: c % 2 === 0 ? 4 : 0, borderRightWidth: c % 2 === 1 ? 4 : 0, borderRadius: 6 }} />
              ))}
              {busy && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: radius.lg, gap: space.xs }}>
                  <ActivityIndicator color="#fff" /><Text variant="label" color="#fff">Reading offer…</Text>
                </View>
              )}
            </View>
            {err ? (
              <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center', backgroundColor: 'rgba(196,40,40,0.9)', borderRadius: radius.md, padding: space.sm }} accessibilityRole="alert">
                <Icon name="alert-circle-outline" size={20} color="#fff" /><Text variant="caption" color="#fff" style={{ flex: 1 }}>{err}</Text>
              </View>
            ) : (
              <Text variant="caption" color="rgba(255,255,255,0.75)">Hold steady · scans automatically</Text>
            )}
          </>
        )}
      </View>

      <ZippyTipSlot onDark />
      <View style={{ padding: space.md, paddingBottom: Math.max(insets.bottom, space.md), gap: space.xxs }}>
        <Button label="Search by mobile number instead" variant="secondary" icon="cellphone-text" onPress={() => nav.navigate('SearchMobile', { stage: 'enter' })} />
        {/* Always visible (release too): live QR isn't switched on yet, so dealers continue the QR journey with a demo offer. */}
        <Button label="Simulate successful scan" variant="secondary" icon="qrcode-scan" onPress={() => resolve('MOCK_SIGNED_TOKEN')}
          accessibilityHint="Continues with a demo offer, as if the customer's QR was read" />
      </View>
    </View>
  );
}

function PermissionCard({ denied, camErr, onAllow, onSettings }: { denied: boolean; camErr: string | null; onAllow: () => void; onSettings: () => void }) {
  return (
    <View style={{ alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.lg, gap: space.sm, alignItems: 'center' }} accessibilityRole="alert">
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={camErr ? 'camera-off-outline' : 'camera-outline'} size={36} color={colors.primary} />
      </View>
      <Text variant="h3" style={{ textAlign: 'center' }}>{camErr ? "Camera couldn't start" : denied ? 'Camera access is off' : 'Allow camera to scan QR'}</Text>
      <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
        {camErr ?? (denied
          ? `${APP_NAME} needs the camera to read the customer's offer QR. Turn on Camera for ${APP_NAME} in Settings, then come back and tap Try again.`
          : `Here, ${APP_NAME} uses the camera only to read the customer's offer QR (it is also used for RC photos and face e-KYC). Nothing is recorded or stored.`)}
      </Text>
      <View style={{ alignSelf: 'stretch', gap: space.xs, marginTop: space.xs }}>
        {denied && <Button label="Open Settings" icon="cog-outline" onPress={onSettings} />}
        <Button label={denied || camErr ? 'Try again' : 'Allow camera'} variant={denied ? 'secondary' : 'primary'} icon="camera" onPress={onAllow} />
      </View>
    </View>
  );
}
