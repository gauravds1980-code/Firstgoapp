import React, { useEffect, useRef, useState } from 'react';
import { PanResponder, Platform, useWindowDimensions, View } from 'react-native';
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
import type { ProductId } from '../../config/products';
import { type Overhang, RIDE_EXTRA, rideBounds, ZippyRide } from './ZippyRide';
import { ZippyCharacter } from './ZippyCharacter';
import { useRouteHelp } from './zippySection';
import { type Box, isZippyHidden, measureZippyAvoid, pickZippyRest, useZippyAvoidVersion } from './zippyAvoid';
import { measureActiveSlot, useRouteMood, useZippyStore, zippyDock, zippyTip } from './zippyStore';
import { useApp } from '../../state/AppState';
import { type NudgeAnchor, TutorialNudgeBubble } from '../tutorial/TutorialNudgeBubble';
import { useTutorialState } from '../../tutorial/tutorialStore';
import { useKeyboardHeight } from '../keyboard';

const SIZE = 60;
/** The vehicle mount hangs below the orb box; keep it clear of CTAs too. */
const RIDE_H = Math.round(SIZE * RIDE_EXTRA);
const MARGIN = 8;
/** Keep clear of the header (top). The bottom clearance comes from the screen's reported footer (sticky CTA
 *  bar, Home's Scan QR FAB, Scan QR's buttons) plus the tip zone above it. */
const TOP_CLEAR = 76;
/** Extra room above a sticky footer: the bottom safe zone where the tip slot appears. */
const TIP_ZONE = 72;
/** Hold this long on Zippy (without dragging) to dock it in the header. */
const LONG_PRESS_MS = 550;
/** How long a tip stays up before it auto-dismisses. */
const TIP_MS = 5200;
/** Floating bob amplitude (dp, upwards). */
const BOB = 6;
/** Movement (dx + dy, dp) below which a touch is a tap, not a drag. */
const DRAG_SLOP = 6;
/** Top band of the header (below the status bar) that counts as "drop to dock"… */
const HEADER_BAND = 64;
/** …as does anywhere this close (orb centre → slot centre) to the focused header slot. */
const DOCK_SNAP_RADIUS = 56;
/** Ground shadow under the orb / ride: gap below the drawn body and its height. */
const SHADOW_H = 6;
const SHADOW_BOTTOM = (ride: boolean) => (ride ? RIDE_H + 4 : 10);

/**
 * v1.2.9: everything floating Zippy draws outside its SIZE × SIZE box (ride overhang, rider sparkles /
 * hop, ground shadow), rounded up. Bounds use this, so the whole body always stays on screen.
 */
export function zippyOverhang(product?: ProductId): Overhang {
  if (!product) {
    const spark = Math.ceil(SIZE * 0.06); // 'cheer' sparkles sit 6% outside the character box
    return { left: spark, right: spark, top: Math.ceil(SIZE * 0.12), bottom: SHADOW_BOTTOM(false) };
  }
  const r = rideBounds(product, SIZE);
  return { left: Math.ceil(r.left), right: Math.ceil(r.right), top: Math.ceil(r.top), bottom: Math.ceil(Math.max(r.bottom, SHADOW_BOTTOM(true))) };
}
const ALL_PRODUCTS: ProductId[] = ['twoWheeler', 'car', 'cv'];
/**
 * v1.3.0 safe gutter: bottom padding for scrolling screens, so the last card can always be scrolled fully
 * above floating Zippy's lowest rest spot (tip zone + the tallest body, ride and bob included).
 */
export const ZIPPY_SAFE_GUTTER = Math.ceil(TIP_ZONE + space.md + SIZE + BOB + Math.max(...ALL_PRODUCTS.map((p) => zippyOverhang(p).top + zippyOverhang(p).bottom)));
const DOCK_MS = 560;
const RETURN_MS = 650;
const MINI_SCALE = DOCK_MINI_SIZE / SIZE;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Global assistant, rendered once over the navigator on every screen.
 * v1.2.9: FLOATING by default (persisted as `firstgo.zippy.dock.v129`). Floating Zippy always stays fully
 * inside the safe area: x / y are clamped so the orb AND everything hanging off it (ride overhang,
 * sparkles, hop, shadow) are on screen — on placement, drag, release, edge snap, rotation / resize /
 * safe-area / keyboard changes and after returning from the header. No peek-behind-the-edge any more.
 * Drag it up into the header (the focused HeaderDockSlot highlights "drop to dock") to dock it;
 * drag the docked face down out of the header to float it again.
 * v1.2.4 (design review #1):
 *  - Docked: HeaderDockSlot draws the face (tap = help sheet, long-press / drag down = float).
 *  - The once-per-screen tip is no longer a balloon beside the orb: it is published to the focused
 *    screen's ZippyTipSlot, anchored above the sticky footer / Scan QR FAB, and auto-dismisses.
 *  - One close control: the tip's own ✕. There is no ✕ badge beside Zippy any more; long-press the
 *    floating orb (or use the sheet menu) to dock it.
 * Floating: drag anywhere → snaps to the nearest side edge (whole body visible);
 * vertical position is clamped above the sticky footer + tip zone and the Scan QR FAB.
 * v1.3.0: floating Zippy keeps off the focused screen's controls and key values (ZippyAvoid rects, with
 * a ZIPPY_AVOID_GAP gutter): it picks a clear rest spot per screen and nudges itself off anything a
 * layout / scroll change or a drop puts under it. Screens can hide it (useZippyHidden, e.g. face capture).
 * v1.2.8: no mic on the orb and no voice-driven mood / lips. v1.4.2: the voice mic (VoiceMic) is a
 * bottom-right disc just above the footer; Zippy's lowest rest spot (footer + tip zone) stays clear of it.
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
  const mood = routeMood;
  const { session, product } = useApp();
  // Signed in → Zippy rides the dealer's (Home-selected) product; auth screens show the bare character.
  const rideProduct = session ? product : undefined;
  const { footer } = useRouteHelp(route);
  const ext = zippyOverhang(rideProduct);
  // Keyboard up → less room at the bottom (the Android window never resizes: edge-to-edge). Shared
  // listener (./keyboard). On web the window dims already follow the visual viewport, so no extra offset.
  const kbRaw = useKeyboardHeight();
  const kb = Platform.OS === 'web' ? 0 : kbRaw;
  // v1.3.1: while the dealer types, floating Zippy steps aside so it never sits on the focused field or
  // the lifted CTA. It comes back when the keyboard closes; a docked (header) Zippy is unaffected.
  const typing = kbRaw > 0;
  // Resting bounds for the orb box's top-left corner, so the full visual body stays on screen.
  const minX = insets.left + MARGIN + ext.left;
  const maxX = Math.max(minX, W - insets.right - MARGIN - SIZE - ext.right);
  const minY = insets.top + TOP_CLEAR + ext.top + BOB;
  // Never cover the primary CTA: stay above the measured sticky footer / Scan QR FAB / scanner buttons
  // (each screen reports it; it already includes the bottom inset) and the tip zone above it.
  const bottomClear = Math.max(footer, insets.bottom) + TIP_ZONE + space.md;
  const maxY = Math.max(minY, H - kb - bottomClear - SIZE - ext.bottom);
  /** While dragging: anywhere on screen with the whole body visible (the header too, to dock). */
  const dragMinY = insets.top + ext.top;
  const dragMaxY = Math.max(dragMinY, H - kb - insets.bottom - MARGIN - SIZE - ext.bottom);
  const [moving, setMoving] = useState(false);
  const [driveKey, setDriveKey] = useState(0);
  const x = useSharedValue(maxX);
  const y = useSharedValue(maxY); // rests low on the right, just above the CTA / Scan QR zone
  /** Where Zippy is resting / heading (the spring target, not the in-flight value). */
  const restRef = useRef<{ x: number; y: number } | null>(null);
  /** True while the finger is on the orb: auto-placement waits for the release. */
  const draggingRef = useRef(false);
  const routeRef = useRef(route);
  routeRef.current = route;
  const avoidVersion = useZippyAvoidVersion();
  const hiddenHere = isZippyHidden(route);
  const bob = useSharedValue(0);
  const lift = useSharedValue(1);
  /** 1 floating; MINI_SCALE when shrunk into the header. */
  const dockScale = useSharedValue(1);
  /** 0 = awake, 1 = resting (slightly faded). v1.2.9: no longer tucks behind the screen edge. */
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
  const geo = useRef({ W, minX, maxX, minY, maxY, dragMinY, dragMaxY, top: insets.top });
  geo.current = { W, minX, maxX, minY, maxY, dragMinY, dragMaxY, top: insets.top };
  /** Focused header slot centre (overlay coords) measured at drag start; null = this screen has no slot. */
  const dragSlot = useRef<{ cx: number; cy: number } | null>(null);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  useEffect(() => { zippyDock.hydrate(); return () => { clearPeek(); if (flightTimer.current) clearTimeout(flightTimer.current); }; }, []);

  // design-a: route-level dock default. Portfolio / Cases / Payouts / TA-INF present Zippy docked (never
  // persisted, so Home keeps floating); leaving them floats it again unless the dealer docked it globally.
  useEffect(() => {
    const d = zippyDock.applyRouteDefault(route);
    if (d === 'dock') { zippyTip.hide(); clearPeek(); cancelAnimation(bob); bob.value = 0; }
    if (d === 'float') { dockScale.value = 1; peek.value = 0; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, phase]);

  // Keep the whole body inside bounds on placement, rotation / resize / split screen, safe-area, footer
  // and keyboard changes (not mid-flight or while docked). Snaps to the current side's edge.
  const prevPhase = useRef(phase);
  useEffect(() => {
    const from = prevPhase.current;
    prevPhase.current = phase;
    if (phase !== 'floating') return;
    const tx = sideRef.current === 'right' ? maxX : minX;
    const ty = from === 'hydrating' ? maxY : clamp(restRef.current?.y ?? y.value, minY, maxY);
    restRef.current = { x: tx, y: ty };
    if (reduce || from === 'hydrating') { x.value = tx; y.value = ty; return; } // initial placement: instant
    x.value = withSpring(tx, { damping: 18 });
    y.value = withSpring(ty, { damping: 18 });
  }, [phase, minX, maxX, minY, maxY, reduce, x, y]);

  // Float + peek only while floating; stop the loop when docked.
  useEffect(() => {
    if (phase === 'floating') {
      if (!reduce) bob.value = withRepeat(withSequence(withTiming(-BOB, { duration: 1500, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.sin) })), -1);
      schedulePeek();
    } else if (phase === 'docked') {
      cancelAnimation(bob); bob.value = 0; clearPeek();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduce]);

  /** Orb top-left → everything floating Zippy draws (ride overhang, sparkles, bob, shadow). */
  const bodyBox = (bx: number, by: number): Box => ({ left: bx - ext.left, top: by - ext.top - BOB, right: bx + SIZE + ext.right, bottom: by + SIZE + ext.bottom });
  const bodyRef = useRef(bodyBox);
  bodyRef.current = bodyBox;

  /**
   * v1.3.0 auto-placement. Measures the focused screen's avoid-rects (ZippyAvoid: controls and key values)
   * and moves floating Zippy to a rest spot that covers none of them.
   *  - 'default' (new screen): lowest spot on Zippy's side (lower-right unless the dealer moved it left),
   *    then upwards along that edge, then the other edge.
   *  - 'nudge' (layout / scroll / data change, or Zippy dropped on a control): stay unless the current
   *    spot covers something; otherwise slide to the nearest clear spot.
   */
  const placeSeq = useRef(0);
  const place = (mode: 'default' | 'nudge') => {
    const seq = ++placeSeq.current;
    measureZippyAvoid(routeRef.current, (rects) => {
      const go = (ox: number, oy: number) => {
        if (seq !== placeSeq.current || phaseRef.current !== 'floating' || draggingRef.current) return;
        const g = geo.current;
        const cur = restRef.current ?? { x: sideRef.current === 'right' ? g.maxX : g.minX, y: g.maxY };
        const best = pickZippyRest({
          rects: rects.map((r) => ({ ...r, x: r.x - ox, y: r.y - oy })),
          minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY, body: bodyRef.current, side: sideRef.current, mode, from: cur,
        });
        if (!best || (best.x === cur.x && best.y === cur.y)) return;
        restRef.current = { x: best.x, y: best.y };
        setSide(best.side); sideRef.current = best.side;
        if (reduceRef.current) { x.value = best.x; y.value = best.y; }
        else { x.value = withSpring(best.x, { damping: 18 }); y.value = withSpring(best.y, { damping: 18 }); }
      };
      const o = origin.current;
      if (!o) go(0, 0); else o.measureInWindow((ox, oy) => go(ox, oy));
    });
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  // Re-run on route change (after the screen transition settles), and on any layout / scroll / bounds change.
  const placedRoute = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (phase !== 'floating' || hiddenHere) return;
    const fresh = placedRoute.current !== route;
    const t = setTimeout(() => { placedRoute.current = route; placeRef.current(fresh ? 'default' : 'nudge'); }, fresh ? 450 : 180);
    return () => clearTimeout(t);
  }, [route, avoidVersion, phase, hiddenHere, minX, maxX, minY, maxY]);

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
  const measureTarget = (cb: (p: { cx: number; cy: number; real: boolean }) => void) => {
    const g = geo.current;
    const fallback = { cx: g.W - gutter.screen - touch.min * 2 - space.xs - DOCK_SLOT_SIZE / 2, cy: g.top + 32, real: false }; // dock slot sits left of the mic + Home
    measureActiveSlot((r) => {
      if (!r) { cb(fallback); return; }
      const o = origin.current;
      if (!o) { cb({ cx: r.x + r.width / 2, cy: r.y + r.height / 2, real: true }); return; }
      o.measureInWindow((ox, oy) => cb({ cx: r.x - ox + r.width / 2, cy: r.y - oy + r.height / 2, real: true }));
    });
  };
  /** Window point → this overlay's coordinates. */
  const toLocal = (p: { x: number; y: number } | null, cb: (q: { x: number; y: number } | null) => void) => {
    const o = origin.current;
    if (!p || !o) { cb(p); return; }
    o.measureInWindow((ox, oy) => cb({ x: p.x - ox, y: p.y - oy }));
  };

  const dock = () => {
    if (phaseRef.current !== 'floating') return;
    haptic.select();
    zippyTip.hide(); clearPeek(); zippyDock.setDropHint(false);
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

  // Docked face dragged out of the header / long-pressed / sheet menu → start at the slot and fly down to
  // the drag-out point (snapped to the nearest side edge, clamped) or the lower-right rest spot.
  useEffect(() => {
    if (phase !== 'undocking') return;
    const at = zippyDock.takeUndockAt();
    measureTarget(({ cx, cy }) => toLocal(at, (p) => {
      const g = geo.current;
      x.value = cx - SIZE / 2; y.value = cy - SIZE / 2; dockScale.value = MINI_SCALE; peek.value = 0; bob.value = 0;
      const right = p ? p.x > g.W / 2 : true;
      const tx = right ? g.maxX : g.minX;
      const ty = p ? clamp(p.y - SIZE / 2, g.minY, g.maxY) : g.maxY;
      restRef.current = { x: tx, y: ty };
      setSide(right ? 'right' : 'left'); sideRef.current = right ? 'right' : 'left';
      // A dealer undock on a data screen holds for the rest of that visit (route default re-applies next visit).
      zippyDock.noteUndock(routeRef.current);
      zippyDock.persist(false);
      zippyDock.setPhase('returning');
      const done = () => { if (phaseRef.current === 'returning') { zippyDock.setPhase('floating'); setDriveKey((k) => k + 1); if (!reduce) setTapKey((k) => k + 1); } };
      if (reduce) { x.value = tx; y.value = ty; dockScale.value = 1; done(); return; }
      x.value = withSpring(tx, { damping: 16, stiffness: 120 });
      y.value = withSpring(ty, { damping: 14, stiffness: 110 });
      dockScale.value = withSequence(withTiming(1.12, { duration: 320, easing: Easing.out(Easing.quad) }), withSpring(1, { damping: 8, stiffness: 200 }));
      if (flightTimer.current) clearTimeout(flightTimer.current);
      flightTimer.current = setTimeout(done, RETURN_MS);
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // v1.3.0: Zippy's "drop a short" bubble, anchored next to the floating orb or under the docked face.
  const { nudge } = useTutorialState();
  const [nudgeAnchor, setNudgeAnchor] = useState<NudgeAnchor | null>(null);
  useEffect(() => {
    if (!nudge) { setNudgeAnchor(null); return; }
    zippyTip.hide(); // one Zippy message at a time
    if (phaseRef.current === 'floating') {
      clearPeek(); peek.value = withSpring(0, { damping: 16 });
      setNudgeAnchor({ kind: 'floating', x: x.value, y: y.value, size: SIZE, below: ext.bottom, side: sideRef.current });
      return;
    }
    measureTarget(({ cx, cy }) => setNudgeAnchor({ kind: 'docked', cx, cy, slot: DOCK_SLOT_SIZE }));
  // Re-anchor when Zippy docks / floats or snaps to the other side while the bubble is up.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge?.id, phase, side, maxY, W, H]);

  const openSheet = () => { schedulePeek(); setTapKey((k) => k + 1); haptic.select(); zippyTip.hide(); setTimeout(() => setOpen(true), 160); };

  const clearLongPress = () => { if (longPress.current.timer) clearTimeout(longPress.current.timer); longPress.current.timer = null; };
  /** Orb (top-left at nx, ny) over the header dock zone: the header band, or near the focused slot. */
  const inDockZone = (nx: number, ny: number) => {
    const slot = dragSlot.current;
    if (!slot) return false; // no header slot on this screen → nothing to dock into
    const cx = nx + SIZE / 2, cy = ny + SIZE / 2;
    return cy < geo.current.top + HEADER_BAND || Math.hypot(cx - slot.cx, cy - slot.cy) < DOCK_SNAP_RADIUS;
  };
  const endDrag = (g: { dx: number; dy: number }) => {
    clearLongPress(); lift.value = withSpring(1, { damping: 12 }); movingRef.current(false);
    draggingRef.current = false;
    const over = zippyDock.snapshotDropHint();
    zippyDock.setDropHint(false);
    if (longPress.current.fired) return;
    release(g.dx, g.dy, over);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => phaseRef.current === 'floating',
    onMoveShouldSetPanResponder: (_, g) => phaseRef.current === 'floating' && Math.abs(g.dx) + Math.abs(g.dy) > 4,
    onPanResponderGrant: () => {
      clearPeek(); peek.value = withSpring(0, { damping: 16 }); start.current = { x: x.value, y: y.value }; lift.value = withSpring(1.12, { damping: 12 });
      draggingRef.current = true;
      dragSlot.current = null;
      measureRef.current(({ cx, cy, real }) => { dragSlot.current = real ? { cx, cy } : null; });
      // Long-press (no drag) docks Zippy in the header; dragging it up into the header does too.
      clearLongPress(); longPress.current.fired = false;
      longPress.current.timer = setTimeout(() => { longPress.current.fired = true; lift.value = withSpring(1, { damping: 12 }); dockRef.current(); }, LONG_PRESS_MS);
    },
    onPanResponderMove: (_, g) => {
      if (longPress.current.fired) return;
      const b = geo.current;
      const nx = clamp(start.current.x + g.dx, b.minX, b.maxX);
      const ny = clamp(start.current.y + g.dy, b.dragMinY, b.dragMaxY);
      x.value = nx; y.value = ny;
      if (Math.abs(g.dx) + Math.abs(g.dy) > DRAG_SLOP) {
        clearLongPress(); movingRef.current(true);
        const over = inDockZoneRef.current(nx, ny);
        if (over !== zippyDock.snapshotDropHint()) { if (over) haptic.select(); zippyDock.setDropHint(over); }
      }
    },
    onPanResponderRelease: (_, g) => endDragRef.current(g),
    onPanResponderTerminate: (_, g) => endDragRef.current(g),
  })).current;
  const dockRef = useRef(dock);
  dockRef.current = dock;
  const measureRef = useRef(measureTarget);
  measureRef.current = measureTarget;
  const inDockZoneRef = useRef(inDockZone);
  inDockZoneRef.current = inDockZone;
  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;
  const movingRef = useRef((m: boolean) => setMoving(m)); // setState is stable; wheels roll while dragged
  const tapRef = useRef(openSheet);
  tapRef.current = openSheet;
  const peekRef = useRef(schedulePeek);
  peekRef.current = schedulePeek;
  function release(dx: number, dy: number, overDock: boolean) {
    const g = geo.current;
    const instant = reduceRef.current;
    if (Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) {
      // A tap: back to where it was (clamped), open the help sheet.
      const tx = clamp(start.current.x, g.minX, g.maxX), ty = clamp(start.current.y, g.minY, g.maxY);
      restRef.current = { x: tx, y: ty };
      if (instant) { x.value = tx; y.value = ty; } else { x.value = withSpring(tx); y.value = withSpring(ty); }
      tapRef.current(); peekRef.current(); return;
    }
    if (overDock) { dockRef.current(); return; } // dropped on the header → fly into the slot
    // Snap to the nearest side edge with the whole body visible.
    const cx = clamp(start.current.x + dx, g.minX, g.maxX) + SIZE / 2;
    const toRight = cx > g.W / 2;
    const tx = toRight ? g.maxX : g.minX;
    const ty = clamp(start.current.y + dy, g.minY, g.maxY);
    restRef.current = { x: tx, y: ty };
    if (instant) { x.value = tx; y.value = ty; }
    else { x.value = withSpring(tx, { damping: 15, stiffness: 170 }); y.value = withSpring(ty, { damping: 15, stiffness: 170 }); }
    setSide(toRight ? 'right' : 'left'); sideRef.current = toRight ? 'right' : 'left';
    haptic.select();
    peekRef.current();
    // Dropped on a control or a key value → slide it to the nearest clear spot instead of leaving it there.
    placeRef.current('nudge');
  }

  const wrap = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value + bob.value }, { scale: lift.value * dockScale.value }] }));
  const body = useAnimatedStyle(() => ({ opacity: 1 - peek.value * 0.15 }));
  const shadow = useAnimatedStyle(() => {
    const grounded = Math.max(0, Math.min(1, (dockScale.value - MINI_SCALE) / (1 - MINI_SCALE)));
    return { opacity: (0.08 + bob.value * 0.008) * grounded, transform: [{ scaleX: 1 + bob.value * 0.03 }] };
  });

  const floating = phase === 'floating';
  // Hidden on this screen (e.g. Face KYC capture) → no floating orb; it comes back when the screen clears the flag.
  // The shorts feed is full-screen video: no floating Zippy (or nudge bubble) over it.
  const showOverlay = (floating || phase === 'docking' || phase === 'returning') && !hiddenHere && !typing && route !== 'ShortsFeed';
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
          <Animated.View style={[{ position: 'absolute', bottom: -SHADOW_BOTTOM(!!rideProduct), left: rideProduct ? 4 : 16, width: rideProduct ? SIZE - 8 : SIZE - 32, height: SHADOW_H, borderRadius: SHADOW_H, backgroundColor: '#000' }, shadow]} />
          <Animated.View style={body}>
            <View {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={`${ASSISTANT_NAME}, your assistant. Tap for help, drag to move`}
              accessibilityHint="Drag into the header, or long-press, to dock it there" accessibilityActions={[{ name: 'longpress', label: 'Dock in the header' }]}
              onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') dock(); }}
              style={[{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' }, { cursor: 'grab' } as object]}>
              {rideProduct && floating
                ? <ZippyRide size={SIZE} product={rideProduct} mood={mood} speaking={!!tip || open || !!nudge} tapKey={tapKey} moving={moving} driveKey={driveKey} driveInMax={side === 'right' ? maxX - minX : 0} />
                : <ZippyCharacter size={SIZE} mood={mood} speaking={!!tip || open || !!nudge} tapKey={tapKey} />}
            </View>
          </Animated.View>
        </Animated.View>
      )}
      {phase !== 'docking' && phase !== 'returning' && <TutorialNudgeBubble anchor={nudgeAnchor} />}
      <AssistantSheet visible={open} onClose={() => setOpen(false)} context={context} route={route} product={rideProduct}
        docked={!floating} onToggleDock={phase === 'floating' || phase === 'docked' ? toggleDock : undefined} />
    </>
  );
}
