/**
 * design-a: route-level Zippy dock default (pure; no React Native imports, so node tests can run it).
 *
 * Data screens (Portfolio, Cases, Payouts, TA / INF) present Zippy DOCKED in the header by default, so it
 * never sits on figures or list rows there. This is a presentation default only: it never writes the
 * global preference (`firstgo.zippy.dock.v129`), so Home and every other screen keep floating unless the
 * dealer docked Zippy themselves.
 *
 *  - global pref 'docked'         → docked everywhere (nothing for the route default to do)
 *  - entering a data screen       → dock (if floating)
 *  - dealer undocks on that screen → stays floating for the rest of THAT visit (session override);
 *                                    entering the screen again re-applies the default
 *  - leaving to a non-data screen → float again, but only if the dock came from the route default
 *  - `?zippy=docked|floating` (web screenshots) → forced, route default off
 */

export const DOCK_DEFAULT_ROUTES: ReadonlySet<string> = new Set(['Portfolio', 'Cases', 'Payouts', 'TaInf']);

export type RouteDockInput = {
  route: string | undefined;
  /** Current dock phase; only the settled 'floating' / 'docked' phases are acted on. */
  phase: string;
  /** The persisted global preference. */
  globalPref: 'docked' | 'floating';
  /** True while the current docked state came from this route default (not from the dealer). */
  routeDocked: boolean;
  /** Route on which the dealer undocked during the current visit (session override), or null. */
  undockedVisit: string | null;
  /** `?zippy=` forced on web. */
  forced: boolean;
};

/** What the overlay should do on focus / phase change: 'dock', 'float', or nothing (null). */
export function routeDockDecision(i: RouteDockInput): 'dock' | 'float' | null {
  if (i.forced || i.globalPref === 'docked') return null;
  if (i.phase !== 'floating' && i.phase !== 'docked') return null;
  const wants = !!i.route && DOCK_DEFAULT_ROUTES.has(i.route) && i.undockedVisit !== i.route;
  if (wants && i.phase === 'floating') return 'dock';
  if (!wants && i.phase === 'docked' && i.routeDocked) return 'float';
  return null;
}
