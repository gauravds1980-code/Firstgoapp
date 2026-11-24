import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ASSISTANT_NAME } from '../../config/brand';
import { colors, elevation, radius, space } from '../../theme/tokens';
import { haptic } from '../../utils/haptics';
import { AssistantSheet } from '../AssistantSheet';
import { Icon, Text } from '../ui';
import { getTipOverride, ROUTE_CONTEXT, TIPS } from './tips';
import { Zippy } from './Zippy';

const SIZE = 60;
const MARGIN = 8;
/** Keep clear of the header (top) and of sticky CTA bars + the bottom-centre Scan QR FAB (bottom). */
const TOP_CLEAR = 76;
const BOTTOM_CLEAR = 216;

/**
 * Global floating assistant, rendered once over the navigator on every screen.
 * Drag anywhere → snaps to the nearest side edge with a spring; vertical position clamped so it
 * never sits on a primary CTA bar or the Scan QR FAB. Idles with a gentle float; tap → wink + sheet.
 * Shows a one-off contextual tip balloon the first time each screen is visited in a session.
 */
export function ZippyBubble({ route }: { route?: string }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const context = ROUTE_CONTEXT[route ?? ''] ?? 'home';
  const minY = insets.top + TOP_CLEAR;
  const maxY = Math.max(minY, H - insets.bottom - BOTTOM_CLEAR - SIZE);
  const rightX = W - SIZE - MARGIN;
  const x = useSharedValue(rightX);
  const y = useSharedValue(maxY); // rests low on the right, just above the CTA / Scan QR zone
  const bob = useSharedValue(0);
  const lift = useSharedValue(1);
  /** 0 = fully visible, 1 = peeking (tucked 45% behind the edge so it never sits on content/CTAs). */
  const peek = useSharedValue(0);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePeek = () => { if (peekTimer.current) clearTimeout(peekTimer.current); peek.value = withSpring(0, { damping: 16 }); peekTimer.current = setTimeout(() => { peek.value = withSpring(1, { damping: 16 }); }, 3200); };
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [open, setOpen] = useState(false);
  const [tapKey, setTapKey] = useState(0);
  const [tip, setTip] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const start = useRef({ x: 0, y: 0 });

  // Keep inside bounds on rotation / resize.
  useEffect(() => {
    x.value = withSpring(side === 'right' ? rightX : MARGIN, { damping: 18 });
    y.value = withSpring(Math.min(maxY, Math.max(minY, y.value)), { damping: 18 });
  }, [W, H, rightX, minY, maxY, side, x, y]);

  useEffect(() => {
    if (reduce) return;
    bob.value = withRepeat(withSequence(withTiming(-6, { duration: 1500, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.sin) })), -1);
  }, [reduce, bob]);

  // Contextual tip once per screen per session.
  useEffect(() => {
    setTip(null); // never carry the previous screen's tip over
    if (!route || seen.current.has(route)) return;
    const show = setTimeout(() => { const o = getTipOverride(route); if (o === '') { if (peekTimer.current) clearTimeout(peekTimer.current); peek.value = withSpring(1, { damping: 16 }); return; } seen.current.add(route); setTip(o ?? TIPS[context]); if (peekTimer.current) clearTimeout(peekTimer.current); peek.value = withSpring(0, { damping: 16 }); }, 700);
    const hide = setTimeout(() => { setTip(null); schedulePeek(); }, 700 + 5200);
    return () => { clearTimeout(show); clearTimeout(hide); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, context]);
  useEffect(() => { schedulePeek(); return () => { if (peekTimer.current) clearTimeout(peekTimer.current); }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSheet = () => { schedulePeek(); setTapKey((k) => k + 1); haptic.select(); setTip(null); setTimeout(() => setOpen(true), 160); };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { if (peekTimer.current) clearTimeout(peekTimer.current); peek.value = withSpring(0, { damping: 16 }); start.current = { x: x.value, y: y.value }; lift.value = withSpring(1.12, { damping: 12 }); },
    onPanResponderMove: (_, g) => { x.value = start.current.x + g.dx; y.value = start.current.y + g.dy; },
    onPanResponderRelease: (_, g) => { lift.value = withSpring(1, { damping: 12 }); release(g.dx, g.dy, g.moveX); },
    onPanResponderTerminate: (_, g) => { lift.value = withSpring(1, { damping: 12 }); release(g.dx, g.dy, g.moveX); },
  })).current;
  // Latest layout values for the (stable) responder callbacks.
  const geo = useRef({ W, rightX, minY, maxY });
  geo.current = { W, rightX, minY, maxY };
  const tapRef = useRef(openSheet);
  tapRef.current = openSheet;
  function release(dx: number, dy: number, moveX: number) {
    const g = geo.current;
    if (Math.abs(dx) + Math.abs(dy) < 6) { x.value = withSpring(start.current.x); y.value = withSpring(start.current.y); tapRef.current(); peekRef.current(); return; }
    const toRight = (moveX || start.current.x + dx + SIZE / 2) > g.W / 2;
    x.value = withSpring(toRight ? g.rightX : MARGIN, { damping: 15, stiffness: 170 });
    y.value = withSpring(Math.min(g.maxY, Math.max(g.minY, start.current.y + dy)), { damping: 15, stiffness: 170 });
    setSide(toRight ? 'right' : 'left');
    haptic.select();
    peekRef.current();
  }
  const peekRef = useRef(schedulePeek);
  peekRef.current = schedulePeek;

  const half = W / 2;
  const wrap = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + peek.value * SIZE * 0.45 * (x.value > half - SIZE / 2 ? 1 : -1) }, { translateY: y.value + bob.value }, { scale: lift.value }] }));
  const body = useAnimatedStyle(() => ({ opacity: 1 - peek.value * 0.15 }));
  const shadow = useAnimatedStyle(() => ({ opacity: (0.08 + bob.value * 0.008) * (1 - peek.value), transform: [{ scaleX: 1 + bob.value * 0.03 }] }));

  return (
    <>
      <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, zIndex: 50 }, wrap]}>
        {tip && (
          <Animated.View entering={reduce ? undefined : ZoomIn.springify().damping(14)} exiting={FadeOut.duration(180)}
            style={[{ position: 'absolute', top: -4, width: Math.min(236, W - SIZE - MARGIN * 4), [side === 'right' ? 'right' : 'left']: SIZE + 10 }]}>
            <Pressable onPress={openSheet} accessibilityRole="button" accessibilityLabel={`${ASSISTANT_NAME} says: ${tip} Tap to ask more`}
              style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.sm, paddingRight: space.lg, borderWidth: 1.5, borderColor: colors.accent }, elevation.raised as object]}>
              <Text variant="label" color={colors.primary}>{ASSISTANT_NAME}</Text>
              <Text variant="caption" color={colors.text}>{tip}</Text>
              <Pressable onPress={() => { setTip(null); schedulePeek(); }} hitSlop={10} accessibilityLabel="Dismiss tip" style={{ position: 'absolute', right: 6, top: 6 }}>
                <Icon name="close" size={14} color={colors.textSecondary} />
              </Pressable>
            </Pressable>
          </Animated.View>
        )}
        <Animated.View style={[{ position: 'absolute', bottom: -10, left: 16, width: SIZE - 32, height: 6, borderRadius: 6, backgroundColor: '#000' }, shadow]} />
        <Animated.View style={body}>
        <View {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={`${ASSISTANT_NAME}, your assistant. Tap for help, drag to move`}
          style={[{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' }, { cursor: 'grab' } as object]}>
          <Zippy size={SIZE} speaking={!!tip} tapKey={tapKey} />
        </View>
        </Animated.View>
      </Animated.View>
      <AssistantSheet visible={open} onClose={() => setOpen(false)} context={context} />
    </>
  );
}
