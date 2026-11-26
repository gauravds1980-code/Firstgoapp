import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { haptic } from '../utils/haptics';
import { applyCommand, planCommand, ROUTE_LABEL, stopSpeaking, type ApplyOutcome } from './applyCommand';
import { PTT_MAX_HOLD_MS, PTT_MIN_HOLD_MS } from './config';
import { deviceAsrPermission, deviceAsrSupport, startDeviceAsr, warmDeviceAsr, type DeviceAsrHandle } from './deviceAsr';
import { chooseCandidate, localCommand, matchCommand, needsServerText } from './intentMatcher';
import { isReadingOut, playReply } from './piper';
import { getSttProvider } from './sttClient';
import {
  VoiceError, voiceErrorMessage, type AssistantActionName, type CommandContext, type CommandResponse, type IntentCandidate, type NormalizedField,
  type VoiceExpect, type VoiceLive, type VoiceUiPhase,
} from './types';
import { usePushToTalk } from './usePushToTalk';
import { currentCommandContext } from './voiceContext';
import { autoToastText, isOtpCommand, maskOtp, planTarget, shouldAutoExecute, undoSlotsFor, withTypedValue } from './voiceLogic';
import { voiceMetrics, type TurnMatcher, type TurnPath } from './voiceMetrics';
import {
  chooseAsrPath, classifyAsrError, contextualStrings, didYouMeanFrom, oneTapActs, reconcile, recognizerLang, type AsrPath, type TalkMode, type TurnStage,
} from './voiceMode';
import { getVoiceOptions } from './voiceOptions';
import { getVoiceSettings } from './voiceSettings';
import { captureUndo, runUndo, type UndoRecord } from './voiceUndo';

/** `expect` is what the screen asked for when the clip was sent (used for "Type it instead" with no row). */
export type VoicePreview = { command: CommandResponse; plan: ApplyOutcome; expect?: VoiceExpect };

/**
 * Non-blocking "Opening Payouts · Undo" toast after an auto-acted command. Text is OTP-safe.
 * `alt` (v1.4.0): Whisper's second check heard something else — "Did you mean …?" next to Undo.
 */
export type VoiceToast = { id: number; text: string; icon: 'navigate' | 'select' | 'fill'; alt?: string };

/** How long the auto-act toast (and its Undo) stays up. */
export const AUTO_TOAST_MS = 3000;
/** Longer when Whisper disagreed, so the dealer has time to read "Did you mean …?". */
export const ALT_TOAST_MS = 6000;
/** Push-to-talk release → wait at most this long for the recognizer's final result, then use the last partial. */
const FINAL_GRACE_MS = 1200;
/** After this many recognizer failures in a row (network, busy…), use the server path for the rest of the session. */
const MAX_DEVICE_FAILURES = 2;

const isActed = (k: ApplyOutcome['kind']): k is 'navigated' | 'selected' | 'filled' => k === 'navigated' || k === 'selected' || k === 'filled';

/** Holding the mic while a Piper read-out is still playing is refused (never cut the reply off). */
export const WAIT_FOR_ZIPPY = 'Wait until the read-out finishes, then hold the mic.';

const now = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** One voice turn (press → result). Everything async checks `id` so a newer turn always wins. */
type Turn = {
  id: number;
  metric: number;
  mode: TalkMode;
  path: AsrPath;
  ctx: CommandContext;
  otp: boolean;
  pressedAt: number;
  released: boolean;
  asr: DeviceAsrHandle | null;
  partial: string;
  handled: boolean;
  /** Result shown / applied for this turn (device or server). */
  result: CommandResponse | null;
  stage: TurnStage;
  toastId: number | null;
  audioUri: string | null;
  checkStarted: boolean;
  wantCheck: boolean;
  timers: ReturnType<typeof setTimeout>[];
};

/**
 * The app's ONE voice session (v1.4.0).
 *
 * Primary path: the phone's recognizer (expo-speech-recognition) — live partial words, final text drives the
 * on-device keyword/fuzzy matcher at once (no server round-trip), the same audio goes to the Whisper server
 * in the background as an accurate second check. Slots / numbers / OTP / on-screen options go to the server's
 * text path instead (fast: no audio upload). Fallback path (web, Expo Go, no recognition service, permission or
 * recognizer error): record → POST /command, as before.
 *
 * Modes: push-to-talk (release ends the turn) or hands-free (tap; the recognizer's end-of-speech ends it, 15 s
 * cap; tap again cancels). Act on screen first, speak after (bundled Piper clip or /tts). Low confidence or a
 * Whisper disagreement → "Did you mean …?" (one tap; destructive picks still need Confirm). Whisper never
 * silently flips an action that already ran: it offers Undo + "Did you mean …?" instead.
 */
export function useVoiceCommand({ readOut }: {
  /** Text for an assistant read-out intent; spoken and shown as a VoiceHost banner. */
  readOut: (action: AssistantActionName) => string | null;
}) {
  const ptt = usePushToTalk();
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [live, setLive] = useState<VoiceLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [preview, setPreviewState] = useState<VoicePreview | null>(null);
  const [toast, setToastState] = useState<VoiceToast | null>(null);
  const req = useRef(0);
  const turnRef = useRef<Turn | null>(null);
  const previewRef = useRef<VoicePreview | null>(null);
  const previewTurn = useRef<number | null>(null);
  const toastRef = useRef<VoiceToast | null>(null);
  const undoRef = useRef<{ id: number; record: UndoRecord } | null>(null);
  const altRef = useRef<CommandResponse | null>(null);
  const deviceOff = useRef(false);
  const deviceFails = useRef(0);
  const readOutRef = useRef(readOut);
  readOutRef.current = readOut;

  const setPreview = useCallback((p: VoicePreview | null, turnId: number | null = null) => {
    previewRef.current = p;
    previewTurn.current = p ? turnId : null;
    setPreviewState(p);
  }, []);
  const setToast = useCallback((t: VoiceToast | null) => { toastRef.current = t; setToastState(t); }, []);

  useEffect(() => { void warmDeviceAsr(); }, []);
  // One `[voice-metrics]` console line per turn in dev builds or with the metricsLog dev flag (never a transcript).
  useEffect(() => { voiceMetrics.setLogger((l) => { if (__DEV__ || getVoiceSettings().metricsLog) console.log(l); }); }, []);

  const clearTurnTimers = (t: Turn | null) => { if (t) { t.timers.forEach(clearTimeout); t.timers = []; } };
  const current = (id: number) => turnRef.current?.id === id && req.current === id;

  /** Reply AFTER the action: bundled clip or Piper /tts. Never blocks the action. OTP digits are never spoken. */
  const speakAfter = useCallback((cmd: CommandResponse, metric?: number) => {
    const text = (isOtpCommand(cmd) ? cmd.readBack ?? cmd.responseText : cmd.responseText ?? cmd.readBack) ?? '';
    if (!text.trim()) return;
    void playReply(text, { onStart: () => { if (metric) voiceMetrics.mark(metric, 'audioStart'); } });
  }, []);

  // Toast auto-dismiss: after AUTO_TOAST_MS the action stands and Undo is gone.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (toastRef.current?.id === toast.id) { setToast(null); altRef.current = null; }
      if (undoRef.current?.id === toast.id) undoRef.current = null;
      const turn = turnRef.current;
      if (turn && turn.toastId === toast.id && turn.stage === 'acted') turn.stage = 'confirmed';
    }, toast.alt ? ALT_TOAST_MS : AUTO_TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  /** One-shot Undo of the last auto-act. Never presses Verify / Continue / Submit. */
  const undo = useCallback(() => {
    const u = undoRef.current;
    undoRef.current = null;
    altRef.current = null;
    setToast(null);
    if (!u) return;
    void stopSpeaking();
    runUndo(u.record);
    haptic.select();
    void playReply('Undone.');
  }, [setToast]);

  const dismissToast = useCallback(() => { undoRef.current = null; altRef.current = null; setToast(null); }, [setToast]);

  /** Apply a command the dealer confirmed (Confirm / one-tap "Did you mean"). */
  const runConfirmed = useCallback((cmd: CommandResponse, navDelayMs = 250) => {
    const out = applyCommand(cmd, { navDelayMs });
    const t = turnRef.current;
    if (t) t.stage = 'confirmed';
    if (isActed(out.kind)) { haptic.success(); speakAfter(cmd); return; }
    if (out.kind === 'assistant') {
      const text = readOutRef.current(out.action);
      if (text) void playReply(text);
    }
  }, [speakAfter]);

  /**
   * Show / apply one result for turn `id`: high confidence acts at once (toast + Undo), anything else opens the
   * preview ("Did you mean", Confirm, say again). Speech starts after the action, never before.
   */
  const deliver = useCallback((id: number, command: CommandResponse, how: { path: TurnPath; matcher: TurnMatcher }) => {
    const t = turnRef.current;
    if (!t || t.id !== id) return;
    t.result = command;
    setThinking(false);
    voiceMetrics.tag(t.metric, { path: how.path, matcher: how.matcher });
    const plan = planCommand(command);
    if (isActed(plan.kind) && shouldAutoExecute(command, getVoiceSettings().askBeforeActing)) {
      const target = planTarget(command);
      const record = captureUndo(undoSlotsFor(target), plan.kind === 'navigated');
      const out = applyCommand(command, { navDelayMs: 0 });
      if (isActed(out.kind)) {
        voiceMetrics.mark(t.metric, 'action');
        const tid = Date.now();
        undoRef.current = { id: tid, record };
        altRef.current = null;
        t.stage = 'acted';
        t.toastId = tid;
        setPreview(null);
        setToast({
          id: tid,
          text: autoToastText(command, target, out.kind === 'navigated' ? ROUTE_LABEL[out.route] : undefined),
          icon: out.kind === 'navigated' ? 'navigate' : out.kind === 'selected' ? 'select' : 'fill',
        });
        haptic.success();
        speakAfter(command, t.metric);
        voiceMetrics.end(t.metric, { outcome: 'auto' });
        return;
      }
    }
    voiceMetrics.mark(t.metric, 'action');
    const nothing = plan.kind === 'none' && (command.status ?? 'ok') === 'retry' && !(command.candidates?.length);
    t.stage = nothing ? 'nothing' : 'preview';
    setPreview({ command, plan, ...(t.ctx.expect ? { expect: t.ctx.expect } : {}) }, id);
    speakAfter(command, t.metric);
    voiceMetrics.end(t.metric, { outcome: command.status === 'clarify' ? 'clarify' : command.status === 'retry' ? 'retry' : 'preview' });
  }, [setPreview, setToast, speakAfter]);

  const fail = useCallback((id: number, e: unknown) => {
    if (!current(id)) return;
    const t = turnRef.current;
    haptic.error();
    setThinking(false); setListening(false); setLive(null);
    setError(voiceErrorMessage(e));
    if (t) voiceMetrics.end(t.metric, { outcome: e instanceof VoiceError ? e.code : 'error' });
  }, []);

  /** Whisper's second check came back: keep, use it, re-stage "Did you mean", or offer Undo. Never a silent flip. */
  const onCheck = useCallback((id: number, server: CommandResponse) => {
    const t = turnRef.current;
    if (!t || t.id !== id) return;
    voiceMetrics.mark(t.metric, 'check');
    setLive((l) => (l && current(id) ? { ...l, checking: false } : l));
    const device = t.result;
    let stage: TurnStage = t.stage;
    if (stage === 'preview' && previewTurn.current !== id) stage = 'gone';
    if (stage === 'acted' && toastRef.current?.id !== t.toastId) stage = 'confirmed';
    if (!device) return;
    const r = reconcile(device, server, stage);
    if (r.kind === 'keep') return;
    voiceMetrics.tag(t.metric, { note: `whisper:${r.kind}` });
    if (r.kind === 'use_server') { deliver(id, server, { path: 'server', matcher: 'server' }); return; }
    if (r.kind === 'did_you_mean') {
      const cmd = didYouMeanFrom(device, server);
      setPreview({ command: cmd, plan: planCommand(cmd), ...(t.ctx.expect ? { expect: t.ctx.expect } : {}) }, id);
      return;
    }
    // offer_undo: the action stands; the toast now offers Undo and "Did you mean …?".
    const cur = toastRef.current;
    if (!cur || cur.id !== t.toastId) return;
    altRef.current = server;
    setToast({ ...cur, alt: server.matchedPhrase ?? server.intent.toLowerCase().replace(/_/g, ' ') });
  }, [deliver, setPreview, setToast]);

  /** Upload the recognizer's parallel recording to Whisper (background). Deletes the file. */
  const startCheck = useCallback((id: number) => {
    const t = turnRef.current;
    if (!t || t.id !== id || t.checkStarted || !t.audioUri || !t.wantCheck) return;
    t.checkStarted = true;
    const uri = t.audioUri;
    void (async () => {
      let b64 = '';
      const file = new File(uri);
      try { b64 = await file.base64(); } catch { /* unreadable */ } finally { try { if (file.exists) file.delete(); } catch { /* best effort */ } }
      if (!b64) { setLive((l) => (l ? { ...l, checking: false } : l)); return; }
      try {
        const server = await getSttProvider().command(b64, 'audio/wav', t.ctx, { skipTts: true });
        onCheck(id, server);
      } catch {
        // The device result stands; the check is best-effort.
        setLive((l) => (l && current(id) ? { ...l, checking: false } : l));
      }
    })();
  }, [onCheck]);

  /** Device / typed text → server text path (slots, numbers, OTP, options) or the local matcher. */
  const handleText = useCallback(async (id: number, text: string, confidence: number, via: 'device' | 'typed') => {
    const t = turnRef.current;
    if (!t || t.id !== id) return;
    const ctx = t.ctx;
    const local = localCommand(text, matchCommand(text), confidence);
    const matcher = (local.matcher === 'keyword' ? 'keyword' : local.matcher === 'fuzzy' ? 'fuzzy' : 'none') as TurnMatcher;
    const serverText = needsServerText(text, ctx) || local.status === 'retry';
    if (!serverText) { deliver(id, local, { path: via === 'typed' ? 'device+text' : 'device', matcher }); return; }
    setThinking(true);
    try {
      const cmd = await getSttProvider().text(text, ctx, { skipTts: true });
      if (!current(id)) return;
      // A weak server guess on a phrase the phone matched better: keep the local reading.
      const useLocal = local.status !== 'retry' && (cmd.status ?? 'ok') !== 'ok' && !(cmd.normalizedFields?.length);
      deliver(id, useLocal ? local : cmd, { path: 'device+text', matcher: useLocal ? matcher : cmd.matcher === 'labse' || cmd.method === 'semantic' ? 'labse' : 'server' });
    } catch (e) {
      if (!current(id)) return;
      // Server unreachable: the on-device reading still works for plain commands (never for numbers / OTP).
      if (!ctx.expect) deliver(id, local, { path: 'device', matcher });
      else fail(id, e);
    }
  }, [deliver, fail]);

  /** The recognizer's final text for turn `id`. */
  const onDeviceFinal = useCallback((id: number, raw: string, confidence: number) => {
    const t = turnRef.current;
    if (!t || t.id !== id || t.handled) return;
    t.handled = true;
    clearTurnTimers(t);
    const text = raw.trim();
    setListening(false);
    if (!t.released) { t.released = true; voiceMetrics.mark(t.metric, 'release'); } // hands-free: end-of-speech
    if (!text) { fail(id, new VoiceError('no_speech')); return; }
    deviceFails.current = 0;
    voiceMetrics.mark(t.metric, 'finalText');
    setLive({ text: t.otp ? maskOtp(text.replace(/\D/g, '').length) : text, final: true, checking: t.wantCheck });
    // The second check is best-effort: never leave "checking" up if the audio or Whisper never answers.
    if (t.wantCheck) t.timers.push(setTimeout(() => setLive((l) => (l && current(id) ? { ...l, checking: false } : l)), 8000));
    void handleText(id, text, confidence, 'device');
    startCheck(id);
  }, [fail, handleText, startCheck]);

  /** Server path: record → POST /command (skipTts) → deliver. */
  const sendRecording = useCallback(async (id: number) => {
    try {
      const r = await ptt.pressOut();
      if (!r || !current(id)) return;
      const t = turnRef.current!;
      if (r.kind === 'too_short') { setListening(false); setLive(null); setError('Hold the mic while you speak, then let go.'); voiceMetrics.end(t.metric, { outcome: 'too_short' }); return; }
      if (r.kind === 'permission_prompted') { setListening(false); setLive(null); setInfo('Microphone is on. Hold the mic and say a command.'); voiceMetrics.end(t.metric, { outcome: 'prompted' }); return; }
      setListening(false);
      setThinking(true);
      setLive({ text: '', final: true, checking: true });
      const command = await getSttProvider().command(r.base64, r.mimeType, t.ctx, { skipTts: true });
      if (!current(id)) return;
      voiceMetrics.mark(t.metric, 'finalText');
      setLive(command.transcript.trim() ? { text: isOtpCommand(command) || t.otp ? maskOtp(6) : command.transcript, final: true, checking: false } : null);
      deliver(id, command, { path: 'server', matcher: command.matcher === 'labse' || command.method === 'semantic' ? 'labse' : 'server' });
    } catch (e) {
      fail(id, e);
    } finally {
      if (current(id)) setThinking(false);
    }
  }, [ptt.pressOut, deliver, fail]);

  /** Start a turn (press-in, or a hands-free tap). Visual state flips synchronously — before permissions resolve. */
  const beginTurn = useCallback((pressedAt: number = now()) => {
    if (isReadingOut()) { setError(WAIT_FOR_ZIPPY); haptic.error(); return; }
    void stopSpeaking(); // barge-in on a short bundled clip
    const prev = turnRef.current;
    if (prev) { clearTurnTimers(prev); prev.asr?.abort(); }
    const id = ++req.current;
    const s = getVoiceSettings();
    const ctx = currentCommandContext();
    const lang = recognizerLang(s.locale);
    const sup = deviceAsrSupport(lang);
    const path = chooseAsrPath({ platform: Platform.OS, flagOn: s.onDeviceAsr, moduleLoaded: sup.moduleLoaded, recognitionAvailable: sup.available, disabledThisSession: deviceOff.current });
    const otp = ctx.expect === 'otp';
    const metric = voiceMetrics.start({ mode: s.mode, path: path === 'device' ? 'device' : 'server' }, pressedAt);
    const t: Turn = {
      id, metric, mode: s.mode, path, ctx, otp, pressedAt, released: false, asr: null, partial: '', handled: false, result: null, stage: 'nothing',
      toastId: null, audioUri: null, checkStarted: false, wantCheck: path === 'device' && !otp && sup.canRecord, timers: [],
    };
    turnRef.current = t;
    setError(null); setInfo(null); setPreview(null); setThinking(false);
    setListening(true);
    setLive({ text: '', final: false, checking: false });

    if (path === 'server') {
      ptt.pressIn(s.mode === 'handsfree' ? (d) => {
        if (!current(id)) return;
        if (d === 'no_speech') { void ptt.cancel(); setListening(false); setLive(null); setError(voiceErrorMessage(new VoiceError('no_speech'))); voiceMetrics.end(metric, { outcome: 'no_speech' }); return; }
        t.released = true;
        voiceMetrics.mark(metric, 'release');
        void sendRecording(id);
      } : undefined);
      return;
    }

    void (async () => {
      let perm = await deviceAsrPermission(false);
      if (!current(id)) return;
      if (perm !== 'granted') {
        perm = await deviceAsrPermission(true);
        if (!current(id)) return;
        if (perm !== 'granted') {
          // Speech recognition refused (iOS asks separately): the server path still works with the mic alone.
          deviceOff.current = true;
          setListening(false); setLive(null);
          setInfo('Using the voice server. Hold the mic again to talk.');
          voiceMetrics.end(metric, { outcome: 'permission' });
          return;
        }
        if (t.mode === 'ptt') {
          // The OS prompt stole the touch; the next hold records.
          setListening(false); setLive(null);
          setInfo('Microphone is on. Hold the mic and say a command.');
          voiceMetrics.end(metric, { outcome: 'prompted' });
          return;
        }
      }
      if (t.mode === 'ptt' && t.released) {
        // Let go before the recognizer started.
        setListening(false); setLive(null);
        setError('Hold the mic while you speak, then let go.');
        voiceMetrics.end(metric, { outcome: 'too_short' });
        return;
      }
      const names = getVoiceOptions(ctx.screen).map((o) => o.label);
      t.asr = startDeviceAsr({
        locale: s.locale,
        contextualStrings: contextualStrings(names),
        persistAudio: t.wantCheck,
        preferOnDevice: true,
        onPartial: (text) => {
          if (!current(id) || t.handled) return;
          t.partial = text;
          setLive({ text: t.otp ? maskOtp(text.replace(/\D/g, '').length) : text, final: false, checking: false });
        },
        onSpeechEnd: () => { if (current(id) && t.mode === 'handsfree' && !t.released) { t.released = true; voiceMetrics.mark(metric, 'release'); } },
        onFinal: (text, conf) => onDeviceFinal(id, text, conf),
        onAudio: (uri) => {
          if (turnRef.current?.id !== id) { try { new File(uri).delete(); } catch { /* ignore */ } return; }
          t.audioUri = uri;
          if (t.handled) startCheck(id);
        },
        onError: (code) => {
          if (!current(id) || t.handled) return;
          const kind = classifyAsrError(code);
          if (kind === 'cancelled') return;
          t.handled = true;
          clearTurnTimers(t);
          setListening(false);
          if (kind === 'no_speech') { setLive(null); setError(voiceErrorMessage(new VoiceError('no_speech'))); voiceMetrics.end(metric, { outcome: 'no_speech' }); return; }
          if (kind === 'disable' || kind === 'permission') deviceOff.current = true;
          else if (++deviceFails.current >= MAX_DEVICE_FAILURES) deviceOff.current = true;
          setLive(null);
          setInfo(deviceOff.current ? 'Phone speech recognition isn’t available here. Using the voice server — hold the mic again.' : 'Couldn’t hear that clearly. Hold the mic and try again.');
          voiceMetrics.end(metric, { outcome: `asr_${kind}` });
        },
        onEnd: () => { if (current(id) && !t.handled) setListening(false); },
      });
      if (!t.asr) { deviceOff.current = true; return; }
      // Cap: 15 s. Hands-free otherwise ends at the recognizer's end-of-speech.
      t.timers.push(setTimeout(() => { if (current(id) && !t.handled) t.asr?.stop(); }, PTT_MAX_HOLD_MS));
    })();
  }, [ptt.pressIn, ptt.cancel, sendRecording, onDeviceFinal, startCheck, setPreview]);

  /** Push-to-talk release (or the 15 s cap): end the turn now — no post-release silence wait. */
  const endInput = useCallback((releasedAt: number = now()) => {
    const t = turnRef.current;
    if (!t || t.id !== req.current || t.released) return;
    t.released = true;
    voiceMetrics.mark(t.metric, 'release', releasedAt);
    if (t.path === 'server') { void sendRecording(t.id); return; }
    const held = releasedAt - t.pressedAt;
    if (!t.asr) return; // still starting: the start routine sees `released` and ends the turn
    if (held < PTT_MIN_HOLD_MS && !t.partial) {
      t.handled = true;
      t.asr.abort();
      setListening(false); setLive(null);
      setError('Hold the mic while you speak, then let go.');
      voiceMetrics.end(t.metric, { outcome: 'too_short' });
      return;
    }
    // Show what was heard right away; the recognizer's final result replaces it in a moment.
    setListening(false);
    if (t.partial) { voiceMetrics.mark(t.metric, 'finalText'); setLive({ text: t.otp ? maskOtp(t.partial.replace(/\D/g, '').length) : t.partial, final: true, checking: true }); }
    t.asr.stop();
    const id = t.id;
    t.timers.push(setTimeout(() => { if (current(id) && !t.handled) onDeviceFinal(id, t.partial, 0.5); }, FINAL_GRACE_MS));
  }, [sendRecording, onDeviceFinal]);

  /** Cancel any recording / request in flight, drop the preview and stop speech. */
  const abort = useCallback(() => {
    const t = turnRef.current;
    req.current += 1;
    if (t) { clearTurnTimers(t); t.asr?.abort(); if (!t.handled) voiceMetrics.end(t.metric, { outcome: 'cancelled' }); }
    void ptt.cancel();
    void stopSpeaking();
    setThinking(false); setListening(false); setLive(null); setError(null); setInfo(null); setPreview(null);
  }, [ptt.cancel, setPreview]);

  useEffect(() => () => { req.current += 1; turnRef.current?.asr?.abort(); void stopSpeaking(); }, []);

  const isTurnLive = () => { const t = turnRef.current; return !!t && t.id === req.current && !t.handled && !t.released; };

  const pressIn = useCallback((at?: number) => {
    if (getVoiceSettings().mode === 'handsfree') return; // hands-free uses tap()
    beginTurn(at);
  }, [beginTurn]);

  const pressOut = useCallback(async (at?: number) => {
    if (getVoiceSettings().mode === 'handsfree') return;
    endInput(at);
  }, [endInput]);

  /** Hands-free: tap to start, tap again to cancel. */
  const tap = useCallback((at?: number) => {
    if (isTurnLive() || ptt.phase !== 'idle') {
      abort();
      setInfo('Okay, cancelled.');
      void playReply('Okay, cancelled.');
      return;
    }
    beginTurn(at);
  }, [beginTurn, abort, ptt.phase]);

  // Auto-stop at the max hold length behaves like letting go.
  ptt.onAutoStop.current = () => { endInput(); };

  const confirm = useCallback(() => {
    const p = previewRef.current;
    if (!p) return;
    setPreview(null);
    runConfirmed(p.command);
  }, [runConfirmed, setPreview]);

  const cancel = useCallback(() => {
    if (!previewRef.current) return;
    setPreview(null);
    const t = turnRef.current;
    if (t) t.stage = 'gone';
    void playReply('Okay, cancelled.');
  }, [setPreview]);

  /**
   * "Did you mean …?" pick. Non-destructive → that tap IS the confirm (acts now). Destructive (sign / pay /
   * mandate / upload / submit) → staged, the normal Confirm is still required.
   */
  const choose = useCallback((c: IntentCandidate) => {
    const p = previewRef.current;
    if (!p) return;
    const command = chooseCandidate(p.command, c);
    if (oneTapActs(command)) { setPreview(null); runConfirmed(command); return; }
    setPreview({ ...p, command, plan: planCommand(command) }, previewTurn.current);
  }, [runConfirmed, setPreview]);

  /** Toast "Did you mean …?" after Whisper disagreed: undo the auto-act, then stage Whisper's reading. */
  const chooseAlt = useCallback(() => {
    const alt = altRef.current;
    const u = undoRef.current;
    undoRef.current = null;
    altRef.current = null;
    setToast(null);
    if (u) runUndo(u.record);
    if (!alt) return;
    const plan = planCommand(alt);
    if (oneTapActs(alt) && isActed(plan.kind)) { runConfirmed(alt, 300); return; }
    setPreview({ command: alt, plan }, turnRef.current?.id ?? null);
  }, [runConfirmed, setPreview, setToast]);

  /** Preview "Say again": hands-free listens again right away; push-to-talk asks for a new hold. */
  const sayAgain = useCallback(() => {
    setPreview(null);
    if (getVoiceSettings().mode === 'handsfree') { beginTurn(); return; }
    setInfo('Hold the mic and say it again.');
  }, [beginTurn, setPreview]);

  /** The dealer corrected the transcript by typing: match it again (same rules; destructive still needs Confirm). */
  const editTranscript = useCallback((text: string) => {
    const p = previewRef.current;
    const clean = text.trim();
    if (!p || !clean) return;
    setPreview(null);
    const id = ++req.current;
    const metric = voiceMetrics.start({ mode: getVoiceSettings().mode, path: 'device+text', note: 'typed' });
    turnRef.current = {
      id, metric, mode: getVoiceSettings().mode, path: 'device', ctx: currentCommandContext(), otp: false, pressedAt: now(), released: true, asr: null, partial: '',
      handled: true, result: null, stage: 'nothing', toastId: null, audioUri: null, checkStarted: false, wantCheck: false, timers: [],
    };
    voiceMetrics.mark(metric, 'release');
    voiceMetrics.mark(metric, 'finalText');
    setLive({ text: clean, final: true, checking: false });
    void handleText(id, clean, 1, 'typed');
  }, [handleText, setPreview]);

  /** "Type it instead": put a typed value into field `index` (-1 = new row). Confirm is still required. */
  const editField = useCallback((index: number, type: NormalizedField['type'], text: string) => {
    const p = previewRef.current;
    if (!p) return;
    const command = withTypedValue(p.command, index, type, text);
    setPreview({ ...p, command, plan: planCommand(command) }, previewTurn.current);
  }, [setPreview]);

  /** __DEV__ only (web screenshots): stage a preview without recording. Confirm still required. */
  const stagePreview = useCallback((p: VoicePreview) => {
    if (!__DEV__) return;
    req.current += 1;
    setThinking(false); setError(null); setPreview(p);
  }, [setPreview]);

  // The heard-text pill fades a moment after the turn settles (the toast / preview carries on).
  useEffect(() => {
    if (!live?.final || live.checking || thinking) return;
    const tm = setTimeout(() => setLive((l) => (l && l.final && !l.checking ? null : l)), 2500);
    return () => clearTimeout(tm);
  }, [live, thinking]);

  const phase: VoiceUiPhase = listening || ptt.phase !== 'idle' ? 'listening' : thinking ? 'thinking' : 'idle';

  return {
    phase, live, error, info, preview, toast, undo, chooseAlt, dismissToast, pressIn, pressOut, tap, confirm, cancel, choose, editField, editTranscript, sayAgain,
    abort, stagePreview,
  };
}
