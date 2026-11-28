import { navRef } from '../navigation/navRef';
import type { RootStackParamList } from '../navigation/types';
import { voiceDraft } from './voiceDraft';
import type { AssistantActionName, CommandResponse, NormalizedField, VoiceSlots } from './types';
import { maskOtp, planTarget, safeTranscript, sheetSlotsFor, slotsForSelect, slotsFromFields, validFields } from './voiceLogic';

/** Routes the proxy may send that take no required params (safe to navigate to by name). */
const NAVIGABLE = new Set<keyof RootStackParamList>([
  'Home', 'Profile', 'ScanQr', 'SearchMobile', 'Offer', 'Asset', 'FaceKyc', 'Mandate', 'Esign', 'Docs',
  'Payouts', 'Portfolio', 'Cases', 'RcPendency', 'TaInf', 'Help',
]);
type NavigableRoute = Exclude<keyof RootStackParamList, 'DealerLogin' | 'DealerOtp' | 'QuickList' | 'Disbursal' | 'ComingSoon'>;

const isNavigable = (r: string): r is NavigableRoute => NAVIGABLE.has(r as keyof RootStackParamList);

export const hasSlots = (s?: VoiceSlots): s is VoiceSlots => !!s && Object.values(s).some((v) => v !== undefined && v !== '');

/** Can this route be opened right now? (Known route, navigator ready, route mounted — i.e. signed in.) */
export function canNavigate(route: string): route is NavigableRoute {
  if (!isNavigable(route) || !navRef.isReady()) return false;
  const names = navRef.getRootState()?.routeNames as string[] | undefined;
  return !names || names.includes(route);
}

export type ApplyOutcome =
  | { kind: 'navigated'; route: NavigableRoute }
  | { kind: 'assistant'; action: AssistantActionName }
  /** Confirm writes spoken numbers into the draft for the current screen (no navigation). */
  | { kind: 'filled'; fields: NormalizedField[] }
  /** Confirm picks a chip on the current screen via the draft (no navigation, no Continue). */
  | { kind: 'selected'; optionKind: string; id: string; label: string; value?: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'none' };

/**
 * Plan what Confirm will do (no side effects). The preview sheet uses this to label the CTA.
 */
export function planCommand(cmd: CommandResponse): ApplyOutcome {
  const t = planTarget(cmd);
  if (t.kind === 'none') return { kind: 'none' };
  if (t.kind === 'assistant') return cmd.action.type === 'assistant' ? { kind: 'assistant', action: cmd.action.action } : { kind: 'none' };
  if (t.kind === 'fill') return { kind: 'filled', fields: t.fields };
  if (t.kind === 'select') return { kind: 'selected', optionKind: t.optionKind, id: t.id, label: t.label, ...(t.value !== undefined ? { value: t.value } : {}) };
  if (!isNavigable(t.route)) return { kind: 'blocked', reason: 'That screen isn’t available from voice yet.' };
  if (!canNavigate(t.route)) return { kind: 'blocked', reason: 'Sign in first, then try that again.' };
  return { kind: 'navigated', route: t.route };
}

/**
 * Run a CONFIRMED command. Writes the voice draft (slots / filter) first so the target screen can
 * read it on mount, then navigates. `navigate` is deferred by `navDelayMs` so the preview
 * can slide away first. Assistant actions are returned for VoiceHost to handle (speak / show).
 */
export function applyCommand(cmd: CommandResponse, opts: { navDelayMs?: number } = {}): ApplyOutcome {
  const plan = planCommand(cmd);
  const target = planTarget(cmd);
  const route = target.kind === 'navigate' ? target.route : undefined;
  const filter = target.kind === 'navigate' ? target.filter : undefined;
  // Spoken numbers (PHONE / AMOUNT / OTP) go into the draft on Confirm; screens fill their inputs from it.
  const filled = slotsFromFields(validFields(cmd));
  const transcript = safeTranscript(cmd);
  // v1.4.5 TA_REPAY / ENHANCE_TA_LIMIT: the TaInf sheet reads the amount / full flag / reason from the draft.
  const sheet = sheetSlotsFor(cmd);
  if (plan.kind === 'navigated' && (hasSlots(cmd.slots) || filter || hasSlots(filled))) {
    voiceDraft.set({ intent: cmd.intent, transcript, route, filter, slots: { ...cmd.slots, ...filled, ...sheet } });
  } else if (plan.kind === 'filled' && hasSlots(filled)) {
    voiceDraft.merge({ transcript, slots: filled });
  } else if (target.kind === 'select') {
    // Never an Amount from a select: "Xtreme 125R" must not become a ₹125 down payment.
    const extra = slotsFromFields(validFields(cmd).filter((f) => f.type !== 'AMOUNT'));
    voiceDraft.merge({ intent: cmd.intent, transcript, slots: { ...extra, ...slotsForSelect(target, cmd.slots) } });
  }
  if (plan.kind === 'navigated') {
    const go = () => { if (canNavigate(plan.route)) navRef.navigate(plan.route); };
    if (opts.navDelayMs) setTimeout(go, opts.navDelayMs); else go();
  }
  return plan;
}

export { speak, stopSpeaking } from './piper';

/** Short examples for "what can I say". */
export const VOICE_EXAMPLES = [
  'Show pending disbursals',
  'Open portfolio',
  'New two-wheeler loan',
  'Start face KYC',
  'Set up UPI mandate',
  'Explain this screen',
];
/** v1.4.9 status checks: read out after the examples on "what can I say" (Hinglish voice phrases). */
export const STATUS_EXAMPLES_LINE = 'Status ke liye poochho: Ramesh ka loan kahan tak pahuncha, aaj kitne approve hue, mera commission kab aayega.';

// SLOT_LABELS / formatSlot moved to voiceLogic.ts (pure, unit-tested); re-exported for existing imports.
export { formatSlot, SLOT_LABELS, slotDetailRows } from './voiceLogic';

/** Human label for where Confirm goes. */
export const ROUTE_LABEL: Partial<Record<NavigableRoute, string>> = {
  Home: 'Home', Profile: 'Profile', ScanQr: 'Scan customer QR', SearchMobile: 'Search by mobile', Offer: 'Offer',
  Asset: 'Vehicle & EMI', FaceKyc: 'Face KYC', Mandate: 'AutoPay mandate', Esign: 'e-sign', Docs: 'Documents',
  Payouts: 'Payouts', Portfolio: 'Portfolio', Cases: 'Cases', RcPendency: 'RC pendency', TaInf: 'TA / INF',
  Help: 'Help & tutorials',
};
