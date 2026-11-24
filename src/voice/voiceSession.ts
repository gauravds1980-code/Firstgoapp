import { useSyncExternalStore } from 'react';
import type { ZippyMood } from '../components/assistant/zippyStore';
import type { AssistantActionName } from './types';
import type { VoicePreview } from './useVoiceCommand';
import type { VoiceUiPhase } from './VoiceMicButton';

/**
 * The single app-wide voice session, published by VoiceHost (which owns the one recorder via
 * useVoiceCommand). Every mic — the docked header badge, the floating Zippy badge and the sheet's large
 * VoiceMicButton — reads this state and calls these actions, so there is never a second recorder.
 */
export type VoiceSessionState = {
  phase: VoiceUiPhase;
  error: string | null;
  preview: VoicePreview | null;
  /** Zippy mood while voice is active (listening/thinking → 'thinking', preview → 'happy', confirmed → 'cheer'); null = route default. */
  mood: ZippyMood | null;
  speaking: boolean;
  /** The assistant sheet is open and attached: it shows errors / the preview itself and receives transcripts. */
  sheetOpen: boolean;
};

/** Sheet-side hooks, used only while the sheet is open (thread bubbles, contextual read-outs, close-on-navigate). */
export type SheetVoiceHandlers = {
  onTranscript: (text: string) => void;
  readOut: (action: AssistantActionName) => string | null;
  onNavigate: () => void;
};

type Actions = { pressIn: () => void; pressOut: () => void; confirm: () => void; cancel: () => void; abort: () => void };

const noop = () => {};
let actions: Actions = { pressIn: noop, pressOut: noop, confirm: noop, cancel: noop, abort: noop };
let sheet: { current: SheetVoiceHandlers } | null = null;

let snap: VoiceSessionState = { phase: 'idle', error: null, preview: null, mood: null, speaking: false, sheetOpen: false };
const listeners = new Set<() => void>();
const emit = (next: Partial<VoiceSessionState>) => {
  let changed = false;
  for (const k of Object.keys(next) as (keyof VoiceSessionState)[]) if (snap[k] !== next[k]) { changed = true; break; }
  if (!changed) return;
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snap;

export function useVoiceSession(): VoiceSessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const voiceSession = {
  get state() { return snap; },
  // ---- Mic controls (any mic) ----
  pressIn: () => actions.pressIn(),
  pressOut: () => actions.pressOut(),
  confirm: () => actions.confirm(),
  cancel: () => actions.cancel(),

  // ---- VoiceHost only ----
  /** VoiceHost binds the live hook callbacks every render. */
  bind(a: Actions) { actions = a; },
  publish(next: Omit<VoiceSessionState, 'sheetOpen'>) { emit(next); },
  /** Current sheet handlers, or null when the sheet is closed. */
  sheet(): SheetVoiceHandlers | null { return sheet?.current ?? null; },

  // ---- AssistantSheet only ----
  /**
   * Attach while the sheet is visible (pass a ref so read-outs see the latest thread). Detaching (sheet
   * closed) aborts any recording / request / preview in flight and stops speech.
   */
  attachSheet(handlers: { current: SheetVoiceHandlers }) {
    sheet = handlers;
    emit({ sheetOpen: true });
    return () => {
      if (sheet !== handlers) return;
      sheet = null;
      actions.abort();
      emit({ sheetOpen: false });
    };
  },
};
