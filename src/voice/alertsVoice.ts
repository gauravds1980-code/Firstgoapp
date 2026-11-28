/**
 * v1.4.7 Credit and payout alerts by voice. Pure (no React Native): unit-tested in Node (voice/__tests__/alertsVoice.test.ts).
 *
 * Decided on the phone (useVoiceCommand.handleText / onDeviceFinal / deliver), at once and offline, so the phrases work
 * with the 8793 server's older command list too. The server catalogue has the same intents (firstgo-voice-local
 * commands.md), and a server / Whisper answer naming one lands in the same place.
 *
 *   "alerts dikhao" / "naya alert kya hai" / "kya naya hai" / "show my alerts" / "notifications dikhao" → SHOW_ALERTS (inbox)
 *   "read my alerts" / "alerts padh ke sunao" / "aaj ke alerts sunao"                                 → READ_ALERTS (inbox + Piper readout)
 *   "notification settings kholo" / "alerts band karo" / "quiet hours"                                → OPEN_ALERT_SETTINGS
 * "alerts band karo" opens settings (focus on Push / Quiet hours); nothing is silently switched off.
 * Money-in-flight phrases ("mera paisa kahan hai", "aaj kitna credit hua") are NOT read here.
 */
import { parseResponse } from './sttClient';
import type { CommandResponse } from './types';
import { mifNorm } from './moneyVoice';
import { alertsSummaryLine, EMPTY_INBOX, readoutLine, unreadOf, type AlertEvent, type InboxState } from '../services/alerts';

export const ALERT_INTENTS = ['SHOW_ALERTS', 'READ_ALERTS', 'OPEN_ALERT_SETTINGS'] as const;
export type AlertIntent = (typeof ALERT_INTENTS)[number];
export const isAlertIntent = (i: string | undefined): i is AlertIntent => !!i && (ALERT_INTENTS as readonly string[]).includes(i);
export type AlertsQuery = { kind: 'show' | 'read' | 'settings'; intent: AlertIntent };

const ALERT = '(?:alerts?|alrts?|alart|alarts?|allerts?|notifications?|notification|notifs?|updates?)';
const SETTINGS_RES: RegExp[] = [
  /\bnotification settings?\b/,
  new RegExp(`\\b${ALERT} (?:settings?|preferences?)\\b`),
  new RegExp(`\\b${ALERT} (?:band|bandh|off|mute|silent) (?:karo|kar do|kardo|kijiye|please)?`),
  new RegExp(`\\b(?:turn off|stop|mute|silence) (?:my |the |all )?${ALERT}\\b`),
  /\bquiet hours?\b/,
];
const READ_RES: RegExp[] = [
  new RegExp(`\\bread (?:out )?(?:my |the |all |today s |todays |new )?${ALERT}\\b`),
  new RegExp(`\\b${ALERT} (?:padh|padh ke|padhke|padho|padhiye|parh|parh ke) ?(?:ke )?(?:sunao|suna do|sunaiye|batao|do)?\\b`),
  new RegExp(`\\b${ALERT} (?:sunao|suna do|sunaiye|bolo|read karo|read out)\\b`),
  new RegExp(`\\b(?:aaj ke|naye|nae|new) ${ALERT} (?:sunao|padho|padh ke sunao|read karo)\\b`),
];
const SHOW_RES: RegExp[] = [
  new RegExp(`\\b${ALERT} (?:dikhao|dikha do|dikhaiye|kholo|khol do|kholiye|batao|check karo|dekho)\\b`),
  new RegExp(`\\b(?:show|open|see|check|view)(?: me)? (?:my |the |all |new |latest )?${ALERT}\\b`),
  new RegExp(`\\b(?:naya|naye|nayi|nae|new|koi) ${ALERT} (?:kya|hai|aaya|aya|aaye)\\b`),
  new RegExp(`\\b(?:any|koi) (?:new )?${ALERT}\\b`),
  /\bkya naya hai\b/, /\bnaya kya hai\b/, /\bwhat s new\b/, /\bwhats new\b/,
  new RegExp(`^(?:my )?${ALERT}$`),
  /\balerts? inbox\b/, /\binbox (?:dikhao|kholo|open)\b/, /\bopen inbox\b/,
];

/** Read an alerts phrase; null when it is not one. Settings first ("alerts band karo"), then read, then show. */
export function parseAlertsQuery(text: string): AlertsQuery | null {
  const n = mifNorm(text);
  if (!n || n.split(' ').length > 10) return null;
  // Money in flight and Payouts phrases stay theirs.
  if (/\b(?:paisa|paise|money in flight|commission|payouts?|invoice)\b/.test(n)) return null;
  if (SETTINGS_RES.some((re) => re.test(n))) return { kind: 'settings', intent: 'OPEN_ALERT_SETTINGS' };
  if (READ_RES.some((re) => re.test(n))) return { kind: 'read', intent: 'READ_ALERTS' };
  if (SHOW_RES.some((re) => re.test(n))) return { kind: 'show', intent: 'SHOW_ALERTS' };
  return null;
}

const KIND: Record<AlertIntent, AlertsQuery['kind']> = { SHOW_ALERTS: 'show', READ_ALERTS: 'read', OPEN_ALERT_SETTINGS: 'settings' };
/** A command (server / Whisper / phone) as an alerts request: its intent, else the transcript. */
export function alertsQueryFor(cmd: { intent: string; transcript?: string }): AlertsQuery | null {
  if (isAlertIntent(cmd.intent)) return { kind: KIND[cmd.intent], intent: cmd.intent };
  return parseAlertsQuery(cmd.transcript ?? '');
}

export const ALERTS_ROUTE = 'Alerts';
export const ALERT_SETTINGS_ROUTE = 'AlertSettings';
export type AlertsAnswer = { route: 'Alerts' | 'AlertSettings'; params: Record<string, unknown>; say: string; toast: string; readAloud: boolean };

/** What the request does: which screen, what Piper says. READ_ALERTS always reads aloud (the dealer asked). */
export function answerAlertsQuery(q: AlertsQuery, ctx: { events: readonly AlertEvent[]; inbox: InboxState }): AlertsAnswer {
  switch (q.kind) {
    case 'settings':
      return { route: 'AlertSettings', params: { focus: 'push' }, say: 'Notification settings.', toast: 'Opening Notification settings', readAloud: false };
    case 'read':
      return { route: 'Alerts', params: {}, say: readoutLine(ctx.events, ctx.inbox), toast: 'Alerts · reading aloud', readAloud: true };
    case 'show': {
      const n = unreadOf(ctx.events, ctx.inbox).length;
      return { route: 'Alerts', params: {}, say: alertsSummaryLine(ctx.events, ctx.inbox), toast: n ? `Alerts · ${n} unread` : 'Opening Alerts', readAloud: false };
    }
  }
}

/** The phone's own reading as a command (same shape the server sends), so `deliver` handles both alike. */
export function alertsLocalCommand(text: string, q: AlertsQuery): CommandResponse {
  return parseResponse({
    transcript: text, confidence: 1, intent: q.intent, score: 1, matchedPhrase: null, status: 'ok', engine: 'device', method: 'keyword',
    action: { type: 'navigate', route: q.kind === 'settings' ? ALERT_SETTINGS_ROUTE : ALERTS_ROUTE }, confidenceBand: 'auto', autoExecute: true, autoReason: 'alerts_local',
  });
}

/* ---------------- Live context (set by RootNavigator; read at answer time) ---------------- */
export interface AlertsVoiceContext { signedIn: boolean; events: readonly AlertEvent[]; inbox: InboxState }
let source: () => AlertsVoiceContext = () => ({ signedIn: false, events: [], inbox: EMPTY_INBOX });
export function setAlertsVoiceSource(fn: () => AlertsVoiceContext): void { source = fn; }
export const getAlertsVoiceContext = (): AlertsVoiceContext => source();
