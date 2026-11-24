import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { colors, elevation, radius, space } from '../theme/tokens';
import { copyToClipboard } from '../utils/clipboard';
import { haptic } from '../utils/haptics';
import { Icon, Text } from './ui';

export type ToastTone = 'success' | 'error';
export type ToastMsg = { text: string; tone: ToastTone };

/** Short-lived toast state with the shared 3.5 s auto-dismiss. */
export function useToast(ms = 3500) {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  useEffect(() => { if (!toast) return; const tm = setTimeout(() => setToast(null), ms); return () => clearTimeout(tm); }, [toast, ms]);
  const show = useCallback((text: string, tone: ToastTone = 'success') => setToast({ text, tone }), []);
  return { toast, show };
}

/** Dark surface toast body; positioned by the caller (JourneyScreen footer or Home FAB). */
export function ToastView({ text, tone = 'success', bottom, side }: { text: string; tone?: ToastTone; bottom: number; side: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(160)} pointerEvents="none"
      style={{ position: 'absolute', left: side, right: side, bottom }}>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite"
        style={[{ flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: colors.textStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm }, elevation.raised as object]}>
        <Icon name={tone === 'error' ? 'alert-circle' : 'check-circle'} size={20} color={tone === 'error' ? '#FF8A80' : colors.successBright} />
        <Text variant="bodyStrong" color={colors.onPrimary} style={{ flex: 1 }}>{text}</Text>
      </View>
    </Animated.View>
  );
}

/**
 * Tap-to-copy for a UTR: copies, then success haptic + "UTR copied" toast, or error haptic + error toast.
 * The UTR itself is never logged.
 */
export async function copyUtr(utr: string | undefined | null, show: (text: string, tone?: ToastTone) => void) {
  if (!utr) return;
  const ok = await copyToClipboard(utr);
  if (ok) { haptic.success(); show('UTR copied', 'success'); }
  else { haptic.error(); show("Couldn't copy the UTR", 'error'); }
}
