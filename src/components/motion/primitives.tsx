/**
 * Motion primitives (Reanimated 4 + react-native-svg). All animation runs on the UI thread.
 * Reference notes: /workspace/boom-notes/v1.2-motion-references.md
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';

export const AnimatedPath = Animated.createAnimatedComponent(Path);
export const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const BRAND = { maroon: '#9D1D27', maroonDark: '#6E0A0F', gold: '#EFA834', goldLight: '#FFD27A', success: '#00A07A', white: '#FFFFFF', yellow: '#FFCB05' };

/** Path that draws itself: progress 0 → 1 drives strokeDashoffset. */
export function DrawPath({ d, length, progress, stroke, width, opacity }: { d: string; length: number; progress: SharedValue<number>; stroke: string; width: number; opacity?: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - progress.value), strokeOpacity: opacity ? opacity.value : 1 }));
  return <AnimatedPath d={d} stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={`${length} ${length}`} animatedProps={props} />;
}

/** Circular arc that sweeps 0 → 1 (progress ring). */
export function ArcRing({ size, stroke, width, progress, track }: { size: number; stroke: string; width: number; progress: SharedValue<number>; track?: string }) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - progress.value) }));
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
      {track ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={width} fill="none" /> : null}
      <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round" strokeDasharray={`${c} ${c}`} animatedProps={props} />
    </Svg>
  );
}

/** One confetti / spark particle with a simple ballistic path (gravity) driven by a shared clock 0→1. */
export function Particle({ t, angle, speed, color, w, h, spin, gravity = 260, delay = 0 }: {
  t: SharedValue<number>; angle: number; speed: number; color: string; w: number; h: number; spin: number; gravity?: number; delay?: number;
}) {
  const style = useAnimatedStyle(() => {
    const k = Math.max(0, t.value - delay) / (1 - delay);
    const x = Math.cos(angle) * speed * k;
    const y = Math.sin(angle) * speed * k + gravity * k * k;
    return {
      opacity: interpolate(k, [0, 0.05, 0.75, 1], [0, 1, 1, 0]),
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${spin * k}deg` }, { scale: interpolate(k, [0, 0.1, 1], [0.3, 1, 0.8]) }],
    };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: w, height: h, borderRadius: Math.min(w, h) / 2.5, backgroundColor: color }, style]} />;
}

/** Deterministic pseudo-random so frames are stable across renders. */
export function seeded(i: number, salt = 1): number {
  const x = Math.sin(i * 12.9898 * salt + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A gold light band that sweeps across its parent once (or `repeat` times). Parent needs overflow:hidden. */
export function GoldShimmer({ width, height, delay = 0, repeat = 1, duration = 1100 }: { width: number; height: number; delay?: number; repeat?: number; duration?: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) }), repeat, false));
  }, [p, delay, repeat, duration]);
  const band = Math.max(80, width * 0.35);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(p.value, [0, 1], [-band * 1.5, width + band]) }, { skewX: '-20deg' }], opacity: interpolate(p.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0]) }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -10, bottom: -10, width: band }, style]}>
      <Svg width={band} height={height + 20}>
        <Defs>
          <SvgLinearGradient id="gs" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={BRAND.goldLight} stopOpacity="0" />
            <Stop offset="0.5" stopColor={BRAND.goldLight} stopOpacity="0.55" />
            <Stop offset="1" stopColor={BRAND.goldLight} stopOpacity="0" />
          </SvgLinearGradient>
        </Defs>
        <Path d={`M0 0 H${band} V${height + 20} H0 Z`} fill="url(#gs)" />
      </Svg>
    </Animated.View>
  );
}

/** Pulsing ring (gold) — runs `count` pulses then rests (restraint: no infinite glow). */
export function PulseRing({ size, color, count = 3, delay = 0 }: { size: number; color: string; count?: number; delay?: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }), count, false)); }, [p, count, delay]);
  const style = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.15, 1], [0, 0.6, 0]), transform: [{ scale: interpolate(p.value, [0, 1], [0.9, 1.6]) }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: color }, style]} />;
}

export const Box = View;
