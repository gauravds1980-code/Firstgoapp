import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, interpolate, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { colors, radius, space } from '../../theme/tokens';
import { haptic } from '../../utils/haptics';
import { Icon, IconName, Text } from '../ui';
import { ArcRing, BRAND, DrawPath, Particle, seeded } from './primitives';

// Shield outline (≈ 190 units long) and check (≈ 62) in a 100×100 box.
const SHIELD = 'M50 14 L78 25 V48 C78 66 66 79 50 86 C34 79 22 66 22 48 V25 Z';
const SHIELD_LEN = 200;
const CHECK = 'M33 51 L45 63 L68 39';
const CHECK_LEN = 52;

export interface WaiverItem { icon: IconName; title: string; detail: string }

/**
 * ETB waiver motion — one beat-synced sequence, then auto-advance (no tap):
 *  0.00s disc springs in · 0.15s gold shield draws itself while a gold arc sweeps ("checking bank records…")
 *  0.95s disc turns green, shield fades, check draws with spring overshoot, sparks burst  → haptic success
 *  1.05s+ rows tick in one by one (combined KYC + mandate) → haptic tick per row
 *  ~2.4s (2.9s combined) onDone()
 * Reduced motion: no movement, final state shown, advance after 1.2s.
 */
export function WaiverMotion({ title, subtitle, items, onDone }: { title: string; subtitle: string; items: WaiverItem[]; onDone: () => void }) {
  const reduce = useReducedMotion();
  const enter = useSharedValue(reduce ? 1 : 0);
  const shield = useSharedValue(reduce ? 1 : 0);
  const arc = useSharedValue(reduce ? 1 : 0);
  const morph = useSharedValue(reduce ? 1 : 0);
  const check = useSharedValue(reduce ? 1 : 0);
  const sparks = useSharedValue(0);
  const [status, setStatus] = useState(reduce ? 1 : 0); // 0 checking, 1 verified
  const [rows, setRows] = useState(reduce ? items.length : 0);
  const total = reduce ? 1200 : 2400 + Math.max(0, items.length - 1) * 450;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    if (!reduce) {
      enter.value = withSpring(1, { damping: 11, stiffness: 140 });
      shield.value = withDelay(150, withTiming(1, { duration: 650, easing: Easing.inOut(Easing.cubic) }));
      arc.value = withDelay(150, withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }));
      morph.value = withDelay(950, withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }));
      check.value = withDelay(1000, withTiming(1, { duration: 320, easing: Easing.out(Easing.back(1.6)) }));
      sparks.value = withDelay(1000, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
      at(180, () => haptic.tap());
      at(1000, () => { haptic.success(); setStatus(1); });
      items.forEach((_, i) => at(1150 + i * 450, () => { setRows(i + 1); if (i > 0) haptic.tap(); }));
    } else {
      haptic.success();
    }
    at(total, onDone);
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const disc = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(morph.value, [0, 1], [BRAND.maroon, BRAND.success]),
    transform: [{ scale: interpolate(enter.value, [0, 1], [0.55, 1]) * interpolate(check.value, [0, 0.6, 1], [1, 1.08, 1]) }],
    opacity: enter.value,
  }));
  const shieldWrap = useAnimatedStyle(() => ({ opacity: 1 - morph.value, transform: [{ scale: interpolate(morph.value, [0, 1], [1, 0.6]) }] }));
  const checkWrap = useAnimatedStyle(() => ({ opacity: morph.value }));
  const arcWrap = useAnimatedStyle(() => ({ opacity: 1 - morph.value }));
  const halo = useAnimatedStyle(() => ({ opacity: interpolate(sparks.value, [0, 0.2, 1], [0, 0.5, 0]), transform: [{ scale: interpolate(sparks.value, [0, 1], [0.9, 1.5]) }] }));
  const sparkList = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    angle: (i / 14) * Math.PI * 2 + seeded(i) * 0.3, speed: 70 + seeded(i, 2) * 40, color: [BRAND.gold, BRAND.white, BRAND.goldLight, BRAND.success][i % 4]!, size: 5 + seeded(i, 3) * 5,
  })), []);

  return (
    <View style={{ alignItems: 'center', gap: space.lg, paddingVertical: space.lg }} accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${subtitle}`}>
      <View style={{ width: 210, height: 210, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 3, borderColor: BRAND.success }, halo]} />
        {!reduce && sparkList.map((s, i) => <Particle key={i} t={sparks} angle={s.angle} speed={s.speed} color={s.color} w={s.size} h={s.size} spin={0} gravity={30} />)}
        <Animated.View style={[{ position: 'absolute', width: 184, height: 184, alignItems: 'center', justifyContent: 'center' }, arcWrap]}>
          <ArcRing size={184} stroke={BRAND.gold} width={5} progress={arc} track="rgba(239,168,52,0.15)" />
        </Animated.View>
        <Animated.View style={[{ width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, disc]}>
          <Animated.View style={[{ position: 'absolute' }, shieldWrap]}>
            <Svg width={96} height={96} viewBox="0 0 100 100"><DrawPath d={SHIELD} length={SHIELD_LEN} progress={shield} stroke={BRAND.gold} width={6} /></Svg>
          </Animated.View>
          <Animated.View style={checkWrap}>
            <Svg width={96} height={96} viewBox="0 0 100 100"><DrawPath d={CHECK} length={CHECK_LEN} progress={check} stroke={BRAND.white} width={9} /></Svg>
          </Animated.View>
        </Animated.View>
      </View>

      <View style={{ alignItems: 'center', gap: space.xs, paddingHorizontal: space.lg, minHeight: 72 }}>
        {status === 0 ? (
          <Animated.View key="checking" entering={FadeIn.duration(200)}>
            <Text variant="h3" color={colors.textSecondary} style={{ textAlign: 'center' }}>Checking bank records…</Text>
          </Animated.View>
        ) : (
          <Animated.View key="done" entering={reduce ? undefined : FadeInDown.springify().damping(14)} style={{ alignItems: 'center', gap: space.xs }}>
            <Text variant="h2" style={{ textAlign: 'center' }}>{title}</Text>
            <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>{subtitle}</Text>
          </Animated.View>
        )}
      </View>

      <View style={{ alignSelf: 'stretch', gap: space.xs, paddingHorizontal: space.md, minHeight: items.length * 64 }}>
        {items.slice(0, rows).map((it, i) => (
          <Animated.View key={it.title} entering={reduce ? undefined : FadeInDown.delay(i === 0 ? 0 : 0).springify().damping(15)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: 'rgba(0,160,122,0.25)' }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={it.icon} size={20} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{it.title}</Text>
              <Text variant="caption" color={colors.textSecondary}>{it.detail}</Text>
            </View>
            <RowTick />
          </Animated.View>
        ))}
      </View>
      <Text variant="caption" color={colors.textMuted}>Step{items.length > 1 ? 's' : ''} skipped · continuing automatically</Text>
    </View>
  );
}

function RowTick() {
  const reduce = useReducedMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => { if (!reduce) p.value = withSequence(withDelay(120, withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }))); }, [p, reduce]);
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: BRAND.success, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={22} height={22} viewBox="0 0 100 100"><DrawPath d={CHECK} length={CHECK_LEN} progress={p} stroke={BRAND.white} width={12} /></Svg>
    </View>
  );
}
