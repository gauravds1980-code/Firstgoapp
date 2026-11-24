import { navRef } from '../navigation/navRef';
import type { RootStackParamList } from '../navigation/types';
import { voiceDraft } from './voiceDraft';
import type { AssistantActionName, CommandResponse, VoiceSlots } from './types';

/** Routes the proxy may send that take no required params (safe to navigate to by name). */
const NAVIGABLE = new Set<keyof RootStackParamList>([
  'Home', 'Profile', 'ScanQr', 'SearchMobile', 'Offer', 'Asset', 'FaceKyc', 'Mandate', 'Esign', 'Docs',
  'Payouts', 'Portfolio', 'Cases', 'RcPendency', 'TaInf',
]);
type NavigableRoute = Exclude<keyof RootStackParamList, 'DealerLogin' | 'DealerOtp' | 'QuickList' | 'Disbursal'>;

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
  | { kind: 'blocked'; reason: string }
  | { kind: 'none' };

/**
 * Plan what Confirm will do (no side effects). The preview sheet uses this to label the CTA.
 */
export function planCommand(cmd: CommandResponse): ApplyOutcome {
  const a = cmd.action;
  if (cmd.intent === 'UNKNOWN' || a.type === 'none') return { kind: 'none' };
  if (a.type === 'assistant') return { kind: 'assistant', action: a.action };
  if (!isNavigable(a.route)) return { kind: 'blocked', reason: 'That screen isn’t available from voice yet.' };
  if (!canNavigate(a.route)) return { kind: 'blocked', reason: 'Sign in first, then try that again.' };
  return { kind: 'navigated', route: a.route };
}

/**
 * Run a CONFIRMED command. Writes the voice draft (slots / filter) first so the target screen can
 * read it on mount, then navigates. `navigate` is deferred by `navDelayMs` so the assistant sheet
 * can slide away first. Assistant actions are returned for the sheet to handle (speak / show).
 */
export function applyCommand(cmd: CommandResponse, opts: { navDelayMs?: number } = {}): ApplyOutcome {
  const plan = planCommand(cmd);
  const a = cmd.action;
  const route = a.type === 'navigate' ? a.route : undefined;
  const filter = a.type === 'navigate' ? a.filter : undefined;
  if (plan.kind === 'navigated' && (hasSlots(cmd.slots) || filter)) {
    voiceDraft.set({ intent: cmd.intent, transcript: cmd.transcript, route, filter, slots: cmd.slots ?? {} });
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

export const SLOT_LABELS: Record<keyof VoiceSlots, string> = {
  customerName: 'Customer',
  vehicle: 'Vehicle',
  vehicleCategory: 'Category',
  downPayment: 'Down payment',
  tenureMonths: 'Tenure',
  mobileNumber: 'Mobile',
};

const CATEGORY_LABEL: Record<string, string> = { TWO_WHEELER: 'Two-wheeler', CAR: 'Car', CONSUMER_DURABLE: 'Consumer durable' };

export function formatSlot(key: keyof VoiceSlots, v: VoiceSlots[keyof VoiceSlots]): string {
  if (v === undefined) return '';
  if (key === 'downPayment' && typeof v === 'number') return `₹${v.toLocaleString('en-IN')}`;
  if (key === 'tenureMonths' && typeof v === 'number') return `${v} months`;
  if (key === 'vehicleCategory' && typeof v === 'string') return CATEGORY_LABEL[v] ?? v;
  if (key === 'mobileNumber' && typeof v === 'string' && v.length >= 4) return `•••••${v.slice(-4)}`;
  return String(v);
}

/** Human label for where Confirm goes. */
export const ROUTE_LABEL: Partial<Record<NavigableRoute, string>> = {
  Home: 'Home', Profile: 'Profile', ScanQr: 'Scan customer QR', SearchMobile: 'Search by mobile', Offer: 'Offer',
  Asset: 'Vehicle & EMI', FaceKyc: 'Face KYC', Mandate: 'AutoPay mandate', Esign: 'e-sign', Docs: 'Documents',
  Payouts: 'Payouts', Portfolio: 'Portfolio', Cases: 'Cases', RcPendency: 'RC pendency', TaInf: 'TA / INF',
};
