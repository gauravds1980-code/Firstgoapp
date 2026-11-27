/**
 * v1.4.2: where the voice mic sits (bottom-right thumb zone). Pure TS, no React Native (unit-tested in Node).
 *
 * Placement rule (approved placement research, /workspace/firstgo-mic-placement):
 *  - 56 dp disc, MIC_EDGE (16 dp) from the right edge;
 *  - MIC_GAP (16 dp) above the safe-area bottom (gesture bar / home indicator) AND above the focused screen's
 *    sticky footer (TA/INF's gold button, Disburse, Verify OTP, the auth CTA bar…). Screens already report
 *    that footer through `reportFooterHeight(route, h)` (zippySection); the footer height includes its own
 *    safe-area padding, so the clearance is `max(footer, insetBottom) + MIC_GAP`;
 *  - a screen with its own bottom control row can instead pin the disc's bottom edge (`reportMicAnchor`):
 *    Home lines the disc up with the bottom-centre Scan QR disc;
 *  - a screen can hide it (`hideMic` / useVoiceMicHidden): Scan QR's camera, Face e-KYC's capture view.
 * Route-keyed tiny store, no provider: only the focused route's entries apply (VoiceHost passes it in).
 */

/** Disc diameter (dp). Also the touch target (≥ 48 dp). */
export const MIC_DISC = 56;
/** Distance from the right edge (dp). */
export const MIC_EDGE = 16;
/** Clearance above the safe-area bottom and above a sticky footer (dp). */
export const MIC_GAP = 16;
/** Gap between the live pill / transcript sheet and the top of the disc (dp). */
export const MIC_PILL_GAP = 10;

/** Routes that never show the mic: full-screen camera (Scan QR), the shorts player, the offer reveal beat. */
export const MIC_HIDDEN_ROUTES: ReadonlySet<string> = new Set(['ScanQr', 'ShortsFeed', 'OfferReveal']);

export type MicPlacementInput = {
  route?: string;
  /** Safe-area bottom inset (gesture bar / home indicator). */
  insetBottom: number;
  /** Focused screen's reported sticky footer height (0 = none). Includes the footer's own safe-area padding. */
  footer: number;
  /** Bottom edge pinned by the screen (Home), from the window bottom. Wins over the footer rule. */
  anchorBottom?: number | null;
  /** The screen asked to hide it (camera view). */
  hidden?: boolean;
  /** Keyboard lift under the footer (the footer rides on the keyboard). */
  keyboardLift?: number;
};

export type MicPlacement = { right: number; bottom: number; size: number };

/** Where the disc goes on this screen, or null when it is hidden. */
export function micPlacement(i: MicPlacementInput): MicPlacement | null {
  if (!i.route || MIC_HIDDEN_ROUTES.has(i.route) || i.hidden) return null;
  const lift = Math.max(0, i.keyboardLift ?? 0);
  const base = i.anchorBottom != null && i.anchorBottom >= 0
    ? i.anchorBottom
    : Math.max(Math.max(0, i.footer), Math.max(0, i.insetBottom)) + MIC_GAP;
  return { right: MIC_EDGE, bottom: Math.round(base + lift), size: MIC_DISC };
}

/** Bottom offset for something that sits just above the disc (live pill, transcript sheet's content). */
export const aboveMic = (p: MicPlacement, gap = MIC_PILL_GAP): number => p.bottom + p.size + gap;

/**
 * Home: bottom edge of the 56 dp disc so its centre lines up with a centred `discSize` disc whose bottom
 * edge is `discBottom` from the window bottom (Scan QR: 72 dp at fabBottom).
 */
export const alignedMicBottom = (discBottom: number, discSize: number): number => Math.round(discBottom + (discSize - MIC_DISC) / 2);

/**
 * True when a centred disc of `centreDisc` and the bottom-right mic leave at least `minGap` between them on
 * a window `width` wide (Home's Scan QR and the mic must never overlap).
 */
export function clearOfCentreDisc(width: number, centreDisc: number, minGap = MIC_GAP): boolean {
  const centreRight = width / 2 + centreDisc / 2;
  const micLeft = width - MIC_EDGE - MIC_DISC;
  return micLeft - centreRight >= minGap;
}

// ---- route-keyed store: hide flags and anchors -------------------------------------------------
const hiddenBy = new Map<string, number>();
const anchors = new Map<string, number>();
let version = 0;
const subs = new Set<() => void>();
const emit = () => { version += 1; subs.forEach((l) => l()); };

export const micDock = {
  subscribe(l: () => void) { subs.add(l); return () => { subs.delete(l); }; },
  version: () => version,
  /** Hide the mic on `route`; returns the release function (counted, so nested hides are safe). */
  hide(route: string): () => void {
    hiddenBy.set(route, (hiddenBy.get(route) ?? 0) + 1);
    emit();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const n = (hiddenBy.get(route) ?? 1) - 1;
      if (n <= 0) hiddenBy.delete(route); else hiddenBy.set(route, n);
      emit();
    };
  },
  isHidden: (route?: string): boolean => !!route && (hiddenBy.get(route) ?? 0) > 0,
  /** Pin the disc's bottom edge on `route` (null clears). */
  setAnchor(route: string, bottom: number | null) {
    const cur = anchors.get(route);
    if (bottom == null) { if (cur === undefined) return; anchors.delete(route); emit(); return; }
    const b = Math.round(bottom);
    if (cur === b) return;
    anchors.set(route, b);
    emit();
  },
  anchor: (route?: string): number | null => (route ? anchors.get(route) ?? null : null),
  /** Tests only. */
  reset() { hiddenBy.clear(); anchors.clear(); emit(); },
};
