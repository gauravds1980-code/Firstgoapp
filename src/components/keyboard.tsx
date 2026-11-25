import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, Platform, ScrollView, View, type KeyboardEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fallbackKeyboardHeight, keyboardLift, revealDelta, webKeyboardHeight } from './keyboardMath';

/**
 * v1.3.1 — one keyboard-avoid pattern for every form.
 *
 * Why not KeyboardAvoidingView: the app is edge-to-edge on Android (edgeToEdgeEnabled), and so is every
 * RN Modal there, so `adjustResize` never shrinks the window and KAV with no behaviour did nothing —
 * the keyboard covered the Sheet's field and its Submit button (the RC update bug).
 *
 * Instead:
 *  - useKeyboardHeight(): one shared listener — iOS keyboardWillShow/Hide/ChangeFrame, Android
 *    keyboardDidShow/Hide, web visualViewport — so every subscriber sees the same height.
 *  - useKeyboardLift(): the bottom padding a bottom-anchored container (JourneyScreen, AuthScaffold,
 *    Sheet, voice preview) adds so its footer CTA sits on top of the keyboard.
 *  - useKeyboardForm() + KeyboardRevealProvider: Field / OtpInput report focus, and the wrapper's
 *    ScrollView scrolls the focused input into view once the lift has been applied.
 */

// ---- shared keyboard height store ----
let kbHeight = 0;
/** Count of keyboard show/hide events (native), so the Android Modal fallback knows if any arrived. */
let kbEvents = 0;
const subs = new Set<() => void>();
let teardown: (() => void) | null = null;

function setHeight(h: number) {
  if (h === kbHeight) return;
  kbHeight = h;
  subs.forEach((s) => s());
}

function start() {
  if (Platform.OS === 'web') {
    const w = typeof window !== 'undefined' ? window : undefined;
    const vv = w?.visualViewport;
    if (!w || !vv) return () => {};
    const on = () => setHeight(webKeyboardHeight(w.innerHeight, vv.height, vv.offsetTop));
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    on();
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); };
  }
  const show = (e: KeyboardEvent) => { kbEvents += 1; setHeight(Math.max(0, e.endCoordinates?.height ?? 0)); };
  const hide = () => { kbEvents += 1; setHeight(0); };
  const ls = Platform.OS === 'ios'
    ? [Keyboard.addListener('keyboardWillShow', show), Keyboard.addListener('keyboardWillChangeFrame', show), Keyboard.addListener('keyboardWillHide', hide)]
    : [Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardDidHide', hide)];
  return () => ls.forEach((l) => l.remove());
}

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!teardown) teardown = start();
  return () => {
    subs.delete(cb);
    if (!subs.size && teardown) { teardown(); teardown = null; }
  };
}

/** Raw on-screen keyboard height in dp (0 when hidden). */
export function useKeyboardHeight(): number {
  return useSyncExternalStore(subscribe, () => kbHeight, () => 0);
}

/**
 * Bottom padding for a bottom-anchored container so its content clears the keyboard.
 * `assumeWhenFocused` (Android Sheets): if a field is focused but no keyboard event has reached JS
 * within 700 ms (a Modal edge case), assume a typical keyboard height rather than leave it covered.
 */
export function useKeyboardLift(opts?: { focused?: boolean; windowHeight?: number }): number {
  const h = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const [assumed, setAssumed] = useState(0);
  const focused = !!opts?.focused;
  const wh = opts?.windowHeight ?? 0;
  useEffect(() => {
    setAssumed(0);
    if (Platform.OS !== 'android' || !focused || !wh) return;
    const before = kbEvents;
    // Only when NO keyboard event reached JS since focus (not after a real hide, e.g. the back button).
    const t = setTimeout(() => { if (kbEvents === before && kbHeight === 0) setAssumed(fallbackKeyboardHeight(wh)); }, 700);
    return () => clearTimeout(t);
  }, [focused, wh]);
  // A real event always wins over the estimate.
  useEffect(() => { if (h > 0) setAssumed(0); }, [h]);
  return keyboardLift(Platform.OS, h > 0 ? h : assumed, insets.bottom);
}

// ---- scroll the focused input into view ----
type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
type RevealApi = { onFocus: (node: Measurable | null) => void; onBlur: (node: Measurable | null) => void };
const RevealContext = createContext<RevealApi | null>(null);

/** Field / OtpInput: report focus so the enclosing form can scroll it into view. */
export function useRevealOnFocus() {
  const api = useContext(RevealContext);
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  /** The node reported on focus; cleared on blur. An input unmounted while focused (its Sheet closed) still reports a blur. */
  const focusedNode = useRef<Measurable | null>(null);
  const onFocus = useCallback(() => { focusedNode.current = ref.current as unknown as Measurable; api?.onFocus(focusedNode.current); }, [api]);
  const onBlur = useCallback(() => { api?.onBlur(focusedNode.current); focusedNode.current = null; }, [api]);
  useEffect(() => () => { if (focusedNode.current) api?.onBlur(focusedNode.current); }, [api]);
  return { ref, onFocus, onBlur };
}

export const KeyboardRevealProvider = RevealContext.Provider;

/**
 * Everything a form wrapper needs: `lift` (bottom padding), the ScrollView ref + onScroll, and the
 * reveal API to pass to <KeyboardRevealProvider>. The focused input is scrolled into view on focus and
 * again whenever the lift changes. `assumeHeight` (window height) turns on the Android Modal safety net;
 * `revealBelow` keeps room under the field for an inline action when there is no sticky footer.
 */
export function useKeyboardForm(opts?: { assumeHeight?: number; revealBelow?: number }) {
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const focusedNode = useRef<Measurable | null>(null);
  const [focused, setFocused] = useState(false);
  const lift = useKeyboardLift({ focused, windowHeight: opts?.assumeHeight });
  const belowRef = useRef(16);
  belowRef.current = opts?.revealBelow ?? 16;

  const reveal = useCallback(() => {
    const f = focusedNode.current;
    const s = scrollRef.current as unknown as (Measurable & { scrollTo?: (o: { y: number; animated?: boolean }) => void }) | null;
    if (!f?.measureInWindow || !s?.measureInWindow || !s.scrollTo) return;
    f.measureInWindow((_fx, fy, _fw, fh) => {
      s.measureInWindow!((_sx, sy, _sw, sh) => {
        if (!(sh > 0) || !(fh > 0)) return;
        const d = revealDelta({ y: fy, h: fh }, { y: sy, h: sh }, 16, belowRef.current);
        if (Math.abs(d) >= 1) s.scrollTo!({ y: Math.max(0, offset.current + d), animated: true });
      });
    });
  }, []);

  // After the lift is laid out (and again a beat later, after the keyboard animation), bring the field up.
  useEffect(() => {
    if (!focused) return;
    const a = setTimeout(reveal, 60);
    const b = setTimeout(reveal, 320);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [lift, focused, reveal]);

  const api = useMemo<RevealApi>(() => ({
    onFocus: (n) => { focusedNode.current = n; setFocused(true); setTimeout(reveal, 60); },
    onBlur: (n) => { if (focusedNode.current === n) { focusedNode.current = null; setFocused(false); } },
  }), [reveal]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; }, []);
  /** Forget any focused input (e.g. the Sheet was hidden). */
  const reset = useCallback(() => { focusedNode.current = null; offset.current = 0; setFocused(false); }, []);
  return { lift, scrollRef, onScroll, api, reset };
}
