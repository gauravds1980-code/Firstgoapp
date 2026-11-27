/**
 * Non-verbal voice cues (v1.4.2, pure — no expo-audio / react-native so node tests can import it).
 *
 * With feature flag `voice.spokenReplies` OFF (the default) Zippy does not speak; each turn ends in one short
 * sound instead (assets/voice-cues, played by playVoiceCue.ts):
 *   accepted      — rising two-note chime: the command was understood and ran (or undo / cancel applied).
 *   notUnderstood — low falling double-blip: nothing usable was heard, say it again.
 *   confirm       — soft neutral mid pulse: Zippy has a guess and waits for a tap (Did you mean / Confirm).
 * On-screen text (toasts, preview, "Did you mean", banners) is unchanged. Cues never carry OTP digits.
 */
import type { CommandStatus } from './types';

export type VoiceCueKind = 'accepted' | 'notUnderstood' | 'confirm';

/** Default for `voice.spokenReplies`: off — short sounds, no spoken Piper replies. */
export const DEFAULT_SPOKEN_REPLIES = false;

export type CueInput = {
  /** This turn already applied the command (auto-act or confirmed action). */
  didAct?: boolean;
  status?: CommandStatus;
  /** The response carries "Did you mean" candidates. */
  hasCandidates?: boolean;
  kind?: 'undone' | 'cancelled' | 'assistant' | 'preview' | 'acted' | 'nothing';
};

/** Which cue ends this turn. */
export function cueKindFor(input: CueInput): VoiceCueKind {
  const { didAct, status, hasCandidates, kind } = input;
  if (didAct || kind === 'acted' || kind === 'undone' || kind === 'cancelled' || kind === 'assistant') return 'accepted';
  if (hasCandidates) return 'confirm';
  if (kind === 'nothing' || status === 'retry' || status === 'reprompt') return 'notUnderstood';
  // clarify, a confirm-band preview, the ask-before-acting Confirm sheet, a re-staged Did you mean.
  return 'confirm';
}

/** Spoken Piper replies play only when the dealer turned `voice.spokenReplies` on. */
export const shouldSpeakReplies = (spokenReplies: boolean): boolean => spokenReplies === true;

/** How a turn's reply is delivered. 'cue' never calls /tts, never plays a Piper clip. */
export const replyMode = (spokenReplies: boolean): 'speech' | 'cue' => (shouldSpeakReplies(spokenReplies) ? 'speech' : 'cue');
