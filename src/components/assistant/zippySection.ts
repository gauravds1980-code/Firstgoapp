import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useRoute } from '@react-navigation/native';

/**
 * Section-aware help for Zippy (v1.2.2). Tiny route-keyed store, no provider:
 *  - section: which part of the focused screen is in view (reported via onLayout + onScroll)
 *  - pending: what on this screen still needs the dealer (missing doc, invalid field, awaiting consent)
 *  - footer:  height of the screen's sticky CTA bar, so the floating orb never covers it
 * AssistantSheet reads section + pending to pick FAQs and nudges; ZippyBubble reads footer.
 */

export interface ZippyPending {
  id: string;
  label: string;
  detail?: string;
  /** Verb-led label for the sheet's quick action, e.g. "Upload invoice". */
  actionLabel?: string;
  onAction?: () => void;
}

interface RouteHelp { section: string | null; pending: ZippyPending[]; footer: number }
const EMPTY: RouteHelp = { section: null, pending: [], footer: 0 };

let state: Record<string, RouteHelp> = {};
const subs = new Set<() => void>();
const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };
const getState = () => state;
function patch(route: string, p: Partial<RouteHelp>) {
  const cur = state[route] ?? EMPTY;
  if ((Object.keys(p) as (keyof RouteHelp)[]).every((k) => cur[k] === p[k])) return;
  state = { ...state, [route]: { ...cur, ...p } };
  subs.forEach((l) => l());
}

/** Latest pending items per route (fresh closures for quick actions without re-emitting). */
const latestPending = new Map<string, { current: ZippyPending[] }>();

/** Section, pending items and footer height for a route; re-renders on change. */
export function useRouteHelp(route?: string): RouteHelp {
  const all = useSyncExternalStore(subscribe, getState, getState);
  return (route && all[route]) || EMPTY;
}

/** Run a pending item's quick action with the screen's latest closure. */
export function runPendingAction(route: string, id: string) {
  latestPending.get(route)?.current.find((p) => p.id === id)?.onAction?.();
}

/**
 * Track which section of a scrolling screen is in view.
 *   const sec = useSectionTracker('vehicle');
 *   <JourneyScreen onScroll={sec.onScroll}> <View onLayout={sec.at('vehicle')}> …
 * `at(id, group)` measures a section nested inside a group container registered with `group(id)`.
 * `set(id)` is for stage-based screens that swap content instead of scrolling.
 */
export function useSectionTracker<T extends string>(initial: T) {
  const route = useRoute().name;
  const tops = useRef(new Map<string, { y: number; group?: string }>());
  const groups = useRef(new Map<string, number>());
  const current = useRef<string | null>(null);
  const set = useCallback((id: T) => {
    if (current.current === id) return;
    current.current = id;
    patch(route, { section: id });
  }, [route]);

  useEffect(() => {
    current.current = null;
    set(initial);
    return () => { patch(route, { section: null }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const at = useCallback((id: T, group?: string) => (e: LayoutChangeEvent) => {
    tops.current.set(id, { y: e.nativeEvent.layout.y, group });
  }, []);
  const group = useCallback((id: string) => (e: LayoutChangeEvent) => { groups.current.set(id, e.nativeEvent.layout.y); }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const entries = [...tops.current.entries()]
      .map(([id, t]) => ({ id, top: t.y + (t.group ? groups.current.get(t.group) ?? 0 : 0) }))
      .sort((a, b) => a.top - b.top);
    if (!entries.length) return;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
    // The section whose top has passed ~30% down the viewport is the one being read.
    const probe = contentOffset.y + layoutMeasurement.height * 0.3;
    const hit = atBottom ? entries[entries.length - 1]! : [...entries].reverse().find((x) => x.top <= probe) ?? entries[0]!;
    set(hit.id as T);
  }, [set]);

  return useMemo(() => ({ at, group, onScroll, set }), [at, group, onScroll, set]);
}

/**
 * Report what on this screen still needs the dealer. Re-emits only when ids/labels change;
 * quick actions always run the latest closure. Cleared on unmount.
 */
export function useZippyPending(items: ZippyPending[]) {
  const route = useRoute().name;
  const ref = useRef(items);
  ref.current = items;
  latestPending.set(route, ref);
  const key = items.map((i) => `${i.id}|${i.label}|${i.detail ?? ''}|${i.actionLabel ?? ''}`).join('§');
  useEffect(() => { patch(route, { pending: ref.current }); }, [route, key]);
  useEffect(() => () => { patch(route, { pending: [] }); latestPending.delete(route); }, [route]);
}

/** Sticky footer height for the focused route (JourneyScreen reports it). */
export function reportFooterHeight(route: string, height: number) {
  patch(route, { footer: Math.round(height) });
}
