import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZippyMood } from '../components/assistant/zippyStore';
import { haptic } from '../utils/haptics';
import { applyCommand, planCommand, speak, stopSpeaking, type ApplyOutcome } from './applyCommand';
import { isSpeaking } from './piper';
import { getSttProvider } from './sttClient';
import { voiceErrorMessage, type AssistantActionName, type CommandResponse, type IntentCandidate, type NormalizedField, type VoiceExpect } from './types';
import { usePushToTalk } from './usePushToTalk';
import { currentCommandContext } from './voiceContext';
import { isOtpCommand, safeTranscript, withCandidate, withTypedValue } from './voiceLogic';
import type { VoiceUiPhase } from './VoiceMicButton';

/** `expect` is what the screen asked for when the clip was sent (used for "Type it instead" with no row). */
export type VoicePreview = { command: CommandResponse; plan: ApplyOutcome; expect?: VoiceExpect };

export const WAIT_FOR_ZIPPY = 'Wait until Zippy finishes speaking.';

/**
 * The app's ONE voice session: hold mic → record → POST /command → staged preview → Confirm / Cancel.
 * Nothing navigates or fills until `confirm()`. Owned by VoiceHost (mounted once in RootNavigator) and
 * shared with the header badge, the floating badge and the sheet mic through `voiceSession`.
 *
 * While Zippy is speaking (the preview read-back or a help answer) a hold is ignored: the read-out is
 * never cut off to start recording, and the server would refuse the clip anyway (HTTP 409).
 */
export function useVoiceCommand({ onTranscript, onNavigate, readOut }: {
  /** Append the heard transcript as a user bubble (no-op when the sheet is closed). OTP-safe text only. */
  onTranscript: (text: string) => void;
  /** Called right before a confirmed navigation / fill (closes the sheet if it is open). */
  onNavigate: () => void;
  /** Text for an assistant read-out intent; spoken (and shown in the sheet / a banner). */
  readOut: (action: AssistantActionName) => string | null;
}) {
  const ptt = usePushToTalk();
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<VoicePreview | null>(null);
  const [cheer, setCheer] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const req = useRef(0);

  const say = useCallback((text: string, precomputed?: { audioBase64?: string; audioDurationSec?: number }) => {
    setSpeaking(true);
    void speak(text, { onStart: () => setSpeaking(true), onDone: () => setSpeaking(false) }, precomputed);
  }, []);

  /** Cancel any recording / request in flight, drop the preview and stop speech (the sheet closed). Keeps a cheer. */
  const abort = useCallback(() => {
    req.current += 1;
    ptt.cancel();
    stopSpeaking();
    setThinking(false); setError(null); setPreview(null); setSpeaking(false);
  }, [ptt.cancel]);

  useEffect(() => () => { req.current += 1; stopSpeaking(); }, []);
  useEffect(() => { if (!cheer) return; const t = setTimeout(() => setCheer(false), 1500); return () => clearTimeout(t); }, [cheer]);

  const pressIn = useCallback(() => {
    // Do not cut Zippy off: the dealer waits for the read-out to finish, then holds.
    if (isSpeaking()) { setError(WAIT_FOR_ZIPPY); haptic.error(); return; }
    setError(null);
    setPreview(null);
    ptt.pressIn();
  }, [ptt.pressIn]);

  const pressOut = useCallback(async () => {
    const id = ++req.current;
    try {
      const r = await ptt.pressOut();
      if (!r || id !== req.current) return;
      if (r.kind === 'too_short') { setError('Hold the mic while you speak, then let go.'); return; }
      if (r.kind === 'permission_prompted') { setError('Microphone is on. Hold the mic to talk to Zippy.'); return; }
      setThinking(true);
      const ctx = currentCommandContext();
      const command = await getSttProvider().command(r.base64, r.mimeType, ctx);
      if (id !== req.current) return;
      onTranscript(safeTranscript(command));
      setPreview({ command, plan: planCommand(command), ...(ctx.expect ? { expect: ctx.expect } : {}) });
      // Zippy reads the result back with the Piper WAV the server already made (no second /tts call).
      // For OTP the server's text is already safe ("OTP captured, six digits"); never speak digits here.
      const text = (isOtpCommand(command) ? command.readBack ?? command.responseText : command.responseText ?? command.readBack) ?? '';
      if (command.audioBase64) say(text, { audioBase64: command.audioBase64, audioDurationSec: command.audioDurationSec });
      else if (command.readBack) say(command.readBack);
    } catch (e) {
      if (id !== req.current) return;
      haptic.error();
      setError(voiceErrorMessage(e));
    } finally {
      if (id === req.current) setThinking(false);
    }
  }, [ptt.pressOut, onTranscript, say]);

  // Auto-stop at the max hold length behaves like letting go.
  ptt.onAutoStop.current = () => { void pressOut(); };

  const confirm = useCallback(() => {
    const p = preview;
    if (!p) return;
    setPreview(null);
    const out = applyCommand(p.command, { navDelayMs: 250 });
    if (out.kind === 'navigated' || out.kind === 'filled') {
      haptic.success();
      setCheer(true);
      onNavigate();
    } else if (out.kind === 'assistant') {
      setCheer(true);
      const text = readOut(out.action);
      if (text) say(text);
    }
  }, [preview, onNavigate, readOut, say]);

  const cancel = useCallback(() => { setPreview(null); }, []);

  /** "Did you mean…?": stage the picked candidate. Confirm is still required. */
  const choose = useCallback((c: IntentCandidate) => {
    setPreview((p) => {
      if (!p) return p;
      const command = withCandidate(p.command, c);
      return { ...p, command, plan: planCommand(command) };
    });
  }, []);

  /** "Type it instead": put a typed value into field `index` (-1 = new row). Confirm is still required. */
  const editField = useCallback((index: number, type: NormalizedField['type'], text: string) => {
    setPreview((p) => {
      if (!p) return p;
      const command = withTypedValue(p.command, index, type, text);
      return { ...p, command, plan: planCommand(command) };
    });
  }, []);

  /** __DEV__ only (web screenshots): stage a preview without recording. Confirm still required. */
  const stagePreview = useCallback((p: VoicePreview) => {
    if (!__DEV__) return;
    req.current += 1;
    setThinking(false); setError(null); setPreview(p);
  }, []);

  const phase: VoiceUiPhase = thinking ? 'thinking' : ptt.phase !== 'idle' ? 'listening' : 'idle';
  const actionable = preview && (preview.plan.kind === 'navigated' || preview.plan.kind === 'assistant' || preview.plan.kind === 'filled');
  const mood: ZippyMood | null = phase !== 'idle' ? 'thinking' : cheer ? 'cheer' : actionable ? 'happy' : null;

  return { phase, error, preview, mood, speaking, pressIn, pressOut, confirm, cancel, choose, editField, abort, stagePreview };
}
