import React, { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ASSISTANT_NAME } from '../../config/brand';
import { colors, elevation, fontScaleCap, radius, space, touch } from '../../theme/tokens';
import { isComingSoon, useTutorialCatalog } from '../../tutorial/manifest';
import { PreloadTutorial } from '../../tutorial/useTutorialVideo';
import { formatClock, nudgeHeadline } from '../../tutorial/stuckDetector';
import { tutorials, useTutorialState } from '../../tutorial/tutorialStore';
import { haptic } from '../../utils/haptics';
import { Icon, PressableScale, Text } from '../ui';
import { TutorialPoster } from './TutorialPoster';

/**
 * Where Zippy is, in the overlay's coordinates:
 *  - floating: the orb box's top-left (x, y), its size, how far the body hangs below it, and its side;
 *  - docked:   the centre of the focused header slot.
 */
export type NudgeAnchor =
  | { kind: 'floating'; x: number; y: number; size: number; below: number; side: 'left' | 'right' }
  | { kind: 'docked'; cx: number; cy: number; slot: number };

const EDGE = 12;
const GAP = 10;
const MAX_W = 340;
const THUMB_W = 72;
const THUMB_H = 128;
const CARET = 14;

/**
 * Zippy's "drop a short" bubble (v1.3.0). Anchored next to Zippy — above / below a floating orb on its
 * side of the screen, or under the docked face in the header — and always fully on screen (clamped to
 * the safe area after measuring its own height, so it also fits a 360dp phone). Streamed thumbnail +
 * play glyph, "Watch" (opens the Reels-style shorts feed at this short), "Not now" and "Don't show
 * again here". Pops in (instant with reduced motion) with a light haptic. While it is up, the short's
 * player is preloaded (paused) so Watch starts fast.
 */
export function TutorialNudgeBubble({ anchor }: { anchor: NudgeAnchor | null }) {
  const { nudge } = useTutorialState();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [h, setH] = useState(0);
  const pop = useSharedValue(0);
  const id = nudge?.id;

  const { byId, failed } = useTutorialCatalog();
  useEffect(() => { setH(0); pop.value = 0; }, [id, pop]);
  // Pop once measured (so it never flashes in the wrong place).
  const ready = !!nudge && !!anchor && h > 0;
  useEffect(() => {
    if (!ready) return;
    haptic.tap();
    pop.value = reduce ? withTiming(1, { duration: 1 }) : withSpring(1, { damping: 13, stiffness: 220, mass: 0.7 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id]);
  const popStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.value * 1.4), transform: [{ scale: 0.86 + 0.14 * pop.value }] }));

  const entry = nudge ? byId[nudge.shortId] : undefined;
  if (!nudge || !anchor || !entry) return null;
  const headline = nudgeHeadline(nudge.reason, entry.durationSec);

  // ---- placement (overlay coordinates) ----
  const bw = Math.min(MAX_W, W - insets.left - insets.right - EDGE * 2);
  const minLeft = insets.left + EDGE;
  const maxLeft = W - insets.right - EDGE - bw;
  const minTop = insets.top + EDGE;
  const maxTop = Math.max(minTop, H - insets.bottom - EDGE - h);
  let left: number;
  let top: number;
  if (anchor.kind === 'floating') {
    left = anchor.side === 'right' ? maxLeft : minLeft;
    const orbTop = anchor.y;
    const orbBottom = anchor.y + anchor.size + anchor.below;
    const lowerHalf = anchor.y + anchor.size / 2 > H / 2;
    top = lowerHalf ? orbTop - GAP - h : orbBottom + GAP;
  } else {
    left = anchor.cx + anchor.slot / 2 + EDGE - bw; // right edge just past the docked face
    top = anchor.cy + anchor.slot / 2 + GAP;
  }
  left = Math.min(maxLeft, Math.max(minLeft, left));
  top = Math.min(maxTop, Math.max(minTop, top));
  // Caret pointing at Zippy, only while the bubble actually sits next to it (not when clamped away).
  const zx = anchor.kind === 'floating' ? anchor.x + anchor.size / 2 : anchor.cx;
  const caretX = Math.min(bw - CARET - 18, Math.max(18, zx - left - CARET / 2));
  let caret: 'up' | 'down' | null = null;
  if (h > 0 && anchor.kind === 'docked' && Math.abs(top - (anchor.cy + anchor.slot / 2 + GAP)) < 2) caret = 'up';
  if (h > 0 && anchor.kind === 'floating') {
    if (Math.abs(top + h + GAP - anchor.y) < 2) caret = 'down';
    else if (Math.abs(top - (anchor.y + anchor.size + anchor.below + GAP)) < 2) caret = 'up';
  }

  const close = () => { haptic.select(); tutorials.dismissNudge(); };
  const watch = () => { haptic.tap(); tutorials.openShorts(entry.id); };
  return (
    <Animated.View
      onLayout={(e) => { const nh = Math.round(e.nativeEvent.layout.height); if (Math.abs(nh - h) > 1) setH(nh); }}
      accessibilityViewIsModal={false}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${ASSISTANT_NAME}: ${headline}. ${entry.title}`}
      style={[{
        position: 'absolute', left, top, width: bw, zIndex: 60,
        backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.aiUser,
        padding: space.sm, gap: space.xs,
      }, elevation.raised as object, popStyle]}
    >
      {caret && (
        <View pointerEvents="none" style={{
          position: 'absolute', left: caretX, width: CARET, height: CARET, backgroundColor: colors.surface, borderColor: colors.aiUser,
          transform: [{ rotate: '45deg' }],
          ...(caret === 'down'
            ? { bottom: -CARET / 2 - 1, borderRightWidth: 1.5, borderBottomWidth: 1.5 }
            : { top: -CARET / 2 - 1, borderLeftWidth: 1.5, borderTopWidth: 1.5 }),
        }} />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.aiUser, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="creation" size={16} color={colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" maxFontSizeMultiplier={fontScaleCap.compact} accessibilityRole="header">{headline}</Text>
          <Text variant="caption" color={colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{entry.title} · {formatClock(entry.durationSec)}</Text>
        </View>
      </View>

      {!isComingSoon(entry, failed) && <PreloadTutorial entry={entry} />}
      {(
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <PressableScale onPress={watch} accessibilityRole="button" accessibilityLabel={`Watch ${entry.title}, ${formatClock(entry.durationSec)}`}
            style={{ width: THUMB_W, height: THUMB_H, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.primaryDark }}>
            <TutorialPoster entry={entry} variant="thumb" mark={0} style={{ width: '100%', height: '100%' }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: space.xs, alignItems: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="play" size={20} color={colors.onPrimary} style={{ marginLeft: 2 }} />
              </View>
            </View>
          </PressableScale>
          <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={3} maxFontSizeMultiplier={fontScaleCap.compact}>{entry.subtitle}</Text>
            <PressableScale onPress={watch} accessibilityRole="button" accessibilityLabel={`Watch the ${entry.title} how-to`}
              style={{ minHeight: touch.min - 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.primary }}>
              <Icon name="play" size={18} color={colors.onPrimary} />
              <Text variant="label" color={colors.onPrimary} maxFontSizeMultiplier={fontScaleCap.control}>Watch</Text>
            </PressableScale>
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs }}>
        <PressableScale onPress={close} accessibilityRole="button" accessibilityLabel="Not now"
          style={{ minHeight: touch.min - 8, justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border }}>
          <Text variant="label" color={colors.text} maxFontSizeMultiplier={fontScaleCap.control}>Not now</Text>
        </PressableScale>
        <PressableScale onPress={() => { haptic.select(); tutorials.dontShowAgain(nudge.screen); }} accessibilityRole="button"
          accessibilityLabel="Don't show again here" accessibilityHint="Zippy won't offer how-to videos on this screen again"
          style={{ minHeight: touch.min - 8, flexShrink: 1, justifyContent: 'center', paddingHorizontal: space.xxs }}>
          <Text variant="label" color={colors.primary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control}>Don’t show again here</Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}
