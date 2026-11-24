import { useSyncExternalStore } from 'react';
import type { IntentCandidate, NormalizedField, VoiceUiPhase } from './types';
import type { VoicePreview } from './useVoiceCommand';

/**
 * The single app-wide voice session, published by VoiceHost (which owns the one recorder via
 * useVoiceCommand). The standalone header mic (HeaderVoiceMic) reads this state and calls these actions,
 * so there is never a second recorder. The session is independent of Zippy: it does not drive Zippy's
 * mood or lips, and it never opens the help sheet by itself.
 */
export type VoiceSessionState = {
  phase: VoiceUiPhase;
  error: string | null;
  preview: VoicePreview | null;
  /** Zippy's help sheet (a Modal) is visible: VoiceHost then lifts its overlay into its own Modal so it stays on top. */
  sheetOpen: boolean;
};

type Actions = {
  pressIn: () => void; pressOut: () => void; confirm: () => void; cancel: () => void; abort: () => void;
  /** "Did you mean…?" pick. */
  choose: (c: IntentCandidate) => void;
  /** "Type it instead" value for field `index` (-1 = new row of `type`). */
  editField: (index: number, type: NormalizedField['type'], text: string) => void;
};

const noop = () => {};
let actions: Actions = { pressIn: noop, pressOut: noop, confirm: noop, cancel: noop, abort: noop, choose: noop, editField: noop };

let snap: VoiceSessionState = { phase: 'idle', error: null, preview: null, sheetOpen: false };
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
  // ---- Mic controls ----
  pressIn: () => actions.pressIn(),
  pressOut: () => actions.pressOut(),
  confirm: () => actions.confirm(),
  cancel: () => actions.cancel(),
  choose: (c: IntentCandidate) => actions.choose(c),
  editField: (index: number, type: NormalizedField['type'], text: string) => actions.editField(index, type, text),

  // ---- VoiceHost only ----
  /** VoiceHost binds the live hook callbacks every render. */
  bind(a: Actions) { actions = a; },
  publish(next: Omit<VoiceSessionState, 'sheetOpen'>) { emit(next); },

  // ---- AssistantSheet only ----
  /**
   * Visibility flag only. The sheet does not receive transcripts or results, and opening / closing it
   * never aborts a recording, a request, a preview or a Piper read-out.
   */
  setSheetOpen(open: boolean) { emit({ sheetOpen: open }); },
};
