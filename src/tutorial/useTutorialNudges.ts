import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { NavigationState, PartialState } from '@react-navigation/native';
import { detector, tutorials, webForcedNudge } from './tutorialStore';

const TICK_MS = 1000;

type AnyState = NavigationState | PartialState<NavigationState> | undefined;

/** Focused leaf route (name + key) and every route key in the focused stack. */
function focusedInfo(state: AnyState): { name: string; key: string; keys: string[] } | null {
  let s: AnyState = state;
  while (s && s.routes && s.routes.length) {
    const idx = s.index ?? s.routes.length - 1;
    const r = s.routes[idx];
    const child = r.state as AnyState;
    if (child && child.routes && child.routes.length) { s = child; continue; }
    return { name: r.name, key: r.key ?? r.name, keys: s.routes.map((x) => x.key ?? x.name) };
  }
  return null;
}

/**
 * Wires Zippy's "drop a short" detector at the navigator level (v1.3.0): call `onNavState` from the
 * NavigationContainer's onReady / onStateChange. Detects back navigations (the newly focused route was
 * already in the stack), ticks the idle / first-visit clock once a second, pauses while the app is in
 * the background, hides the bubble on every route change, and runs the web `?nudge=1` screenshot hook.
 */
export function useTutorialNudges() {
  const prev = useRef<{ key: string; keys: string[] } | null>(null);
  const forced = useRef(false);

  useEffect(() => {
    void tutorials.hydrate();
    const id = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (tutorials.state.nudge) return;
      tutorials.showNudge(detector.tick(Date.now()));
    }, TICK_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') detector.activity(Date.now()); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);

  const onNavState = (state: AnyState) => {
    const f = focusedInfo(state);
    if (!f) return;
    const p = prev.current;
    prev.current = { key: f.key, keys: f.keys };
    if (p && p.key === f.key) return; // params changed, same screen
    const back = !!p && p.keys.includes(f.key);
    tutorials.dismissNudge();
    tutorials.showNudge(detector.navigate(f.name, Date.now(), back));
    if (!forced.current && webForcedNudge()) {
      forced.current = true;
      // Let the screen and Zippy settle first (screenshots).
      setTimeout(() => tutorials.showNudge(detector.force(Date.now())), 900);
    }
  };
  return onNavState;
}
