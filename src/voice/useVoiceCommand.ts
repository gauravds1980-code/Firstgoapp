import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZippyMood } from '../components/assistant/zippyStore';
import { haptic } from '../utils/haptics';
import { applyCommand, planCommand, speak, stopSpeaking, type ApplyOutcome } from './applyCommand';
import { getSttProvider } from './sttClient';
import { voiceErrorMessage, type AssistantActionName, type CommandResponse } from './types';
import { usePushToTalk } from './usePushToTalk';
import type { VoiceUiPhase } from './VoiceMicButton';

export type VoicePreview = { command: CommandResponse; plan: ApplyOutcome };

/**
 * The app's ONE voice session: hold mic → record → POST /command → staged preview → Confirm / Cancel.
 * Nothing navigates or fills until `confirm()`. Owned by VoiceHost (mounted once in RootNavigator) and
 * shared with the header badge, the floating badge and the sheet mic through `voiceSession`.
 */
export function useVoiceCommand({ onTranscript, onNavigate, readOut }: {
  /** Append the heard transcript as a user bubble (no-op when the sheet is closed). */
  onTranscript: (text: string) => void;
  /** Called right before a confirmed navigation (closes the sheet if it is open). */
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
    setError(null);
    setPreview(null);
    stopSpeaking();
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
      const command = await getSttProvider().command(r.base64, r.mimeType);
      if (id !== req.current) return;
      onTranscript(command.transcript);
      setPreview({ command, plan: planCommand(command) });
    } catch (e) {
      if (id !== req.current) return;
      haptic.error();
      setError(voiceErrorMessage(e));
    } finally {
      if (id === req.current) setThinking(false);
    }
  }, [ptt.pressOut, onTranscript]);

  // Auto-stop at the max hold length behaves like letting go.
  ptt.onAutoStop.current = () => { void pressOut(); };

  const confirm = useCallback(() => {
    const p = preview;
    if (!p) return;
    setPreview(null);
    const out = applyCommand(p.command, { navDelayMs: 250 });
    if (out.kind === 'navigated') {
      haptic.success();
      setCheer(true);
      onNavigate();
    } else if (out.kind === 'assistant') {
      setCheer(true);
      const text = readOut(out.action);
      if (text) speak(text, { onStart: () => setSpeaking(true), onDone: () => setSpeaking(false) });
    }
  }, [preview, onNavigate, readOut]);

  const cancel = useCallback(() => { setPreview(null); }, []);

  /** __DEV__ only (web screenshots): stage a preview without recording. Confirm still required. */
  const stagePreview = useCallback((p: VoicePreview) => {
    if (!__DEV__) return;
    req.current += 1;
    setThinking(false); setError(null); setPreview(p);
  }, []);

  const phase: VoiceUiPhase = thinking ? 'thinking' : ptt.phase !== 'idle' ? 'listening' : 'idle';
  const actionable = preview && (preview.plan.kind === 'navigated' || preview.plan.kind === 'assistant');
  const mood: ZippyMood | null = phase !== 'idle' ? 'thinking' : cheer ? 'cheer' : actionable ? 'happy' : null;

  return { phase, error, preview, mood, speaking, pressIn, pressOut, confirm, cancel, abort, stagePreview };
}
