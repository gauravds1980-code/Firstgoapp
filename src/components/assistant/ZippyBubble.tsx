import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ASSISTANT_NAME } from '../../config/brand';
import { gutter, space, touch } from '../../theme/tokens';
import { haptic } from '../../utils/haptics';
import { AssistantSheet } from '../AssistantSheet';
import { DOCK_MINI_SIZE, DOCK_SLOT_SIZE, markZippyLanded } from './HeaderDockSlot';
import { getTipOverride, ROUTE_CONTEXT, TIPS } from './tips';
import { RIDE_EXTRA, rideOverhang, ZippyRide } from './ZippyRide';
import { ZippyCharacter } from './ZippyCharacter';
import { useRouteHelp } from './zippySection';
import { measureActiveSlot, useRouteMood, useZippyStore, zippyDock, zippyTip } from './zippyStore';
import { useApp } from '../../state/AppState';
import { VoiceMicBadge } from '../../voice/VoiceMicBadge';
import { useVoiceSession } from '../../voice/voiceSession';

const SIZE = 60;
/** The vehicle mount hangs below the orb box; keep it clear of CTAs too. */
const RIDE_H = Math.round(SIZE * RIDE_EXTRA);
const MARGIN = 8;
/** Keep clear of the header (top) and of sticky CTA bars + the bottom-centre Scan QR FAB (bottom). */
const TOP_CLEAR = 76;
const BOTTOM_CLEAR = 216;
/** Extra room above a sticky footer: the bottom safe zone where the tip slot appears. */
const TIP_ZONE = 72;
/** Hold this long on Zippy (without dragging) to dock it in the header. */
const LONG_PRESS_MS = 550;
/** How long a tip stays up before it auto-dismisses. */
const TIP_MS = 5200;
/**
 * Right-hand lane (dp from the screen's right edge) that floating Zippy can occupy at rest on the right:
 * edge margin + body + vehicle overhang + a little breathing room. Screens leave tappable links
 * (e.g. Home's section "View all") out of this lane so an opted-in floating Zippy never covers them.
 */
export const ZIPPY_RIGHT_LANE = Math.ceil(MARGIN + SIZE + rideOverhang(SIZE) + 16);
const DOCK_MS = 560;
const RETURN_MS = 650;
const MINI_SCALE = DOCK_MINI_SIZE / SIZE;

/**
 * Global assistant, rendered once over the navigator on every screen.
 * v1.2.4 (design review #1):
 *  - DOCKED in the header by default (HeaderDockSlot draws the face: tap = help sheet, long-press = float).
 *  - The once-per-screen tip is no longer a balloon beside the orb: it is published to the focused
 *    screen's ZippyTipSlot, anchored above the sticky footer / Scan QR FAB, and auto-dismisses.
 *  - One close control: the tip's own ✕. There is no ✕ badge beside Zippy any more; long-press the
 *    floating orb (or use the sheet menu) to dock it.
 * Floating (opt-in, persisted as `firstgo.zippy.float`): drag anywhere → snaps to the nearest side edge;
 * vertical position is clamped above the sticky footer + tip zone and the Scan QR FAB.
 */
export function ZippyBubble({ route }: { route?: string }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const { phase, tip: tipState, sheetRequest } = useZippyStore();
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const context = ROUTE_CONTEXT[route ?? ''] ?? 'home';
  const routeMood = useRouteMood(route);
  const voice = useVoiceSession();
  const mood = voice.mood ?? routeMood;
  const { session, product } = useApp();
  // Signed in → Zippy rides the dealer's (Home-selected) product; auth screens show the bare character.
  const rideProduct = session ? product : undefined;
  const { footer } = useRouteHelp(route);
  const minY = insets.top + TOP_CLEAR;
  // Never cover the primary CTA: stay above the measured sticky footer (and the Home Scan QR FAB zone).
  const bottomClear = Math.max(insets.bottom + BOTTOM_CLEAR, footer + TIP_ZONE + space.md);
  const maxY = Math.max(minY, H - bottomClear - SIZE - (rideProduct ? RIDE_H : 0));
  const [moving, setMoving] = useState(false);
  const [driveKey, setDriveKey] = useState(0);
  const rightX = W - SIZE - MARGIN;
  const x = useSharedValue(rightX);
  const y = useSharedValue(maxY); // rests low on the right, just above the CTA / Scan QR zone
  const bob = useSharedValue(0);
  const lift = useSharedValue(1);
  /** 1 floating; MINI_SCALE when shrunk into the header. */
  const dockScale = useSharedValue(1);
  /** 0 = fully visible, 1 = peeking (tucked 45% behind the edge so it never sits on content/CTAs). */
  const peek = useSharedValue(0);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPeek = () => { if (peekTimer.current) clearTimeout(peekTimer.current); peekTimer.current = null; };
  const schedulePeek = () => {
    clearPeek();
    if (phaseRef.current !== 'floating') return;
    peek.value = withSpring(0, { damping: 16 });
    peekTimer.current = setTimeout(() => { if (phaseRef.current === 'floating') peek.value = withSpring(1, { damping: 16 }); }, 3200);
  };
  const [side, setSide] = useState<'left' | 'right'>('right');
  const sideRef = useRef(side);
  sideRef.current = side;
  const [open, setOpen] = useState(false);
  const [tapKey, setTapKey] = useState(0);
  const tip = tipState && tipState.route === route ? tipState.text : null;
  const seen = useRef(new Set<string>());
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const start = useRef({ x: 0, y: 0 });
  const origin = useRef<React.ComponentRef<typeof View>>(null);

  // Latest layout values for stable callbacks (responder, timers, flight).
  const geo = useRef({ W, rightX, minY, maxY, top: insets.top });
  geo.current = { W, rightX, minY, maxY, top: insets.top };

  useEffect(() => { zippyDock.hydrate(); return () => { clearPeek(); if (flightTimer.current) clearTimeout(flightTimer.current); }; }, []);

  // Keep inside bounds on rotation / resize (not mid-flight or while docked).
  useEffect(() => {
    if (phaseRef.current !== 'floating') return;
    x.value = withSpring(sideRef.current === 'right' ? rightX : MARGIN, { damping: 18 });
    y.value = withSpring(Math.min(maxY, Math.max(minY, y.value)), { damping: 18 });
  }, [W, H, rightX, minY, maxY, x, y]);

  // Float + peek only while floating; stop the loop when docked.
  useEffect(() => {
    if (phase === 'floating') {
      if (!reduce) bob.value = withRepeat(withSequence(withTiming(-6, { duration: 1500, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.sin) })), -1);
      schedulePeek();
    } else if (phase === 'docked') {
      cancelAnimation(bob); bob.value = 0; clearPeek();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduce]);

  // Contextual tip once per screen per session, docked or floating. It is shown by the screen's
  // ZippyTipSlot (above the footer / FAB), and auto-dismisses after TIP_MS.
  useEffect(() => {
    zippyTip.hide(); // never carry the previous screen's tip over
    if (!route || seen.current.has(route)) return;
    let shownId = -1;
    const show = setTimeout(() => {
      const o = getTipOverride(route);
      clearPeek();
      if (o === '') { if (phaseRef.current === 'floating') peek.value = withSpring(1, { damping: 16 }); return; }
      seen.current.add(route);
      shownId = zippyTip.show(route, o ?? TIPS[context]);
      if (phaseRef.current === 'floating') peek.value = withSpring(0, { damping: 16 });
    }, 700);
    const hide = setTimeout(() => { zippyTip.hide(shownId); schedulePeek(); }, 700 + TIP_MS);
    return () => { clearTimeout(show); clearTimeout(hide); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, context]);

  // Docked face tapped, or the tip bubble tapped → open the help sheet.
  const firstSheetRequest = useRef(sheetRequest);
  useEffect(() => {
    if (sheetRequest === firstSheetRequest.current) return;
    haptic.select(); setTapKey((k) => k + 1); setOpen(true);
  }, [sheetRequest]);

  /** Centre of the focused header slot in this overlay's coordinates (both measured in window space, so offsets cancel). */
  const measureTarget = (cb: (p: { cx: number; cy: number }) => void) => {
    const g = geo.current;
    const fallback = { cx: g.W - gutter.screen - touch.min - space.xs - DOCK_SLOT_SIZE / 2, cy: g.top + 32 };
    measureActiveSlot((r) => {
      if (!r) { cb(fallback); return; }
      const o = origin.current;
      if (!o) { cb({ cx: r.x + r.width / 2, cy: r.y + r.height / 2 }); return; }
      o.measureInWindow((ox, oy) => cb({ cx: r.x - ox + r.width / 2, cy: r.y - oy + r.height / 2 }));
    });
  };

  const dock = () => {
    if (phaseRef.current !== 'floating') return;
    haptic.select();
    zippyTip.hide(); clearPeek();
    zippyDock.setPhase('docking');
    zippyDock.persist(true);
    measureTarget(({ cx, cy }) => {
      const tx = cx - SIZE / 2, ty = cy - SIZE / 2;
      const land = () => { if (phaseRef.current === 'docking') { markZippyLanded(); zippyDock.setPhase('docked'); } };
      cancelAnimation(bob);
      if (reduce) { bob.value = 0; peek.value = 0; x.value = tx; y.value = ty; dockScale.value = MINI_SCALE; land(); return; }
      bob.value = withTiming(0, { duration: 140 });
      peek.value = withTiming(0, { duration: 120 });
      // Little crouch, then an arc up into the header: y leads (ease-out), x follows (ease-in-out).
      x.value = withTiming(tx, { duration: DOCK_MS, easing: Easing.inOut(Easing.cubic) });
      y.value = withSequence(withTiming(y.value + 12, { duration: 110, easing: Easing.out(Easing.quad) }), withTiming(ty, { duration: DOCK_MS - 110, easing: Easing.out(Easing.cubic) }));
      dockScale.value = withSequence(withTiming(1.08, { duration: 110 }), withTiming(MINI_SCALE, { duration: DOCK_MS - 110, easing: Easing.inOut(Easing.quad) }));
      if (flightTimer.current) clearTimeout(flightTimer.current);
      flightTimer.current = setTimeout(land, DOCK_MS + 30);
    });
  };

  // Docked face tapped → start at the slot, fly back down to the lower-right rest spot. Does not open the sheet.
  useEffect(() => {
    if (phase !== 'undocking') return;
    measureTarget(({ cx, cy }) => {
      const g = geo.current;
      x.value = cx - SIZE / 2; y.value = cy - SIZE / 2; dockScale.value = MINI_SCALE; peek.value = 0; bob.value = 0;
      setSide('right'); sideRef.current = 'right';
      zippyDock.persist(false);
      zippyDock.setPhase('returning');
      const done = () => { if (phaseRef.current === 'returning') { zippyDock.setPhase('floating'); setDriveKey((k) => k + 1); if (!reduce) setTapKey((k) => k + 1); } };
      if (reduce) { x.value = g.rightX; y.value = g.maxY; dockScale.value = 1; done(); return; }
      x.value = withSpring(g.rightX, { damping: 16, stiffness: 120 });
      y.value = withSpring(g.maxY, { damping: 14, stiffness: 110 });
      dockScale.value = withSequence(withTiming(1.12, { duration: 320, easing: Easing.out(Easing.quad) }), withSpring(1, { damping: 8, stiffness: 200 }));
      if (flightTimer.current) clearTimeout(flightTimer.current);
      flightTimer.current = setTimeout(done, RETURN_MS);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const openSheet = () => { schedulePeek(); setTapKey((k) => k + 1); haptic.select(); zippyTip.hide(); setTimeout(() => setOpen(true), 160); };

  const clearLongPress = () => { if (longPress.current.timer) clearTimeout(longPress.current.timer); longPress.current.timer = null; };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => phaseRef.current === 'floating',
    onMoveShouldSetPanResponder: (_, g) => phaseRef.current === 'floating' && Math.abs(g.dx) + Math.abs(g.dy) > 4,
    onPanResponderGrant: () => {
      clearPeek(); peek.value = withSpring(0, { damping: 16 }); start.current = { x: x.value, y: y.value }; lift.value = withSpring(1.12, { damping: 12 });
      // Long-press (no drag) docks Zippy in the header — the only "hide" gesture, no separate ✕.
      clearLongPress(); longPress.current.fired = false;
      longPress.current.timer = setTimeout(() => { longPress.current.fired = true; lift.value = withSpring(1, { damping: 12 }); dockRef.current(); }, LONG_PRESS_MS);
    },
    onPanResponderMove: (_, g) => {
      if (longPress.current.fired) return;
      x.value = start.current.x + g.dx; y.value = start.current.y + g.dy;
      if (Math.abs(g.dx) + Math.abs(g.dy) > 6) { clearLongPress(); movingRef.current(true); }
    },
    onPanResponderRelease: (_, g) => { clearLongPress(); lift.value = withSpring(1, { damping: 12 }); movingRef.current(false); if (!longPress.current.fired) release(g.dx, g.dy, g.moveX); },
    onPanResponderTerminate: (_, g) => { clearLongPress(); lift.value = withSpring(1, { damping: 12 }); movingRef.current(false); if (!longPress.current.fired) release(g.dx, g.dy, g.moveX); },
  })).current;
  const dockRef = useRef(dock);
  dockRef.current = dock;
  const movingRef = useRef((m: boolean) => setMoving(m)); // setState is stable; wheels roll while dragged
  const tapRef = useRef(openSheet);
  tapRef.current = openSheet;
  const peekRef = useRef(schedulePeek);
  peekRef.current = schedulePeek;
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

  const half = W / 2;
  const wrap = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + peek.value * SIZE * 0.45 * (x.value > half - SIZE / 2 ? 1 : -1) }, { translateY: y.value + bob.value }, { scale: lift.value * dockScale.value }] }));
  const body = useAnimatedStyle(() => ({ opacity: 1 - peek.value * 0.15 }));
  const shadow = useAnimatedStyle(() => {
    const grounded = Math.max(0, Math.min(1, (dockScale.value - MINI_SCALE) / (1 - MINI_SCALE)));
    return { opacity: (0.08 + bob.value * 0.008) * (1 - peek.value) * grounded, transform: [{ scaleX: 1 + bob.value * 0.03 }] };
  });

  const floating = phase === 'floating';
  const showOverlay = floating || phase === 'docking' || phase === 'returning';
  // Sheet menu: dock (hide) a floating Zippy, or float a docked one.
  const toggleDock = () => {
    setOpen(false);
    setTimeout(() => { if (phaseRef.current === 'floating') dock(); else zippyDock.requestUndock(); }, 260);
  };
  return (
    <>
      <View ref={origin} collapsable={false} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1 }} />
      {showOverlay && (
        <Animated.View pointerEvents={floating ? 'box-none' : 'none'} style={[{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, zIndex: 50, overflow: 'visible' }, wrap]}>
          <Animated.View style={[{ position: 'absolute', bottom: rideProduct ? -RIDE_H - 4 : -10, left: rideProduct ? 4 : 16, width: rideProduct ? SIZE - 8 : SIZE - 32, height: 6, borderRadius: 6, backgroundColor: '#000' }, shadow]} />
          <Animated.View style={body}>
            <View {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={`${ASSISTANT_NAME}, your assistant. Tap for help, drag to move`}
              accessibilityHint="Long-press to dock in the header" accessibilityActions={[{ name: 'longpress', label: 'Dock in the header' }]}
              onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') dock(); }}
              style={[{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' }, { cursor: 'grab' } as object]}>
              {rideProduct && floating
                ? <ZippyRide size={SIZE} product={rideProduct} mood={mood} speaking={!!tip || open || voice.speaking} tapKey={tapKey} moving={moving} driveKey={driveKey} />
                : <ZippyCharacter size={SIZE} mood={mood} speaking={!!tip || open || voice.speaking} tapKey={tapKey} />}
            </View>
          </Animated.View>
          {/* Push-to-talk badge: a sibling of the pan view (not a child), so tap = sheet / long-press = dock still
              belong to the orb. Sits on the inward side so it stays visible when Zippy peeks behind the edge. */}
          {floating && (
            <VoiceMicBadge size={22} style={{ bottom: -2, ...(side === 'right' ? { left: -2 } : { right: -2 }) }}
              onPressIn={() => { clearPeek(); peek.value = withSpring(0, { damping: 16 }); }} onPressOut={() => schedulePeek()} />
          )}
        </Animated.View>
      )}
      <AssistantSheet visible={open} onClose={() => setOpen(false)} context={context} route={route} product={rideProduct}
        docked={!floating} onToggleDock={phase === 'floating' || phase === 'docked' ? toggleDock : undefined} />
    </>
  );
}
