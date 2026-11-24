import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { colors, space } from '../../theme/tokens';
import { fmtDuration } from '../../utils/finance';
import { haptic, hapticMoment } from '../../utils/haptics';
import { Icon, Text } from '../ui';
import { ArcRing, BRAND, DrawPath, Particle, PulseRing, seeded } from './primitives';

const CHECK = 'M30 52 L44 66 L71 37';
const CONFETTI = [BRAND.maroon, BRAND.gold, BRAND.success, BRAND.yellow, BRAND.goldLight, BRAND.maroon];

/**
 * Hero beat for the final screen (≈2.2s, then rests):
 *  0.00 seal springs in (overshoot)  → haptic success
 *  0.25 white check draws itself · 0.30 confetti burst (ballistic, brand colours, one burst only)
 *  0.35 stopwatch arc draws while the clock counts up to the real elapsed time → haptic tick at the end
 *  gold ring pulses ×3 then stops (receipt stays the loudest thing on screen)
 */
export function DisbursalHero({ totalSec }: { totalSec: number }) {
  const reduce = useReducedMotion();
  const seal = useSharedValue(reduce ? 1 : 0);
  const check = useSharedValue(reduce ? 1 : 0);
  const burst = useSharedValue(0);
  const arc = useSharedValue(reduce ? 1 : 0);
  const [shown, setShown] = useState(reduce ? totalSec : 0);

  useEffect(() => {
    hapticMoment.disbursalComplete();
    if (reduce) return;
    seal.value = withSpring(1, { damping: 9, stiffness: 160, mass: 0.9 });
    check.value = withDelay(250, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
    burst.value = withDelay(300, withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }));
    arc.value = withDelay(350, withTiming(1, { duration: 1700, easing: Easing.out(Easing.cubic) }));
    // Count-up on the JS thread with rAF (text), synced to the arc.
    let raf = 0; const start = Date.now() + 350; const dur = 1700;
    const tick = () => {
      const k = Math.min(1, Math.max(0, (Date.now() - start) / dur));
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(totalSec * eased));
      if (k < 1) raf = requestAnimationFrame(tick); else haptic.tap();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sealStyle = useAnimatedStyle(() => ({ transform: [{ scale: seal.value }], opacity: interpolate(seal.value, [0, 0.3], [0, 1], 'clamp') }));
  const confetti = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    angle: -Math.PI / 2 + (seeded(i) - 0.5) * Math.PI * 1.7, speed: 120 + seeded(i, 2) * 110, color: CONFETTI[i % CONFETTI.length]!,
    w: 6 + seeded(i, 3) * 5, h: i % 3 === 0 ? 6 : 12 + seeded(i, 4) * 6, spin: (seeded(i, 5) - 0.5) * 900, delay: seeded(i, 6) * 0.12,
  })), []);

  return (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <View style={{ width: 260, height: 180, alignItems: 'center', justifyContent: 'center' }}>
        {!reduce && <PulseRing size={118} color={BRAND.gold} count={3} delay={400} />}
        {!reduce && <PulseRing size={118} color={BRAND.gold} count={3} delay={1050} />}
        {!reduce && confetti.map((c, i) => <Particle key={i} t={burst} angle={c.angle} speed={c.speed} color={c.color} w={c.w} h={c.h} spin={c.spin} gravity={240} delay={c.delay} />)}
        <Animated.View style={[{ width: 112, height: 112, borderRadius: 56, backgroundColor: BRAND.success, borderWidth: 5, borderColor: BRAND.white, alignItems: 'center', justifyContent: 'center', shadowColor: BRAND.success, shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, sealStyle]}>
          <Svg width={84} height={84} viewBox="0 0 100 100"><DrawPath d={CHECK} length={60} progress={check} stroke={BRAND.white} width={10} /></Svg>
        </Animated.View>
      </View>
      <Text variant="overline" color={colors.success}>APPROVED & DISBURSED</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLabel={`Approved and disbursed in ${fmtDuration(totalSec)}`}>
        <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
          <ArcRing size={46} stroke={BRAND.gold} width={4} progress={arc} track="rgba(157,29,39,0.12)" />
          <Icon name="timer-outline" size={24} color={colors.primary} />
        </View>
        <Text variant="display" color={colors.primary} style={{ fontVariant: ['tabular-nums'] }}>{fmtDuration(shown)}</Text>
      </View>
    </View>
  );
}
