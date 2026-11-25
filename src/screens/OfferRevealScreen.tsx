import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { StackActions, useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { BRAND, Particle, seeded } from '../components/motion/primitives';
import { Icon, Text } from '../components/ui';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic, hapticMoment } from '../utils/haptics';

/** Total beat before moving on to Vehicle & EMI (dealer confirmation). */
export const OFFER_REVEAL_MS = 1600;
/** Reduce-motion: a short fade of the final card, then move on. */
export const OFFER_REVEAL_REDUCED_MS = 700;
/** Count-up window inside the beat: starts almost at once, lands well before the transition. */
const COUNT_DELAY_MS = 150;
const COUNT_MS = 1100;
const PARTICLES = 26;
const CONFETTI = [BRAND.gold, BRAND.goldLight, BRAND.yellow, BRAND.white, '#FF8A80', BRAND.success];

/**
 * v1.2.8 — a ~1.6 s automatic "pre-approved offer" beat between a successful QR scan / mobile search and
 * the Vehicle & EMI screen. Nothing waits for a tap: it moves on by itself (tap anywhere to skip).
 * The route replaces itself with Asset, so back from Asset never replays it.
 * v1.3.0: the offer card and the "Next:" line are avoid-rects, so floating Zippy rests clear of them.
 */
export default function OfferRevealScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { journey } = useApp();
  const reduce = useReducedMotion();
  const amount = journey.offer.amount;
  const firstName = journey.offer.customerName?.trim().split(/\s+/)[0] ?? '';

  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    nav.dispatch(StackActions.replace('Asset'));
  }, [nav]);

  const card = useSharedValue(0);
  const burst = useSharedValue(0);
  const [shown, setShown] = useState(reduce ? amount : 0);

  useEffect(() => {
    if (reduce) {
      haptic.success();
      card.value = withTiming(1, { duration: 250 });
      const tm = setTimeout(finish, OFFER_REVEAL_REDUCED_MS);
      return () => clearTimeout(tm);
    }
    const stopBeats = hapticMoment.offerCelebrate();
    card.value = withSpring(1, { damping: 12, stiffness: 180, mass: 0.8 });
    burst.value = withDelay(200, withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }));
    // Count-up text on the JS thread (rAF only); everything else animates on the UI thread.
    let raf = 0; const start = Date.now() + COUNT_DELAY_MS;
    const tick = () => {
      const k = Math.min(1, Math.max(0, (Date.now() - start) / COUNT_MS));
      setShown(Math.round(amount * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const tm = setTimeout(finish, OFFER_REVEAL_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(tm); stopBeats(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = () => { if (done.current) return; haptic.tap(); setShown(amount); finish(); };

  const cardStyle = useAnimatedStyle(() => (reduce
    ? { opacity: card.value }
    : { opacity: interpolate(card.value, [0, 0.4], [0, 1], 'clamp'), transform: [{ scale: interpolate(card.value, [0, 1], [0.85, 1]) }] }));
  const headStyle = useAnimatedStyle(() => ({ opacity: interpolate(card.value, [0, 1], [0, 1], 'clamp'), transform: [{ translateY: interpolate(card.value, [0, 1], [10, 0]) }] }));

  const confetti = useMemo(() => Array.from({ length: PARTICLES }, (_, i) => ({
    angle: -Math.PI / 2 + (seeded(i, 7) - 0.5) * Math.PI * 1.8, speed: 140 + seeded(i, 8) * 140, color: CONFETTI[i % CONFETTI.length]!,
    w: 6 + seeded(i, 9) * 5, h: i % 3 === 0 ? 6 : 12 + seeded(i, 10) * 6, spin: (seeded(i, 11) - 0.5) * 900, delay: seeded(i, 12) * 0.12,
  })), []);

  return (
    <Pressable onPress={skip} accessibilityRole="button"
      accessibilityLabel={`Congratulations${firstName ? `, ${firstName}` : ''}. Pre-approved offer of ${inr(amount)}. Opening vehicle and loan amount. Tap to skip`}
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, gap: space.lg }}>
      <Animated.View style={[{ alignItems: 'center', gap: space.xxs }, headStyle]}>
        <Text variant="h1" color={colors.primary} style={{ textAlign: 'center' }}>Congratulations!</Text>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>
          {firstName ? `${firstName} has a pre-approved offer` : 'Your customer has a pre-approved offer'}
        </Text>
      </Animated.View>

      <View style={{ width: '100%', maxWidth: 380, alignItems: 'center', justifyContent: 'center' }}>
        {/* Confetti bursts from behind the card's centre. */}
        {!reduce && confetti.map((c, i) => <Particle key={i} t={burst} angle={c.angle} speed={c.speed} color={c.color} w={c.w} h={c.h} spin={c.spin} gravity={260} delay={c.delay} />)}
        <ZippyAvoid style={{ width: '100%' }}>
        <Animated.View style={[{ width: '100%' }, cardStyle]}>
          {/* SOLID card: the same maroon gradient family as the Home hero. No blur, no transparency. */}
          <LinearGradient colors={['#B43140', colors.primary, colors.primaryDark]} locations={[0, 0.48, 1]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
            style={{ borderRadius: radius.xl, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.xs, overflow: 'hidden', backgroundColor: colors.primary }}>
            <View pointerEvents="none" style={{ position: 'absolute', right: -32, top: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="star-four-points" size={18} color={BRAND.goldLight} />
              <Text variant="label" color={BRAND.goldLight}>PRE-APPROVED OFFER</Text>
              <Icon name="star-four-points" size={18} color={BRAND.goldLight} />
            </View>
            <Text variant="display" color={colors.onPrimary} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
              style={{ fontSize: 40, lineHeight: 50, fontVariant: ['tabular-nums'] }}>{inr(shown)}</Text>
            <Text variant="caption" color="rgba(255,255,255,0.88)" style={{ textAlign: 'center' }}>Up to this amount · ready to disburse today</Text>
          </LinearGradient>
        </Animated.View>
        </ZippyAvoid>
      </View>

      <ZippyAvoid>
        <Animated.View style={headStyle}>
          <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>Next: confirm the vehicle and loan amount</Text>
        </Animated.View>
      </ZippyAvoid>
    </Pressable>
  );
}
