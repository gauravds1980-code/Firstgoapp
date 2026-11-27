import { Platform } from 'react-native';
import type { CommandResponse } from './types';
import type { VoicePreview } from './useVoiceCommand';
import { voiceSession } from './voiceSession';
import { voiceTranscript } from './voiceTranscript';

/** Sample command for web screenshots of the staged voice preview. */
const DEMO_COMMAND: CommandResponse = {
  transcript: 'New loan for Ramesh, Activa 125, down payment 15,000.',
  confidence: 0.96,
  languageCode: 'en-IN',
  intent: 'NEW_TWO_WHEELER_LOAN',
  score: 0.91,
  matchedPhrase: 'new two-wheeler loan',
  action: { type: 'navigate', route: 'ScanQr' },
  slots: { customerName: 'Ramesh', vehicle: 'Activa 125', downPayment: 15000, vehicleCategory: 'TWO_WHEELER' },
};

/** v1.4.2 transcript screenshots (frame2 / frame3): a clarify the dealer confirms in the sheet. */
const DEMO_CLARIFY: CommandResponse = {
  transcript: 'Open case for Ramesh Kumar', confidence: 0.7, intent: 'OPEN_CASES', score: 0.71, matchedPhrase: 'open the case for Ramesh Kumar',
  status: 'clarify', action: { type: 'none' },
  candidates: [{ intent: 'OPEN_CASES', phrase: 'open the case for Ramesh Kumar', score: 0.71 }],
};

type DemoWindow = { __voiceDemo?: () => void; __voiceTranscriptDemo?: (withPreview?: boolean) => void; location?: { search?: string } };

/**
 * __DEV__ + web only. Exposes `window.__voiceDemo()` and honours `?voiceDemo=1` to open the staged
 * preview with a sample command so Confirm is visible. It never navigates by itself — Confirm still
 * goes through applyCommand (which re-checks the route). Returns a cleanup. No-op in release builds.
 */
export function installVoiceDemo(stage: (p: VoicePreview) => void): (() => void) | undefined {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  const w = window as unknown as DemoWindow;
  const open = () => stage({ command: DEMO_COMMAND, plan: { kind: 'navigated', route: 'ScanQr' } });
  w.__voiceDemo = open;
  // `window.__voiceTranscriptDemo(withPreview)` / `?voiceTranscript=1|2`: sample turns (in memory, OTP masked by the
  // store) + the live transcript sheet; 2 also stages a "Did you mean" inside it.
  const transcript = (withPreview = false) => {
    voiceTranscript.clear();
    voiceTranscript.live({ text: 'Show my payouts for this month', final: true, source: 'device', turn: -3 });
    voiceTranscript.zippy('action', 'Opened Payouts');
    voiceTranscript.live({ text: 'The OTP is 482913', final: true, source: 'device', turn: -2 });
    voiceTranscript.live({ text: 'Open case for Ramesh Kum', final: !!withPreview, source: 'device', turn: -1 });
    if (withPreview) voiceTranscript.live({ text: 'Open case for Ramesh Kumar', final: true, source: 'device', turn: -1 });
    voiceSession.setTranscriptOpen(true);
    if (withPreview) stage({ command: DEMO_CLARIFY, plan: { kind: 'none' } });
  };
  w.__voiceTranscriptDemo = transcript;
  let t: ReturnType<typeof setTimeout> | undefined;
  const q = w.location?.search ?? '';
  if (/(?:^|[?&])voiceDemo=1(?:&|$)/.test(q)) t = setTimeout(open, 800);
  const tm = q.match(/(?:^|[?&])voiceTranscript=([12])(?:&|$)/);
  if (tm) t = setTimeout(() => transcript(tm[1] === '2'), 800);
  return () => { if (t) clearTimeout(t); if (w.__voiceDemo === open) delete w.__voiceDemo; if (w.__voiceTranscriptDemo === transcript) delete w.__voiceTranscriptDemo; };
}
