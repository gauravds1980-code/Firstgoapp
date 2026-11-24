import React, { useEffect, useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import type { ZippyMood } from './zippyStore';

const MAROON = '#9D1D27';
const GOLD = '#EFA834';
const INK = '#2A0A0E';
const TONGUE = '#E2606B';
const BROW = '#FBE3B8';

/** Per-mood face pose. Gaze is -1…1 (left/up = negative); brow lift in size units (negative = up), tilt in degrees. */
const POSE: Record<ZippyMood, { gx: number; gy: number; browL: number; browR: number; tiltL: number; tiltR: number; squint: number; blush: number }> = {
  idle: { gx: 0, gy: 0, browL: 0, browR: 0, tiltL: 0, tiltR: 0, squint: 1, blush: 0.45 },
  happy: { gx: 0, gy: 0, browL: -0.02, browR: -0.02, tiltL: -6, tiltR: 6, squint: 0.88, blush: 0.7 },
  thinking: { gx: -0.7, gy: -0.85, browL: -0.04, browR: 0.006, tiltL: -14, tiltR: 6, squint: 1, blush: 0.35 },
  cheer: { gx: 0, gy: -0.2, browL: -0.04, browR: -0.04, tiltL: -12, tiltR: 12, squint: 0.8, blush: 0.85 },
};

/** Mood mouths, drawn in the 100×100 face space (body centre x≈54). */
function Mouth({ mood }: { mood: ZippyMood }) {
  switch (mood) {
    case 'happy':
      return (
        <>
          <Path d="M40 66 Q54 85 68 66 Q54 71 40 66 Z" fill={INK} stroke="#fff" strokeWidth={2.6} strokeLinejoin="round" />
          <Path d="M48 75.5 Q54 80.5 60 75.5 Q54 73.5 48 75.5 Z" fill={TONGUE} />
        </>
      );
    case 'cheer':
      return (
        <>
          <Path d="M37 63 Q54 92 71 63 Z" fill={INK} stroke="#fff" strokeWidth={2.6} strokeLinejoin="round" />
          <Path d="M46 77 Q54 86 62 77 Q54 72.5 46 77 Z" fill={TONGUE} />
        </>
      );
    case 'thinking':
      return <Path d="M47 71.5 Q51 68.5 55 71 Q59 73.5 63 70" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" fill="none" />;
    default:
      return <Path d="M43 67.5 Q54 77.5 65 67.5" stroke="#fff" strokeWidth={3.8} strokeLinecap="round" fill="none" />;
  }
}

/** 4-point twinkle used around Zippy when cheering. */
function Sparkle({ size, delay, run, style }: { size: number; delay: number; run: boolean; style: object }) {
  const t = useSharedValue(run ? 0 : 1);
  useEffect(() => {
    if (!run) { cancelAnimation(t); t.value = 1; return; }
    t.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 520 }), withDelay(500, withTiming(0, { duration: 1 }))), -1));
    return () => cancelAnimation(t);
  }, [run, delay, t]);
  const a = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scale: 0.5 + 0.6 * t.value }, { rotate: `${t.value * 45}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style, a]}>
      <Svg width={size} height={size} viewBox="0 0 10 10">
        <Path d="M5 0 L6.2 3.8 L10 5 L6.2 6.2 L5 10 L3.8 6.2 L0 5 L3.8 3.8 Z" fill={GOLD} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Zippy — FIRSTgo's assistant mascot. Original artwork (maroon orb, gold ring and spark antenna).
 * - Face: eyes blink and periodically glance around; brows, eye squint, blush and mouth follow `mood`.
 * - Moods: idle (calm smile), happy (open smile), thinking (eyes up-aside, wavy mouth, fast spark),
 *   cheer (big grin, hops, sparkles). `speaking` flaps the mouth over any mood.
 * - Tap reaction (bump `tapKey`): squash → stretch → spring back, with a wink.
 * All loops run on the UI thread via Reanimated; reduced motion → static face in the right mood.
 */
export function Zippy({ size = 56, mood = 'idle', speaking = false, tapKey = 0 }: { size?: number; mood?: ZippyMood; speaking?: boolean; tapKey?: number }) {
  const reduce = useReducedMotion();
  const gid = `zg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`; // unique per instance (orb, sheet, header)
  const pose = POSE[mood];

  const breathe = useSharedValue(1);
  const blink = useSharedValue(1);
  const wink = useSharedValue(1);
  const squint = useSharedValue(pose.squint);
  const gx = useSharedValue(pose.gx);
  const gy = useSharedValue(pose.gy);
  const browL = useSharedValue(pose.browL);
  const browR = useSharedValue(pose.browR);
  const tiltL = useSharedValue(pose.tiltL);
  const tiltR = useSharedValue(pose.tiltR);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const jump = useSharedValue(0);
  const tilt = useSharedValue(0);
  const hop = useSharedValue(0);
  const moodPop = useSharedValue(1);
  const mouth = useSharedValue(0);
  const talk = useSharedValue(speaking ? 1 : 0);
  const spark = useSharedValue(0);

  // Breathing + blinking — always on (unless reduced motion).
  useEffect(() => {
    if (reduce) { breathe.value = 1; blink.value = 1; return; }
    breathe.value = withRepeat(withSequence(withTiming(1.04, { duration: 1700, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) })), -1);
    blink.value = withRepeat(withSequence(withDelay(2800, withTiming(0.08, { duration: 70 })), withTiming(1, { duration: 110 }), withDelay(2200, withTiming(1, { duration: 1 })), withTiming(0.08, { duration: 60 }), withTiming(1, { duration: 100 }), withDelay(180, withTiming(0.08, { duration: 60 })), withTiming(1, { duration: 100 })), -1);
    return () => { cancelAnimation(breathe); cancelAnimation(blink); };
  }, [reduce, breathe, blink]);

  // Mood → pose (brows, squint), gaze behaviour, antenna spark speed and cheer hop.
  useEffect(() => {
    const p = POSE[mood];
    const to = (v: number) => (reduce ? v : withSpring(v, { damping: 12, stiffness: 180 }));
    browL.value = to(p.browL); browR.value = to(p.browR); tiltL.value = to(p.tiltL); tiltR.value = to(p.tiltR); squint.value = to(p.squint);
    if (reduce) {
      gx.value = p.gx; gy.value = p.gy; spark.value = 0.6; hop.value = 0;
      return;
    }
    moodPop.value = withSequence(withTiming(1.07, { duration: 110 }), withSpring(1, { damping: 7, stiffness: 240 }));
    const ease = { duration: 260, easing: Easing.inOut(Easing.quad) };
    if (mood === 'thinking') {
      // Eyes up and aside, drifting a little as if working something out.
      gx.value = withSequence(withTiming(p.gx, ease), withRepeat(withSequence(withDelay(900, withTiming(-0.35, { duration: 500 })), withDelay(700, withTiming(p.gx, { duration: 500 }))), -1));
      gy.value = withTiming(p.gy, ease);
    } else {
      // Periodic glance: right… back… left-up… back.
      gx.value = withSequence(withTiming(p.gx, ease), withRepeat(withSequence(
        withDelay(2600, withTiming(0.85, ease)), withDelay(650, withTiming(p.gx, ease)),
        withDelay(3200, withTiming(-0.8, ease)), withDelay(600, withTiming(p.gx, ease)),
      ), -1));
      gy.value = withSequence(withTiming(p.gy, ease), withRepeat(withSequence(
        withDelay(2600, withTiming(p.gy, ease)), withDelay(650, withTiming(p.gy, ease)),
        withDelay(3200, withTiming(-0.6, ease)), withDelay(600, withTiming(p.gy, ease)),
      ), -1));
    }
    spark.value = withRepeat(withTiming(1, { duration: mood === 'thinking' ? 520 : 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
    if (mood === 'cheer') {
      hop.value = withRepeat(withSequence(withDelay(900, withTiming(-size * 0.09, { duration: 170, easing: Easing.out(Easing.quad) })), withTiming(0, { duration: 260, easing: Easing.bounce })), -1);
    } else {
      hop.value = withTiming(0, { duration: 160 });
    }
    return () => { cancelAnimation(gx); cancelAnimation(gy); cancelAnimation(spark); cancelAnimation(hop); };
  }, [mood, reduce, size, browL, browR, tiltL, tiltR, squint, gx, gy, spark, hop, moodPop]);

  // Tap: squash (wide/short) → stretch (tall/thin, small jump) → spring back; wink the right eye.
  useEffect(() => {
    if (!tapKey || reduce) return;
    sx.value = withSequence(withTiming(1.16, { duration: 80 }), withTiming(0.9, { duration: 110 }), withSpring(1, { damping: 5, stiffness: 260 }));
    sy.value = withSequence(withTiming(0.82, { duration: 80 }), withTiming(1.12, { duration: 110 }), withSpring(1, { damping: 5, stiffness: 260 }));
    jump.value = withSequence(withTiming(0, { duration: 80 }), withTiming(-size * 0.12, { duration: 120, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 8, stiffness: 220 }));
    tilt.value = withSequence(withTiming(-8, { duration: 90 }), withSpring(0, { damping: 5, stiffness: 200 }));
    wink.value = withSequence(withTiming(0.08, { duration: 80 }), withDelay(300, withTiming(1, { duration: 120 })));
  }, [tapKey, reduce, size, sx, sy, jump, tilt, wink]);

  // Speaking: mouth flaps over the mood mouth.
  useEffect(() => {
    talk.value = reduce ? (speaking ? 1 : 0) : withTiming(speaking ? 1 : 0, { duration: 160 });
    if (speaking && !reduce) mouth.value = withRepeat(withSequence(withTiming(1, { duration: 130 }), withTiming(0.25, { duration: 110 }), withTiming(0.8, { duration: 120 }), withTiming(0, { duration: 140 })), -1);
    else mouth.value = withTiming(speaking ? 0.6 : 0, { duration: 120 });
  }, [speaking, reduce, mouth, talk]);

  const eyeW = size * 0.14, eyeH = size * 0.19, pupil = eyeW * 0.62;
  const body = useAnimatedStyle(() => {
    const k = breathe.value * moodPop.value;
    return {
      transform: [
        // keep the squash grounded: shift down by the height lost
        { translateY: hop.value + jump.value + (1 - sy.value) * size * 0.4 },
        { rotate: `${tilt.value}deg` },
        { scaleX: k * sx.value },
        { scaleY: k * sy.value },
      ],
    };
  });
  const eyeL = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value * squint.value }] }));
  const eyeR = useAnimatedStyle(() => ({ transform: [{ scaleY: Math.min(blink.value, wink.value) * squint.value }] }));
  const pupils = useAnimatedStyle(() => ({ transform: [{ translateX: gx.value * eyeW * 0.17 }, { translateY: gy.value * size * 0.04 }] }));
  const browLStyle = useAnimatedStyle(() => ({ transform: [{ translateY: browL.value * size }, { rotate: `${tiltL.value}deg` }] }));
  const browRStyle = useAnimatedStyle(() => ({ transform: [{ translateY: browR.value * size }, { rotate: `${tiltR.value}deg` }] }));
  const mouthStyle = useAnimatedStyle(() => ({ opacity: talk.value, height: size * (0.07 + 0.08 * mouth.value) }));
  const moodMouthStyle = useAnimatedStyle(() => ({ opacity: 1 - talk.value }));
  const sparkStyle = useAnimatedStyle(() => ({ opacity: 0.75 + 0.25 * spark.value, transform: [{ scale: 0.9 + 0.22 * spark.value }] }));

  const eye = (style: object) => (
    <Animated.View style={[{ width: eyeW, height: eyeH, borderRadius: eyeW, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
      <Animated.View style={[{ width: pupil, height: pupil, borderRadius: eyeW, backgroundColor: INK }, pupils]}>
        <View style={{ position: 'absolute', top: eyeW * 0.1, right: eyeW * 0.08, width: eyeW * 0.22, height: eyeW * 0.22, borderRadius: eyeW, backgroundColor: '#fff' }} />
      </Animated.View>
    </Animated.View>
  );
  const brow = (style: object) => (
    <Animated.View style={[{ width: eyeW * 1.15, height: Math.max(1.5, size * 0.035), borderRadius: size, backgroundColor: BROW }, style]} />
  );

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View style={[{ width: size, height: size }, body]}>
        <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
          <Defs>
            <RadialGradient id={gid} cx="38%" cy="32%" r="75%">
              <Stop offset="0" stopColor="#C8414E" />
              <Stop offset="0.55" stopColor={MAROON} />
              <Stop offset="1" stopColor="#6E1119" />
            </RadialGradient>
          </Defs>
          <Path d="M50 16 Q52 8 58 5" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          <Circle cx={54} cy={57} r={39} fill={`url(#${gid})`} />
          <Circle cx={54} cy={57} r={39} fill="none" stroke={GOLD} strokeWidth={3} />
          <Path d="M30 40 Q36 30 46 28" stroke="rgba(255,255,255,0.35)" strokeWidth={4} strokeLinecap="round" fill="none" />
          <Circle cx={33} cy={68} r={5.5} fill={GOLD} opacity={pose.blush} />
          <Circle cx={75} cy={68} r={5.5} fill={GOLD} opacity={pose.blush} />
        </Svg>
        <Animated.View style={[{ position: 'absolute', left: size * 0.53, top: 0, width: size * 0.16, height: size * 0.16, borderRadius: size, backgroundColor: GOLD }, sparkStyle]} />
        {/* brows */}
        <View style={{ position: 'absolute', top: size * 0.335, left: size * 0.352, flexDirection: 'row', gap: size * 0.1 }}>
          {brow(browLStyle)}
          {brow(browRStyle)}
        </View>
        {/* eyes */}
        <View style={{ position: 'absolute', top: size * 0.41, left: size * 0.36, flexDirection: 'row', gap: size * 0.12 }}>
          {eye(eyeL)}
          {eye(eyeR)}
        </View>
        {/* mood mouth */}
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, moodMouthStyle]}>
          <Svg width={size} height={size} viewBox="0 0 100 100"><Mouth mood={mood} /></Svg>
        </Animated.View>
        {/* talking mouth */}
        <View style={{ position: 'absolute', top: size * 0.63, left: 0, right: 0, alignItems: 'center', paddingLeft: size * 0.08 }}>
          <Animated.View style={[{ width: size * 0.27, backgroundColor: INK, borderTopLeftRadius: size * 0.03, borderTopRightRadius: size * 0.03, borderBottomLeftRadius: size * 0.14, borderBottomRightRadius: size * 0.14, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }, mouthStyle]}>
            <View style={{ width: size * 0.16, height: size * 0.05, borderTopLeftRadius: size, borderTopRightRadius: size, backgroundColor: TONGUE }} />
          </Animated.View>
        </View>
      </Animated.View>
      {mood === 'cheer' && (
        <>
          <Sparkle size={size * 0.2} delay={0} run={!reduce} style={{ left: -size * 0.04, top: size * 0.14 }} />
          <Sparkle size={size * 0.16} delay={380} run={!reduce} style={{ right: -size * 0.06, top: size * 0.2 }} />
          <Sparkle size={size * 0.14} delay={760} run={!reduce} style={{ left: size * 0.02, bottom: size * 0.02 }} />
        </>
      )}
    </View>
  );
}
