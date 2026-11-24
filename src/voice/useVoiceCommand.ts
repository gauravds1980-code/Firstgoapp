import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic } from '../utils/haptics';
import { applyCommand, planCommand, ROUTE_LABEL, speak, stopSpeaking, type ApplyOutcome } from './applyCommand';
import { isSpeaking } from './piper';
import { getSttProvider } from './sttClient';
import { voiceErrorMessage, type AssistantActionName, type CommandResponse, type IntentCandidate, type NormalizedField, type VoiceExpect, type VoiceUiPhase } from './types';
import { usePushToTalk } from './usePushToTalk';
import { currentCommandContext } from './voiceContext';
import { autoToastText, isOtpCommand, planTarget, shouldAutoExecute, undoSlotsFor, withCandidate, withTypedValue } from './voiceLogic';
import { getAskBeforeActing } from './voiceSettings';
import { captureUndo, runUndo, type UndoRecord } from './voiceUndo';

/** `expect` is what the screen asked for when the clip was sent (used for "Type it instead" with no row). */
export type VoicePreview = { command: CommandResponse; plan: ApplyOutcome; expect?: VoiceExpect };

/** Non-blocking "Opening QR journey · Undo" toast after an auto-acted command. Text is OTP-safe. */
export type VoiceToast = { id: number; text: string; icon: 'navigate' | 'select' | 'fill' };

/** How long the auto-act toast (and its Undo) stays up. */
export const AUTO_TOAST_MS = 3000;

const isActed = (k: ApplyOutcome['kind']): k is 'navigated' | 'selected' | 'filled' => k === 'navigated' || k === 'selected' || k === 'filled';

/** Holding the mic while a Piper read-out is still playing is refused (never cut the reply off). */
export const WAIT_FOR_ZIPPY = 'Wait until the read-out finishes, then hold the mic.';

/**
 * The app's ONE voice session: hold mic → record → POST /command → staged preview → Confirm / Cancel.
 * Low / mid confidence: nothing navigates or fills until `confirm()`. High confidence (v1.2.7,
 * `shouldAutoExecute`, "Ask before acting" off): the command is applied at once, the Piper read-out starts
 * at the same time (never delaying the action), and a 3 s toast offers Undo. Owned by VoiceHost (mounted once in RootNavigator) and
 * shared with the standalone header mic (HeaderVoiceMic) through `voiceSession`. Not tied to Zippy: it
 * publishes no Zippy mood / lip state and never opens or writes into the help sheet.
 *
 * While a Piper read-out is playing (the preview read-back or a help answer) a hold is ignored: the read-out is
 * never cut off to start recording, and the server would refuse the clip anyway (HTTP 409).
 */
export function useVoiceCommand({ readOut }: {
  /** Text for an assistant read-out intent; spoken and shown as a VoiceHost banner. */
  readOut: (action: AssistantActionName) => string | null;
}) {
  const ptt = usePushToTalk();
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<VoicePreview | null>(null);
  const req = useRef(0);
  const [toast, setToast] = useState<VoiceToast | null>(null);
  const undoRef = useRef<{ id: number; record: UndoRecord } | null>(null);
  const say = useCallback((text: string, precomputed?: { audioBase64?: string; audioDurationSec?: number }) => {
    void speak(text, {}, precomputed);
  }, []);

  /** Cancel any recording / request in flight, drop the preview and stop speech. */
  const abort = useCallback(() => {
    req.current += 1;
    ptt.cancel();
    stopSpeaking();
    setThinking(false); setError(null); setPreview(null);
  }, [ptt.cancel]);

  // Toast auto-dismiss: after AUTO_TOAST_MS the action stands and Undo is gone.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast((cur) => (cur?.id === toast.id ? null : cur));
      if (undoRef.current?.id === toast.id) undoRef.current = null;
    }, AUTO_TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  /** One-shot Undo of the last auto-act. Never presses Verify / Continue / Submit. */
  const undo = useCallback(() => {
    const u = undoRef.current;
    undoRef.current = null;
    setToast(null);
    if (!u) return;
    stopSpeaking();
    runUndo(u.record);
    haptic.select();
  }, []);

  const dismissToast = useCallback(() => { undoRef.current = null; setToast(null); }, []);

  useEffect(() => () => { req.current += 1; stopSpeaking(); }, []);

  const pressIn = useCallback(() => {
    // Do not cut the Piper read-out off: the dealer waits for the read-out to finish, then holds.
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
      if (r.kind === 'permission_prompted') { setError('Microphone is on. Hold the mic and say a command.'); return; }
      setThinking(true);
      const ctx = currentCommandContext();
      const command = await getSttProvider().command(r.base64, r.mimeType, ctx);
      if (id !== req.current) return;
      const plan = planCommand(command);
      // Piper reads the result back with the Piper WAV the server already made (no second /tts call).
      // For OTP the server's text is already safe ("OTP captured, six digits"); never speak digits here.
      const readBack = () => {
        const text = (isOtpCommand(command) ? command.readBack ?? command.responseText : command.responseText ?? command.readBack) ?? '';
        if (command.audioBase64) say(text, { audioBase64: command.audioBase64, audioDurationSec: command.audioDurationSec });
        else if (command.readBack) say(command.readBack);
      };

      // High confidence: act now, speak at the same time, offer Undo. No Confirm sheet.
      if (isActed(plan.kind) && shouldAutoExecute(command, getAskBeforeActing())) {
        const target = planTarget(command);
        const record = captureUndo(undoSlotsFor(target), plan.kind === 'navigated');
        const out = applyCommand(command, { navDelayMs: 0 });
        if (isActed(out.kind)) {
          const tid = Date.now();
          undoRef.current = { id: tid, record };
          setPreview(null);
          setToast({
            id: tid,
            text: autoToastText(command, target, out.kind === 'navigated' ? ROUTE_LABEL[out.route] : undefined),
            icon: out.kind === 'navigated' ? 'navigate' : out.kind === 'selected' ? 'select' : 'fill',
          });
          haptic.success();
          readBack();
          return;
        }
      }

      setPreview({ command, plan, ...(ctx.expect ? { expect: ctx.expect } : {}) });
      readBack();
    } catch (e) {
      if (id !== req.current) return;
      haptic.error();
      setError(voiceErrorMessage(e));
    } finally {
      if (id === req.current) setThinking(false);
    }
  }, [ptt.pressOut, say]);

  // Auto-stop at the max hold length behaves like letting go.
  ptt.onAutoStop.current = () => { void pressOut(); };

  const confirm = useCallback(() => {
    const p = preview;
    if (!p) return;
    setPreview(null);
    const out = applyCommand(p.command, { navDelayMs: 250 });
    if (out.kind === 'navigated' || out.kind === 'filled' || out.kind === 'selected') {
      haptic.success();
    } else if (out.kind === 'assistant') {
      const text = readOut(out.action);
      if (text) say(text);
    }
  }, [preview, readOut, say]);

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

  return { phase, error, preview, toast, undo, dismissToast, pressIn, pressOut, confirm, cancel, choose, editField, abort, stagePreview };
}
