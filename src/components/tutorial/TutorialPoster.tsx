import React, { useEffect, useState } from 'react';
import { Image, type StyleProp, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors } from '../../theme/tokens';
import type { TutorialEntry } from '../../tutorial/manifest';
import { Icon } from '../ui';

/** Moving light band across a box while something loads (static with reduced motion). */
export function Shimmer({ on = true }: { on?: boolean }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!on || reduce || !w) { cancelAnimation(x); x.value = 0; return; }
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1);
  }, [on, reduce, w, x]);
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: -w * 0.6 + x.value * w * 1.7 }] }));
  if (!on) return null;
  return (
    <View pointerEvents="none" onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
      {w > 0 && !reduce && (
        <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: w * 0.5 }, band]}>
          <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
        </Animated.View>
      )}
    </View>
  );
}

/** Branded skeleton: maroon gradient + a faint play mark. Shown under every poster until it loads. */
export function BrandSkeleton({ shimmer = true, mark = 40 }: { shimmer?: boolean; mark?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <LinearGradient colors={['#B43140', colors.primary, colors.primaryDark]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {mark > 0 && <Icon name="play-box-multiple-outline" size={mark} color="rgba(255,255,255,0.28)" />}
      </LinearGradient>
      <Shimmer on={shimmer} />
    </View>
  );
}

/**
 * Remote poster / thumbnail (never bundled) over the branded skeleton. The image cache keeps it after
 * the first load (`force-cache` on iOS; Fresco on Android; the browser cache on web). A missing poster
 * (404 or the tunnel's HTML) simply leaves the skeleton.
 */
export function TutorialPoster({ entry, variant = 'thumb', shimmer = true, mark, style, fit = 'cover', onReady }: {
  entry: TutorialEntry; variant?: 'thumb' | 'poster'; shimmer?: boolean; mark?: number; style?: StyleProp<ViewStyle>;
  /** 'contain' in the feed, so the poster lines up exactly with the (contained) video's first frame. */
  fit?: 'cover' | 'contain'; onReady?: (ok: boolean) => void;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const uri = variant === 'poster' ? entry.urls.poster : entry.urls.thumb;
  useEffect(() => { setState('loading'); }, [uri]);
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: fit === 'contain' ? '#000' : colors.primaryDark }, style]}>
      {/* Letterboxed (contain) posters sit on black once loaded, like the video; the skeleton stays under covers. */}
      {(fit === 'cover' || state !== 'ok') && <BrandSkeleton shimmer={shimmer && state === 'loading'} mark={state === 'ok' ? 0 : mark ?? 40} />}
      {state !== 'error' && (
        <Image source={{ uri, cache: 'force-cache' }} resizeMode={fit} accessibilityIgnoresInvertColors
          onLoad={() => { setState('ok'); onReady?.(true); }} onError={() => { setState('error'); onReady?.(false); }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: state === 'ok' ? 1 : 0 }} />
      )}
    </View>
  );
}
