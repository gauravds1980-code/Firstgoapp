import React, { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import Animated, {
  cancelAnimation, Easing, SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import type { ProductId } from '../../config/products';
import { ZippyCharacter, ZippyCharacterProps } from './ZippyCharacter';

/**
 * ZippyRide — the vehicle mount (v1.2.2). Wraps the swappable ZippyCharacter on a small vehicle that
 * matches the dealer's product: scooter (twoWheeler), car, mini truck (cv). Vehicle art lives here;
 * character art lives ONLY in ZippyCharacter (the two-wheeler only flips its `scarf` flag).
 *
 * Motion (Reanimated, UI thread): short drive-in on mount / product change with spinning wheels,
 * a gentle suspension bounce, wheels roll while `moving` (e.g. being dragged).
 * Reduced motion → static vehicle, no drive-in.
 *
 * Footprint: `size` × `size` box (same as the bare character); the vehicle hangs RIDE_EXTRA × size below it.
 */
export const RIDE_EXTRA = 0.3;

const GOLD = '#EFA834';
const GOLD_DARK = '#C98A1E';
const MAROON_DARK = '#6E0A0F';
const INK = '#2A0A0E';
const GLASS = '#CFE6F2';
const LAMP = '#FFCB05';
const TAIL = '#E2606B';

/** Vehicle geometry in a 100 × 56 box: wheel centres, rider x-centre and how deep the rider sits. */
const GEO: Record<ProductId, { wheels: [number, number][]; r: number; riderX: number; riderTop: number }> = {
  // The furry hood is a tall figure that fills its box nearly to the bottom: on the scooter it sits on
  // the seat, in the car it peeks from the cabin (lower body hidden), in the truck it rides in the bed.
  twoWheeler: { wheels: [[22, 45], [80, 45]], r: 9, riderX: 0.38, riderTop: 0.0 },
  car: { wheels: [[24, 45], [78, 45]], r: 9, riderX: 0.46, riderTop: 0.24 },
  cv: { wheels: [[20, 46], [80, 46]], r: 9, riderX: 0.32, riderTop: 0.15 },
};

/** Vertical centre of the rider's body inside a `size` box (not the wheels), e.g. to align side badges. */
export const riderCenterY = (product: ProductId, size: number) => size * (GEO[product].riderTop + 0.45);
/** How far the vehicle overhangs each side of the `size` box. */
export const rideOverhang = (size: number) => (size * 1.25 - size) / 2;

/** How far the drawn ride reaches past each side of its `size` box (dp, ≥ 0). */
export type Overhang = { left: number; right: number; top: number; bottom: number };

/**
 * v1.2.9: the ride's full visual extent beyond the `size` box, for keeping floating Zippy fully on
 * screen: vehicle body (1.25 × size wide, hangs below), the rider box (sits left of centre on the
 * truck / scooter), its 'cheer' sparkles (0.06 × rider outside the rider box) and its hop / jump
 * (up to 0.12 × rider above). Matches the layout in ZippyRide below; keep the two in sync.
 */
export function rideBounds(product: ProductId, size: number): Overhang {
  const g = GEO[product];
  const vw = size * 1.25;
  const vLeft = (size - vw) / 2; // negative: the vehicle starts left of the box
  const rider = size * 0.9;
  const riderLeft = vLeft + vw * g.riderX - rider / 2;
  const spark = rider * 0.06;
  return {
    left: Math.max(-vLeft, spark - riderLeft, 0),
    right: Math.max(-vLeft, riderLeft + rider + spark - size, 0),
    top: Math.max(0, rider * 0.12 - size * g.riderTop),
    bottom: Math.max(0, size * 0.56 + vw * 0.56 - size),
  };
}

/** Parts drawn behind the rider (seat backs, cab rear). */
function BackLayer({ kind }: { kind: ProductId }) {
  switch (kind) {
    case 'twoWheeler':
      return <Path d="M64 16 L80 13" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />;
    case 'car':
      return <Path d="M66 29 L73 15 L77 15 L71 29 Z" fill={GLASS} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />;
    default:
      return null;
  }
}

/** Body parts drawn in front of the rider (so it looks seated in / on the vehicle). */
function FrontLayer({ kind }: { kind: ProductId }) {
  switch (kind) {
    case 'twoWheeler':
      return (
        <>
          {/* rear cowl + seat */}
          <Path d="M8 42 C8 31 20 27 34 29 L50 31 C55 32 55 38 50 40 L40 44 L12 44 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={1.2} />
          <Path d="M18 29 Q32 23 48 29 L47 32 L19 32 Z" fill={INK} />
          {/* floorboard, front column and apron */}
          <Rect x={40} y={40} width={30} height={4.5} rx={2} fill={INK} opacity={0.85} />
          <Path d="M71 15 L80 44 L74 44 L66 17 Z" fill={MAROON_DARK} />
          <Path d="M64 22 Q76 26 81 44 L70 44 Q68 32 60 29 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={1.2} />
          <Circle cx={79} cy={24} r={2.6} fill={LAMP} />
          <Circle cx={9} cy={36} r={1.8} fill={TAIL} />
        </>
      );
    case 'car':
      return (
        <>
          <Path d="M3 40 Q3 30 14 29 L66 29 Q78 26 90 31 L95 33 Q98 35 98 40 L98 44 Q98 47 95 47 L6 47 Q3 47 3 44 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={1.2} />
          <Path d="M30 31 L30 44 M60 31 L60 44" stroke={GOLD_DARK} strokeWidth={1} />
          <Rect x={34} y={35} width={6} height={1.8} rx={0.9} fill={GOLD_DARK} />
          <Circle cx={94} cy={37} r={2.4} fill={LAMP} />
          <Rect x={3.5} y={34} width={2.6} height={4} rx={1} fill={TAIL} />
        </>
      );
    default:
      return (
        <>
          {/* open cargo bed (rider sits in it) */}
          <Path d="M3 28 L60 28 L60 45 L3 45 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth={1.2} />
          <Path d="M3 34 L60 34 M3 39.5 L60 39.5" stroke={GOLD_DARK} strokeWidth={0.9} />
          {/* cab */}
          <Path d="M60 13 Q60 9 64 9 L81 9 Q85 9 87 14 L95 29 Q98 31 98 35 L98 45 L60 45 Z" fill={MAROON_DARK} />
          <Path d="M65 13 L81 13 L87 26 L65 26 Z" fill={GLASS} />
          <Circle cx={95} cy={37} r={2.4} fill={LAMP} />
          <Rect x={1} y={45} width={98} height={3} rx={1.5} fill={INK} />
        </>
      );
  }
}

function Wheel({ px, spin }: { px: number; spin: SharedValue<number> }) {
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  return (
    <Animated.View style={[{ width: px, height: px }, a]}>
      <Svg width={px} height={px} viewBox="0 0 20 20">
        <Circle cx={10} cy={10} r={9.2} fill={INK} />
        <Circle cx={10} cy={10} r={5} fill="#fff" />
        <Path d="M10 5.4 V14.6 M5.4 10 H14.6" stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
        <Circle cx={10} cy={10} r={1.6} fill={GOLD} />
      </Svg>
    </Animated.View>
  );
}

export function ZippyRide({ size = 60, product, moving = false, driveKey = 0, driveInMax, ...character }: ZippyCharacterProps & {
  size?: number; product: ProductId; moving?: boolean; driveKey?: number;
  /** Max drive-in distance (dp) — the room to the left of the resting spot, so the ride never enters from off screen. */
  driveInMax?: number;
}) {
  const reduce = useReducedMotion();
  const g = GEO[product];
  const vw = size * 1.25;
  const vh = vw * 0.56;
  const vTop = size * 0.56;
  const rider = size * 0.9;

  const drive = useSharedValue(0); // translateX of the whole ride
  const spin = useSharedValue(0);
  const bounce = useSharedValue(0);

  // Drive-in on mount / product change: roll in from the left, wheels spinning, then settle.
  useEffect(() => {
    const dist = Math.min(size * 1.4, Math.max(0, driveInMax ?? Infinity));
    if (reduce || dist < 4) { drive.value = 0; spin.value = 0; return; }
    drive.value = -dist;
    drive.value = withTiming(0, { duration: 720, easing: Easing.out(Easing.cubic) });
    spin.value = withTiming(spin.value + 540, { duration: 760, easing: Easing.out(Easing.cubic) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, driveKey, reduce]);

  // Wheels roll while moving (dragged).
  useEffect(() => {
    if (reduce || !moving) return;
    spin.value = withRepeat(withTiming(spin.value + 360, { duration: 420, easing: Easing.linear }), -1);
    return () => { cancelAnimation(spin); };
  }, [moving, reduce, spin]);

  // Suspension: gentle idle bob, quicker while moving.
  useEffect(() => {
    if (reduce) { cancelAnimation(bounce); bounce.value = 0; return; }
    const amp = size * (moving ? 0.03 : 0.018);
    const ms = moving ? 140 : 820;
    bounce.value = withRepeat(withSequence(withTiming(-amp, { duration: ms, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: ms, easing: Easing.inOut(Easing.sin) })), -1);
    return () => { cancelAnimation(bounce); };
  }, [moving, reduce, size, bounce]);

  const rideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: drive.value }] }));
  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bounce.value }] }));
  const wheelPx = ((g.r * 2) / 100) * vw;
  const vehicleBox = { position: 'absolute' as const, left: (size - vw) / 2, top: vTop, width: vw, height: vh };

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, rideStyle]}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, bodyStyle]}>
          <View style={vehicleBox}>
            <Svg width={vw} height={vh} viewBox="0 0 100 56"><BackLayer kind={product} /></Svg>
          </View>
          <View style={{ position: 'absolute', top: size * g.riderTop, left: (size - vw) / 2 + vw * g.riderX - rider / 2 }}>
            <ZippyCharacter size={rider} {...character} scarf={product === 'twoWheeler'} />
          </View>
          <View style={vehicleBox}>
            <Svg width={vw} height={vh} viewBox="0 0 100 56"><FrontLayer kind={product} /></Svg>
          </View>
        </Animated.View>
        {/* Wheels stay on the ground (no suspension bob). */}
        {g.wheels.map(([cx, cy], i) => (
          <View key={i} style={{ position: 'absolute', left: vehicleBox.left + (cx / 100) * vw - wheelPx / 2, top: vTop + (cy / 56) * vh - wheelPx / 2 }}>
            <Wheel px={wheelPx} spin={spin} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}
