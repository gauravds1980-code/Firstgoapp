import { Platform } from 'react-native';
import type { CommandResponse } from './types';
import type { VoicePreview } from './useVoiceCommand';

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

type DemoWindow = { __voiceDemo?: () => void; location?: { search?: string } };

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
  let t: ReturnType<typeof setTimeout> | undefined;
  if (/(?:^|[?&])voiceDemo=1(?:&|$)/.test(w.location?.search ?? '')) t = setTimeout(open, 800);
  return () => { if (t) clearTimeout(t); if (w.__voiceDemo === open) delete w.__voiceDemo; };
}
