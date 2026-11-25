import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Platform, Pressable, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Defs, Ellipse, Mask, Rect } from 'react-native-svg';
import { APP_NAME } from '../config/brand';
import { HeaderDockSlot } from './assistant/HeaderDockSlot';
import { HeaderVoiceMic } from '../voice/HeaderVoiceMic';
import { Button, Icon, PressableScale, Text } from './ui';
import { colors, radius, space, touch } from '../theme/tokens';

/** Oval face guide (dp). Portrait oval, roughly a face at arm's length. */
const OVAL_W = 236;
const OVAL_H = 304;
/** Simulated blink: this long after the "Okay, blink" prompt is up (no native face detector in this build). */
const BLINK_AFTER_MS = 3000;
/** If the preview never reports ready (simulator without a camera), carry on with the placeholder after this. */
const READY_TIMEOUT_MS = 4000;

export type FacePhase = 'live' | 'passed' | 'error';

/**
 * Front-camera face e-KYC capture (expo-camera CameraView, facing="front").
 * Oval guide + IDFC overlay. Once the preview is ready the prompt reads "Okay, blink".
 * Blink is SIMULATED: BLINK_AFTER_MS after the prompt shows, or on a hidden tap on the oval.
 * There is deliberately no Continue / Next button: the parent auto-advances after the success beat.
 * Web, camera mount errors and simulators fall back to a placeholder behind the oval.
 */
export function FaceCapture({ phase, error, onBlink, onClose, onRetry }: {
  phase: FacePhase; error?: string; onBlink: () => void; onClose: () => void; onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [perm, requestPerm] = useCameraPermissions();
  const [camErr, setCamErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const asked = useRef(false);
  const blinked = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const web = Platform.OS === 'web';
  const granted = !!perm?.granted;
  const denied = !!perm && !perm.granted && (perm.status === 'denied' || !perm.canAskAgain);
  // Placeholder mode: no real preview, but the oval + status + blink fallback still run (screenshots, web, simulator).
  const placeholder = web || !!camErr;
  const showCamera = !web && granted && focused && !camErr;
  const needsPermission = !web && !!perm && !granted;

  // Ask once automatically when capture opens.
  useEffect(() => {
    if (web || !perm || perm.granted || asked.current) return;
    if (perm.canAskAgain && perm.status === 'undetermined') { asked.current = true; requestPerm(); }
  }, [web, perm, requestPerm]);

  // Placeholder is "ready" straight away; a real preview waits for onCameraReady (with a timeout for simulators).
  useEffect(() => {
    if (placeholder) { setReady(true); return; }
    if (!showCamera) return;
    const t = setTimeout(() => setReady(true), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [placeholder, showCamera]);

  // Fresh attempt (retry) → allow another blink.
  useEffect(() => { if (phase === 'live') blinked.current = false; }, [phase]);

  const blink = () => {
    if (blinked.current || phase !== 'live' || !ready) return;
    blinked.current = true; onBlink();
  };

  // Simulated blink a few seconds after the prompt is up.
  useEffect(() => {
    if (!ready || phase !== 'live' || needsPermission) return;
    const t = setTimeout(blink, BLINK_AFTER_MS);
    return () => clearTimeout(t);
  }, [ready, phase, needsPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gentle breathing ring while waiting for the blink.
  useEffect(() => {
    if (phase !== 'live') { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]));
    loop.start(); return () => loop.stop();
  }, [phase, pulse]);

  const ring = phase === 'passed' ? colors.successBright : phase === 'error' ? colors.danger : ready ? colors.cta : 'rgba(255,255,255,0.7)';
  const status = phase === 'passed' ? 'Liveness passed'
    : phase === 'error' ? 'Face capture failed'
    : ready ? 'Okay, blink' : 'Starting camera…';
  const sub = phase === 'passed' ? 'Fetching e-KYC from UIDAI · moving to mandate'
    : phase === 'error' ? (error || 'Please try again in better light.')
    : ready ? 'Keep the face inside the oval and blink once.' : 'Hold the phone at eye level, about an arm’s length away.';

  // Oval centre sits a little above the middle of the preview area.
  const cx = box.w / 2;
  const cy = box.h * 0.44;

  return (
    <View style={{ flex: 1, backgroundColor: '#0E0E10' }}>
      <View style={{ flex: 1 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {showCamera && (
          <CameraView style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} facing="front"
            onCameraReady={() => setReady(true)}
            onMountError={(e) => setCamErr(e.message || 'Camera could not start.')} accessibilityLabel="Front camera preview" />
        )}
        {placeholder && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: cy - 90, alignItems: 'center' }}>
            <Icon name="face-man-outline" size={180} color="rgba(255,255,255,0.12)" />
          </View>
        )}

        {/* Dim everything outside the oval; draw the guide ring on top. */}
        {box.w > 0 && !needsPermission && (
          <Svg width={box.w} height={box.h} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
            <Defs>
              <Mask id="faceHole">
                <Rect x={0} y={0} width={box.w} height={box.h} fill="#fff" />
                <Ellipse cx={cx} cy={cy} rx={OVAL_W / 2} ry={OVAL_H / 2} fill="#000" />
              </Mask>
            </Defs>
            <Rect x={0} y={0} width={box.w} height={box.h} fill="rgba(14,14,16,0.72)" mask="url(#faceHole)" />
            <Ellipse cx={cx} cy={cy} rx={OVAL_W / 2} ry={OVAL_H / 2} stroke={ring} strokeWidth={4} fill="none" />
          </Svg>
        )}

        {/* Breathing halo + hidden tap target (secret blink for demos; deliberately unlabelled as a button). */}
        {box.w > 0 && !needsPermission && (
          <Pressable onPress={blink} accessible={false}
            style={{ position: 'absolute', left: cx - OVAL_W / 2, top: cy - OVAL_H / 2, width: OVAL_W, height: OVAL_H, alignItems: 'center', justifyContent: 'center' }}>
            {phase === 'live' && ready && (
              <Animated.View pointerEvents="none" style={{ position: 'absolute', top: -10, left: -10, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.7] }) }}>
                <Svg width={OVAL_W + 20} height={OVAL_H + 20}>
                  <Ellipse cx={OVAL_W / 2 + 10} cy={OVAL_H / 2 + 10} rx={OVAL_W / 2 + 8} ry={OVAL_H / 2 + 8} stroke={colors.cta} strokeWidth={2} fill="none" />
                </Svg>
              </Animated.View>
            )}
            {phase === 'passed' && (
              <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.successBright, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check-bold" size={52} color="#fff" />
              </View>
            )}
          </Pressable>
        )}

        {/* Top bar */}
        <View style={{ paddingTop: insets.top, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs }}>
          <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close face capture" style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={28} color="#fff" />
          </PressableScale>
          {/* Left spacer balances the two right-hand slots (Zippy + mic), so the title stays centred. */}
          <View style={{ width: touch.min }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="h3" color="#fff">Face e-KYC</Text>
            <Text variant="caption" color="rgba(255,255,255,0.75)" numberOfLines={1}>Aadhaar face match</Text>
          </View>
          <HeaderDockSlot />
          <HeaderVoiceMic onDark />
        </View>

        {needsPermission && (
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space.lg }}>
            <CameraPermissionCard denied={denied}
              onAllow={async () => { setCamErr(null); await requestPerm(); }}
              onSettings={() => { Linking.openSettings().catch(() => {}); }} />
          </View>
        )}
        {!web && !perm && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#fff" accessibilityLabel="Checking camera permission" />
          </View>
        )}
      </View>

      {/* Status panel: maroon/gold IDFC treatment. No Continue / Next here — success auto-advances. */}
      {!needsPermission && (
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.md), gap: space.sm }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.cta }} />
          <Pressable onPress={blink} accessible={false}>
            <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={`${status}. ${sub}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                backgroundColor: phase === 'passed' ? colors.successSoft : phase === 'error' ? colors.dangerSoft : colors.primaryTint }}>
                {phase === 'live' && !ready ? <ActivityIndicator color={colors.primary} />
                  : <Icon name={phase === 'passed' ? 'check-decagram' : phase === 'error' ? 'alert-circle-outline' : 'eye-outline'} size={26}
                      color={phase === 'passed' ? colors.success : phase === 'error' ? colors.danger : colors.primary} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h2" color={phase === 'passed' ? colors.success : phase === 'error' ? colors.danger : colors.primary}>{status}</Text>
                <Text variant="caption" color={colors.textSecondary}>{sub}</Text>
              </View>
            </View>
          </Pressable>
          {placeholder && phase === 'live' && (
            <Text variant="caption" color={colors.textMuted}>{web ? 'Camera preview is not available on web — placeholder shown.' : 'Camera unavailable — placeholder shown.'}</Text>
          )}
          {phase === 'error' && <Button label="Retry face capture" icon="refresh" onPress={onRetry} />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name="shield-lock-outline" size={16} color={colors.textSecondary} />
            <Text variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>Nothing is stored on this phone. Verified by UIDAI for IDFC FIRST Bank.</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function CameraPermissionCard({ denied, onAllow, onSettings }: { denied: boolean; onAllow: () => void; onSettings: () => void }) {
  return (
    <View style={{ alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.lg, gap: space.sm, alignItems: 'center' }} accessibilityRole="alert">
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="camera-front-variant" size={36} color={colors.primary} />
      </View>
      <Text variant="h3" style={{ textAlign: 'center' }}>{denied ? 'Camera access is off' : 'Allow camera for face e-KYC'}</Text>
      <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
        {denied
          ? `${APP_NAME} needs the front camera for the customer's face e-KYC. Turn on Camera for ${APP_NAME} in Settings, then come back and tap Try again.`
          : `${APP_NAME} uses the front camera only for the customer's liveness check. Nothing is recorded or stored.`}
      </Text>
      <View style={{ alignSelf: 'stretch', gap: space.xs, marginTop: space.xs }}>
        {denied && <Button label="Open Settings" icon="cog-outline" onPress={onSettings} />}
        <Button label={denied ? 'Try again' : 'Allow camera'} variant={denied ? 'secondary' : 'primary'} icon="camera" onPress={onAllow} />
      </View>
    </View>
  );
}
