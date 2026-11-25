import React, { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useIsFocused, useRoute } from '@react-navigation/native';
import type { WindowRect } from './zippyStore';

/**
 * v1.3.0: where floating Zippy must NOT rest. Screens wrap their key controls and values (status pills,
 * Upload / Claim actions, chart bars, totals, OTP boxes, trailing chevrons…) in <ZippyAvoid>. While the
 * screen is focused each wrapper registers a window-space measurer; ZippyBubble measures them after a
 * route / layout / scroll change and picks a rest spot that does not intersect any of them
 * (pickZippyRest). Tiny route-keyed store, no provider.
 *
 * Also here: per-route "hide floating Zippy" (e.g. Face KYC capture), restored when the flag clears.
 */

import { type AvoidRect, ZIPPY_AVOID_GAP } from './zippyRest';
export { ZIPPY_AVOID_GAP };
export type { AvoidRect };

type Entry = { route: string; weight: number; measure: (cb: (r: WindowRect | null) => void) => void };
const entries = new Map<string, Entry>();
const hidden = new Map<string, number>();
let version = 0;
const subs = new Set<() => void>();
const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };
const getVersion = () => version;
const emit = () => { version += 1; subs.forEach((l) => l()); };

/** Layout or scroll position changed on the focused screen: ZippyBubble re-checks its rest spot. */
export function bumpZippyAvoid() { emit(); }

/**
 * Call from a ScrollView's onScroll: one bump once scrolling pauses (trailing debounce), so Zippy
 * re-checks its spot without re-rendering on every scroll frame. Works on web too (no momentum events).
 */
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
export function scrollZippyAvoid() {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => { scrollTimer = null; emit(); }, 140);
}

/** Re-renders whenever an avoid-rect is (un)registered, laid out, scrolled, or a hide flag changes. */
export function useZippyAvoidVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

/** Measure every avoid-rect registered for `route` (window coordinates). Zero-size rects are dropped. */
export function measureZippyAvoid(route: string | undefined, cb: (rects: AvoidRect[]) => void) {
  const list = [...entries.values()].filter((e) => e.route === route);
  if (!list.length) { cb([]); return; }
  const out: AvoidRect[] = [];
  let left = list.length;
  const done = () => { left -= 1; if (left === 0) cb(out); };
  list.forEach((e) => {
    try {
      e.measure((r) => { if (r && r.width > 0 && r.height > 0) out.push({ ...r, weight: e.weight }); done(); });
    } catch { done(); }
  });
}

/**
 * Wrap a control or a key value so floating Zippy never rests on it. Lays out exactly like a View
 * (pass the child's outer layout style via `style`). `weight` 'soft' marks body copy Zippy should
 * prefer to leave clear, but may cover if nothing else fits.
 */
export function ZippyAvoid({ children, style, weight = 'hard', disabled = false }: {
  children?: React.ReactNode; style?: StyleProp<ViewStyle>; weight?: 'hard' | 'soft'; disabled?: boolean;
}) {
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const id = useId();
  const route = useRoute().name;
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused || disabled) return;
    entries.set(id, {
      route, weight: weight === 'hard' ? 10 : 1,
      measure: (cb) => {
        const node = ref.current;
        if (!node) { cb(null); return; }
        node.measureInWindow((x, y, width, height) => cb({ x, y, width, height }));
      },
    });
    emit();
    return () => { entries.delete(id); emit(); };
  }, [focused, disabled, id, route, weight]);
  return <View ref={ref} collapsable={false} style={style} onLayout={() => emit()}>{children}</View>;
}

/** Hide floating Zippy on the calling route while `on` (e.g. during a camera capture). Restored on clear / unmount. */
export function useZippyHidden(on: boolean) {
  const route = useRoute().name;
  useEffect(() => {
    if (!on) return;
    hidden.set(route, (hidden.get(route) ?? 0) + 1);
    emit();
    return () => {
      const n = (hidden.get(route) ?? 1) - 1;
      if (n <= 0) hidden.delete(route); else hidden.set(route, n);
      emit();
    };
  }, [on, route]);
}
export function isZippyHidden(route?: string) { return !!route && (hidden.get(route) ?? 0) > 0; }

// ---- Rest-spot picker: pure, in zippyRest.ts (unit-tested in Node) ----------------------------
export { pickZippyRest, zippyCoverScore } from './zippyRest';
export type { Box, Rest, RestInput } from './zippyRest';
