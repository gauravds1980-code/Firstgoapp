import React, { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

const MAROON = '#9D1D27';
const GOLD = '#EFA834';

/**
 * Zippy — FIRSTgo's assistant mascot. Original artwork (maroon orb, gold spark antenna).
 * States: idle (breathe + periodic blink), tap reaction (squash-bounce + wink, bump `tapKey`), speaking (mouth flaps).
 * All loops run on the UI thread via Reanimated; reduced motion → static face.
 */
export function Zippy({ size = 56, speaking = false, tapKey = 0 }: { size?: number; speaking?: boolean; tapKey?: number }) {
  const reduce = useReducedMotion();
  const breathe = useSharedValue(1);
  const blink = useSharedValue(1);
  const wink = useSharedValue(1);
  const pop = useSharedValue(1);
  const tilt = useSharedValue(0);
  const mouth = useSharedValue(0);
  const spark = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    breathe.value = withRepeat(withSequence(withTiming(1.045, { duration: 1700, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) })), -1);
    blink.value = withRepeat(withSequence(withDelay(2800, withTiming(0.08, { duration: 70 })), withTiming(1, { duration: 110 }), withDelay(180, withTiming(0.08, { duration: 60 })), withTiming(1, { duration: 100 })), -1);
    spark.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduce, breathe, blink, spark]);

  useEffect(() => {
    if (!tapKey || reduce) return;
    pop.value = withSequence(withTiming(0.86, { duration: 90 }), withSpring(1, { damping: 6, stiffness: 260 }));
    tilt.value = withSequence(withTiming(-10, { duration: 90 }), withSpring(0, { damping: 5, stiffness: 200 }));
    wink.value = withSequence(withTiming(0.08, { duration: 80 }), withDelay(260, withTiming(1, { duration: 120 })));
  }, [tapKey, reduce, pop, tilt, wink]);

  useEffect(() => {
    if (speaking && !reduce) mouth.value = withRepeat(withSequence(withTiming(1, { duration: 130 }), withTiming(0.25, { duration: 110 }), withTiming(0.8, { duration: 120 }), withTiming(0, { duration: 140 })), -1);
    else mouth.value = withTiming(speaking ? 0.6 : 0, { duration: 120 });
  }, [speaking, reduce, mouth]);

  const body = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value * pop.value }, { rotate: `${tilt.value}deg` }] }));
  const eyeL = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));
  const eyeR = useAnimatedStyle(() => ({ transform: [{ scaleY: Math.min(blink.value, wink.value) }] }));
  const talk = useSharedValue(0);
  useEffect(() => { talk.value = withTiming(speaking ? 1 : 0, { duration: 160 }); }, [speaking, talk]);
  const mouthStyle = useAnimatedStyle(() => ({ opacity: talk.value, height: size * (0.07 + 0.08 * mouth.value) }));
  const smileStyle = useAnimatedStyle(() => ({ opacity: 1 - talk.value }));
  const sparkStyle = useAnimatedStyle(() => ({ opacity: 0.75 + 0.25 * spark.value, transform: [{ scale: 0.9 + 0.2 * spark.value }] }));

  const eyeW = size * 0.14, eyeH = size * 0.19;
  return (
    <Animated.View style={[{ width: size, height: size }, body]}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient id="zg" cx="38%" cy="32%" r="75%">
            <Stop offset="0" stopColor="#C8414E" />
            <Stop offset="0.55" stopColor={MAROON} />
            <Stop offset="1" stopColor="#6E1119" />
          </RadialGradient>
        </Defs>
        <Path d="M50 16 Q52 8 58 5" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round" fill="none" />
        <Circle cx={54} cy={57} r={39} fill="url(#zg)" />
        <Circle cx={54} cy={57} r={39} fill="none" stroke={GOLD} strokeWidth={3} />
        <Path d="M30 40 Q36 30 46 28" stroke="rgba(255,255,255,0.35)" strokeWidth={4} strokeLinecap="round" fill="none" />
        <Circle cx={33} cy={68} r={5} fill="rgba(239,168,52,0.45)" />
        <Circle cx={75} cy={68} r={5} fill="rgba(239,168,52,0.45)" />
      </Svg>
      <Animated.View style={[{ position: 'absolute', left: size * 0.53, top: 0, width: size * 0.16, height: size * 0.16, borderRadius: size, backgroundColor: GOLD }, sparkStyle]} />
      <View style={{ position: 'absolute', top: size * 0.41, left: size * 0.36, flexDirection: 'row', gap: size * 0.12 }}>
        <Animated.View style={[{ width: eyeW, height: eyeH, borderRadius: eyeW, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, eyeL]}>
          <View style={{ width: eyeW * 0.62, height: eyeW * 0.62, borderRadius: eyeW, backgroundColor: '#2A0A0E' }}>
            <View style={{ position: 'absolute', top: eyeW * 0.1, right: eyeW * 0.08, width: eyeW * 0.22, height: eyeW * 0.22, borderRadius: eyeW, backgroundColor: '#fff' }} />
          </View>
        </Animated.View>
        <Animated.View style={[{ width: eyeW, height: eyeH, borderRadius: eyeW, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, eyeR]}>
          <View style={{ width: eyeW * 0.62, height: eyeW * 0.62, borderRadius: eyeW, backgroundColor: '#2A0A0E' }}>
            <View style={{ position: 'absolute', top: eyeW * 0.1, right: eyeW * 0.08, width: eyeW * 0.22, height: eyeW * 0.22, borderRadius: eyeW, backgroundColor: '#fff' }} />
          </View>
        </Animated.View>
      </View>
      <View style={{ position: 'absolute', top: size * 0.63, left: 0, right: 0, alignItems: 'center', paddingLeft: size * 0.08 }}>
        {/* idle smile */}
        <Animated.View style={[{ position: 'absolute', top: 0, width: size * 0.26, height: size * 0.13, borderBottomLeftRadius: size * 0.14, borderBottomRightRadius: size * 0.14, borderWidth: size * 0.04, borderTopWidth: 0, borderColor: '#fff' }, smileStyle]} />
        {/* talking mouth */}
        <Animated.View style={[{ width: size * 0.27, backgroundColor: '#2A0A0E', borderTopLeftRadius: size * 0.03, borderTopRightRadius: size * 0.03, borderBottomLeftRadius: size * 0.14, borderBottomRightRadius: size * 0.14, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }, mouthStyle]}>
          <View style={{ width: size * 0.16, height: size * 0.05, borderTopLeftRadius: size, borderTopRightRadius: size, backgroundColor: '#E2606B' }} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}
