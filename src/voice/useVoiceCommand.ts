import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { File } from 'expo-file-system';
import { haptic } from '../utils/haptics';
import { applyCommand, planCommand, ROUTE_LABEL, stopSpeaking, type ApplyOutcome } from './applyCommand';
import { PTT_MAX_HOLD_MS, PTT_MIN_HOLD_MS, voiceRoutes } from './config';
import { assessDeviceResult, downgradeCommand, gateDiagText, MAX_PARTIALS, normalizeAsrConfidence, runGate, WHISPER_DISAGREE_MIN } from './confidenceGate';
import { countAsrPartial, markAsrStarted, resetAsrTurn, updateAsrDiag } from './asrDiag';
import { getEarlyWhisper } from './earlyWhisper';
import { deviceAsrPermission, deviceAsrSupport, markOnDeviceBroken, markPersistBroken, prepareDeviceAsr, startDeviceAsr, warmDeviceAsr, type DeviceAsrHandle } from './deviceAsr';
import { DIDNT_CATCH, pressAction, prevTurnEndReason, selfEndAction } from './micFlow';
import { chooseCandidate, localCommand, matchCommand, needsServerText, serverOverConfirm, shouldAskServerOnConfirm } from './intentMatcher';
import { isParallelBroken, isParallelClash, markParallelBroken, parallelDiagText, registerTurnStreams, settleParallel, TurnCheck, TurnStreams, wantParallelStream, type ParallelOffReason } from './parallelWhisper';
import { isReadingOut, playReply } from './piper';
import { playVoiceCue } from './playVoiceCue';
import { liveTextFromPartial } from './serverStream';
import { getSttProvider, parseResponse, routeFailureKind } from './sttClient';
import {
  VoiceError, voiceErrorMessage, type AssistantActionName, type CommandContext, type CommandResponse, type IntentCandidate, type NormalizedField,
  type VoiceExpect, type VoiceLive, type VoiceUiPhase,
} from './types';
import { usePcmStream } from './usePcmStream';
import { usePushToTalk } from './usePushToTalk';
import { currentCommandContext } from './voiceContext';
import { autoToastText, isOtpCommand, maskOtp, planTarget, shouldAutoExecute, undoSlotsFor, withTypedValue } from './voiceLogic';
import { voiceMetrics, type TurnMatcher, type TurnPath } from './voiceMetrics';
import {
  classifyAsrError, explainAsrPath, contextualStrings, didYouMeanFrom, oneTapActs, reconcile, recognizerLang, type AsrPath, type TalkMode, type TurnStage,
} from './voiceMode';
import { getVoiceOptions } from './voiceOptions';
import { guardAnswer, NO_CONNECTION, offlineReading, offlineVerdict, optionAsConfirm, resolveOnPhone, serverOrOption } from './optionResolver';
import { isFieldAnswer } from './fieldResolver';
import { answerPending, askVoiceConfirm, parseYesNo, subscribeVoiceAsk } from './voiceAsk';
import { advanceMatcherGuard, decideAdvance, getVoiceStep, isAdvancePhrase, isAdvanceReply, resolveAdvance } from './voiceStep';
import { decideOtpTurn, ESIGN_VERIFY_TEXT, otpMaskFor, otpOfflineCommand, planOtpTurn } from './otpParse';
import { voiceDraft } from './voiceDraft';
import { getVoiceSettings, subscribeVoiceSettings } from './voiceSettings';
import { captureUndo, runUndo, type UndoRecord } from './voiceUndo';
import { cueKindFor, replyMode, type VoiceCueKind } from './voiceCues';
import { logDelivered, logTurnEnd, logTurnOutcome, noteDeviceText, turnExtras } from './voiceTurnLogApp';

/**
 * End-of-turn reply (v1.4.2). `voice.spokenReplies` on → Piper (bundled clip or /tts) as before; off (default) →
 * a short cue sound, never /tts. Either way /command was sent skipTts, so it never synthesises.
 */
function voiceRespond(r: { text?: string; cue: VoiceCueKind; metric?: number; haptic?: boolean }): void {
  const onStart = () => { if (r.metric) voiceMetrics.mark(r.metric, 'audioStart'); };
  if (replyMode(getVoiceSettings().spokenReplies) === 'speech') {
    if (r.text?.trim()) void playReply(r.text, { onStart });
    return;
  }
  playVoiceCue(r.cue, { haptic: r.haptic, onStart });
}

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
  /** v1.4.2: recent distinct partials (capped at MAX_PARTIALS) for the confidence gate's stability score. */
  partials: string[];
  /**
   * Confidence gate: 'waiting' = a shaky phone result is held while Whisper is awaited (onCheck resolves
   * `gateResolve` instead of reconciling); 'done' = delivered, later checks go through reconcile as before.
   */
  gate: 'none' | 'waiting' | 'done';
  gateResolve: ((r: CommandResponse | null) => void) | null;
  /** v1.4.2 server path: live PCM stream (usePcmStream) instead of the whole-clip recorder. */
  streamed?: boolean;
  /** v1.4.2 device path, voice.parallelStream: PCM streamed to Whisper alongside the recogniser (parallelWhisper.ts). */
  par?: { startedAt: number; released: boolean };
  /** One Whisper second check per turn: the streamed /end or the WAV upload, whichever answers first (parallelWhisper.ts). */
  check?: TurnCheck;
  /** v1.4.5: transparent recogniser restarts after it ended by itself while the finger was still down (micFlow.ts). */
  restarts?: number;
  /** v1.4.5: the current recogniser session emitted its 'end'. */
  asrEnded?: boolean;
  /** v1.4.5: the voice Confirm card that was open when this turn started (a spoken "yes" / "no" answers it). */
  prevPreview?: VoicePreview | null;
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
  const pcm = usePcmStream();
  const pcmRef = useRef(pcm);
  pcmRef.current = pcm;
  /** Per-turn stream results for the confidence gate's early-Whisper hook (registered while mounted). */
  const [streams] = useState(() => new TurnStreams());
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
  /** v1.4.5: the last answer asked for a value ("How much?" → expect 'amount' on the next turn). */
  const expectNextRef = useRef<{ expect: VoiceExpect; screen?: string; at: number } | null>(null);
  const toastRef = useRef<VoiceToast | null>(null);
  const undoRef = useRef<{ id: number; record: UndoRecord } | null>(null);
  const altRef = useRef<CommandResponse | null>(null);
  const deviceOff = useRef(false);
  const deviceFails = useRef(0);
  const deviceOffBy = useRef<'permission' | 'error'>('error');
  const readOutRef = useRef(readOut);
  readOutRef.current = readOut;
  /** endInput is defined after beginTurn; the 15 s cap calls it through this ref. */
  const endInputRef = useRef<(at?: number) => void>(() => {});

  const setPreview = useCallback((p: VoicePreview | null, turnId: number | null = null) => {
    previewRef.current = p;
    previewTurn.current = p ? turnId : null;
    setPreviewState(p);
  }, []);
  const setToast = useCallback((t: VoiceToast | null) => { toastRef.current = t; setToastState(t); }, []);

  useEffect(() => { void warmDeviceAsr(); }, []);

  // v1.4.5 voiceAsk: a screen's spoken question ("Pay ₹80,000 now? Say yes to pay.") or line ("That OTP didn't work…")
  // is shown as the info banner and read out (Piper with spoken replies on, else the confirm cue).
  useEffect(() => subscribeVoiceAsk((e) => {
    if (e.kind === 'ask') { setInfo(e.q.prompt); void stopSpeaking().then(() => voiceRespond({ text: e.q.prompt, cue: 'confirm' })).catch(() => {}); return; }
    if (e.kind === 'clear') { setInfo(null); return; }
    setInfo(e.text);
    void stopSpeaking().then(() => voiceRespond({ text: e.text, cue: e.cue === 'error' ? 'notUnderstood' : 'confirm' })).catch(() => {});
    if (e.cue === 'error') haptic.error();
  }), []);
  useEffect(() => registerTurnStreams(streams), [streams]);
  // v1.4.2: the phone recognizer gets another chance when the dealer toggles it in Settings, or on the next
  // app foreground after it was paused for a non-permission reason (no app restart needed).
  useEffect(() => {
    let flag = getVoiceSettings().onDeviceAsr;
    const unsub = subscribeVoiceSettings(() => {
      const next = getVoiceSettings().onDeviceAsr;
      if (next !== flag) { flag = next; deviceOff.current = false; deviceFails.current = 0; deviceOffBy.current = 'error'; }
    });
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && deviceOff.current && deviceOffBy.current !== 'permission') { deviceOff.current = false; deviceFails.current = 0; }
    });
    return () => { unsub(); sub.remove(); };
  }, []);
  // One `[voice-metrics]` console line per turn in dev builds or with the metricsLog dev flag (never a transcript).
  useEffect(() => { voiceMetrics.setLogger((l) => { if (__DEV__ || getVoiceSettings().metricsLog) console.log(l); }); }, []);

  const clearTurnTimers = (t: Turn | null) => { if (t) { t.timers.forEach(clearTimeout); t.timers = []; } };
  const current = (id: number) => turnRef.current?.id === id && req.current === id;
  /** The turn's 'release' metric mark (same clock as now()); the gate's cap is measured from it. */
  const releaseTime = (t: Turn): number => voiceMetrics.turns().find((x) => x.id === t.metric)?.marks.release ?? now();
  const parallelOff = (r: ParallelOffReason) => updateAsrDiag({ parallel: parallelDiagText(r) });
  /** Release of the device-path parallel stream: stop its capture and register finish() (Whisper's answer) for the gate. */
  const releaseParallel = (t: Turn) => {
    if (!t.par || t.par.released) return;
    t.par.released = true;
    streams.set(t.id, settleParallel(pcmRef.current.stop(), t.ctx, parallelOff, turnExtras(t, 'device+check', { skipTts: true })));
    // Read it back through earlyWhisper.ts (the same promise the gate gets) and feed it to the turn's check, so a
    // confident turn's Whisper correction shows in the pill / transcript sheet exactly like the WAV check's.
    const id = t.id;
    void getEarlyWhisper({ id, ctx: t.ctx, releasedAt: releaseTime(t) })?.then((r) => { if (current(id)) t.check?.stream(r); });
  };
  /** The turn ended without a release (error / too short / new turn): drop the parallel capture unsent. */
  const dropParallel = (t: Turn | null) => { if (t?.par && !t.par.released) { t.par.released = true; void pcmRef.current.cancel(); } };

  /**
   * Reply AFTER the action: a cue (default) or, with spokenReplies on, a bundled clip / Piper /tts. Never blocks
   * the action. OTP digits are never spoken. `acted`: this turn already ran the command (haptic.success fired).
   */
  const speakAfter = useCallback((cmd: CommandResponse, metric?: number, how?: { acted?: boolean; nothing?: boolean }) => {
    const text = (isOtpCommand(cmd) ? cmd.readBack ?? cmd.responseText : cmd.responseText ?? cmd.readBack) ?? '';
    const cue = cueKindFor({
      didAct: how?.acted,
      status: cmd.status,
      hasCandidates: !!cmd.candidates?.length,
      kind: how?.nothing ? 'nothing' : how?.acted ? 'acted' : 'preview',
    });
    voiceRespond({ text, cue, metric, haptic: how?.acted ? false : undefined });
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
    voiceRespond({ text: 'Undone.', cue: cueKindFor({ kind: 'undone' }), haptic: false });
  }, [setToast]);

  const dismissToast = useCallback(() => { undoRef.current = null; altRef.current = null; setToast(null); }, [setToast]);

  /** Apply a command the dealer confirmed (Confirm / one-tap "Did you mean"). */
  const runConfirmed = useCallback((cmd: CommandResponse, navDelayMs = 250) => {
    const out = applyCommand(cmd, { navDelayMs });
    const t = turnRef.current;
    if (t) { t.stage = 'confirmed'; logTurnOutcome(t, 'executed', 'confirmed'); }
    if (isActed(out.kind)) { haptic.success(); speakAfter(cmd, undefined, { acted: true }); return; }
    if (out.kind === 'assistant') {
      const text = readOutRef.current(out.action);
      if (text) voiceRespond({ text, cue: cueKindFor({ kind: 'assistant' }) });
    }
  }, [speakAfter]);

  /**
   * Show / apply one result for turn `id`: high confidence acts at once (toast + Undo), anything else opens the
   * preview ("Did you mean", Confirm, say again). Speech starts after the action, never before.
   */
  const deliver = useCallback((id: number, command: CommandResponse, how: { path: TurnPath; matcher: TurnMatcher }) => {
    const t = turnRef.current;
    if (!t || t.id !== id) return;
    // v1.4.5: every answer (server, Whisper check, phone) — an amount never navigates, "pay …" is never the mandate.
    if (!t.otp) command = guardAnswer(command, command.transcript, t.ctx);
    // v1.4.5 OTP turn: a wrong-length code is never filled, a transcript with digits is never shown.
    const otpDecision = t.otp ? decideOtpTurn(command, t.ctx.screen) : null;
    if (otpDecision) command = otpDecision.command;
    // v1.4.5 REQUIREMENT CHANGE (Gaurav): the e-sign OTP step is fully hands-off. Exactly 6 digits in this turn
    // (server or phone) → fill the boxes AND verify at once: no Confirm card, no "Did you mean", no tap. Only the
    // masked "OTP entered, verifying" is shown / spoken. The Esign screen takes slots.otp + otpSubmit and verifies.
    const esignCode = otpDecision?.kind === 'esign_auto' ? otpDecision.code : null;
    if (esignCode) {
      t.result = command;
      t.stage = 'acted';
      setThinking(false);
      setLive({ text: maskOtp(6), final: true, checking: false, source: how.path === 'server' ? 'server' : 'device', turn: id });
      voiceMetrics.tag(t.metric, { path: how.path, matcher: how.matcher, note: 'otp:esign-auto' });
      voiceDraft.merge({ intent: 'UNKNOWN', transcript: '[otp utterance]', slots: { otp: esignCode, otpSubmit: true } });
      undoRef.current = null; altRef.current = null;
      setPreview(null);
      const tid = Date.now();
      t.toastId = tid;
      setToast({ id: tid, text: ESIGN_VERIFY_TEXT, icon: 'fill' });
      haptic.success();
      voiceRespond({ text: ESIGN_VERIFY_TEXT, cue: cueKindFor({ didAct: true, status: 'ok', hasCandidates: false, kind: 'acted' }), metric: t.metric, haptic: false });
      voiceMetrics.end(t.metric, { outcome: 'auto' }); logDelivered(t, command, how.path, true); // OTP turn: logDelivered posts nothing
      return;
    }
    // v1.4.5 S2.2 ADVANCE: the phone's command list picked it from a longer sentence → say again; a real advance
    // presses what THIS screen / sheet registered (voiceStep.ts), never Go home / Enhance / Change tenure.
    if (!t.otp) command = advanceMatcherGuard(command.transcript, command);
    if (!t.otp && isAdvanceReply(command)) {
      t.result = command;
      expectNextRef.current = null;
      setThinking(false);
      setPreview(null);
      voiceMetrics.tag(t.metric, { path: how.path, matcher: how.matcher, note: 'advance' });
      const route = t.ctx.screen;
      // "submit MH12BC1260": the plate said with the submit word fills the RC field first.
      const advReg = command.action.type === 'advance' ? command.action.reg : undefined;
      if (advReg) voiceDraft.merge({ intent: 'SET_RC_NUMBER', transcript: command.transcript, slots: { rcNumber: advReg } });
      const d = decideAdvance(command, getVoiceStep(route));
      voiceMetrics.mark(t.metric, 'action');
      if (d.kind === 'press') {
        t.stage = 'acted';
        // A plate filled in this same turn reaches the sheet's state on its next render: press right after it.
        if (advReg) { const c = d.control; setTimeout(() => c.press(), 60); } else d.control.press();
        haptic.success();
        const tid = Date.now();
        t.toastId = tid; undoRef.current = null; altRef.current = null;
        setToast({ id: tid, text: d.control.destructive ? `${d.control.label}` : `Continuing · ${d.control.label}`, icon: 'navigate' });
        voiceRespond({ text: d.text, cue: cueKindFor({ didAct: true, status: 'ok', hasCandidates: false, kind: 'acted' }), metric: t.metric, haptic: false });
        voiceMetrics.end(t.metric, { outcome: 'auto' });
        logDelivered(t, command, how.path, true);
        return;
      }
      if (d.kind === 'confirm') {
        // Spoken confirm: a voice "yes" (or the on-screen button) presses it — the CURRENT registration of that CTA,
        // so a closed sheet / changed step is never pressed by a late yes.
        t.stage = 'preview';
        const id0 = d.control.id;
        askVoiceConfirm({
          prompt: d.prompt,
          ttlMs: 60_000,
          yesWords: ['submit', 'send', 'pay', 'disburse', 'confirm', 'proceed', 'continue', 'next'],
          onYes: () => {
            const st = getVoiceStep(route);
            const c = [st?.cta, ...(st?.alts ?? [])].find((x) => x?.id === id0);
            if (c && c.enabled !== false) { c.press(); haptic.success(); } else voiceRespond({ text: 'That step has changed. Tap the button instead.', cue: 'notUnderstood' });
          },
        });
        voiceMetrics.end(t.metric, { outcome: 'preview' });
        logDelivered(t, command, how.path, false);
        return;
      }
      t.stage = 'nothing';
      setInfo(d.text);
      voiceRespond({ text: d.text, cue: cueKindFor({ kind: 'nothing' }), metric: t.metric });
      voiceMetrics.end(t.metric, { outcome: 'retry' });
      logDelivered(t, command, how.path, false);
      return;
    }
    t.result = command;
    expectNextRef.current = command.expectNext ? { expect: command.expectNext, screen: t.ctx.screen, at: Date.now() } : null;
    setThinking(false);
    voiceMetrics.tag(t.metric, { path: how.path, matcher: how.matcher });
    // v1.4.2: a server / Whisper reading replaces the phone's words in the pill and the live transcript.
    if (how.path === 'server' && command.transcript.trim()) {
      const masked = t.otp || isOtpCommand(command);
      setLive((l) => (l && l.turn === id && l.source === 'server') ? l
        : { text: masked ? maskOtp(6) : command.transcript.trim(), final: true, checking: false, source: 'server', turn: id });
    }
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
        speakAfter(command, t.metric, { acted: true });
        voiceMetrics.end(t.metric, { outcome: 'auto' });
        logDelivered(t, command, how.path, true);
        return;
      }
    }
    voiceMetrics.mark(t.metric, 'action');
    const nothing = plan.kind === 'none' && (command.status ?? 'ok') === 'retry' && !(command.candidates?.length);
    t.stage = nothing ? 'nothing' : 'preview';
    setPreview({ command, plan, ...(t.ctx.expect ? { expect: t.ctx.expect } : {}) }, id);
    speakAfter(command, t.metric, { nothing });
    voiceMetrics.end(t.metric, { outcome: command.status === 'clarify' ? 'clarify' : command.status === 'retry' ? 'retry' : 'preview' });
    logDelivered(t, command, how.path, false);
  }, [setPreview, setToast, speakAfter]);

  const fail = useCallback((id: number, e: unknown) => {
    if (!current(id)) return;
    const t = turnRef.current;
    haptic.error();
    setThinking(false); setListening(false); setLive(null);
    // v1.4.5: every voice route is down → one clear message instead of the generic "Could not reach…".
    setError(voiceRoutes.allDown() && routeFailureKind(e) !== 'app' ? NO_CONNECTION : voiceErrorMessage(e));
    if (t) { voiceMetrics.end(t.metric, { outcome: e instanceof VoiceError ? e.code : 'error' }); logTurnEnd(t, e); }
  }, []);

  /** v1.4.5: no route answers and the phone is not sure on its own: "No connection — try again or tap it" (no fuzzy guess). */
  const noConnection = useCallback((id: number) => {
    if (!current(id)) return;
    const t = turnRef.current;
    haptic.error();
    setThinking(false); setListening(false); setLive(null);
    setError(NO_CONNECTION);
    if (t) { voiceMetrics.tag(t.metric, { note: 'no-connection' }); voiceMetrics.end(t.metric, { outcome: 'no_connection' }); logTurnEnd(t, 'no_connection'); }
  }, []);

  /** Whisper's second check came back: keep, use it, re-stage "Did you mean", or offer Undo. Never a silent flip. */
  const onCheck = useCallback((id: number, server: CommandResponse) => {
    const t = turnRef.current;
    if (!t || t.id !== id) return;
    voiceMetrics.mark(t.metric, 'check');
    setLive((l) => (l && current(id) ? { ...l, checking: false } : l));
    // The confidence gate is holding a shaky phone result for this check: hand it over (the gate delivers once).
    if (t.gate === 'waiting' && t.gateResolve) { const r = t.gateResolve; t.gateResolve = null; r(server); return; }
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
      voiceRespond({ cue: 'confirm' }); // re-staged "Did you mean": cue only (nothing was spoken here before)
      return;
    }
    // offer_undo: the action stands; the toast now offers Undo and "Did you mean …?".
    const cur = toastRef.current;
    if (!cur || cur.id !== t.toastId) return;
    altRef.current = server;
    setToast({ ...cur, alt: server.matchedPhrase ?? server.intent.toLowerCase().replace(/_/g, ' ') });
  }, [deliver, setPreview, setToast]);

  /** The Whisper check failed: a gate waiting on it stops waiting (null = no Whisper result). */
  const gateGiveUp = (t: Turn) => { if (t.gate === 'waiting' && t.gateResolve) { const r = t.gateResolve; t.gateResolve = null; r(null); } };

  /** Upload the recognizer's parallel recording to Whisper (background). Deletes the file. */
  const startCheck = useCallback((id: number) => {
    const t = turnRef.current;
    if (!t || t.id !== id) return;
    if (t.handled) t.check?.ready(); // a stream answer that came in before the phone's final goes now
    if (t.checkStarted || !t.audioUri || !t.wantCheck) return;
    t.checkStarted = true;
    const uri = t.audioUri;
    // The streamed /end already answered (or the gate used Whisper): no second upload, just drop the file.
    if (t.check && !t.check.needWav) { try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* best effort */ } return; }
    void (async () => {
      let b64 = '';
      const file = new File(uri);
      try { b64 = await file.base64(); } catch { /* unreadable */ } finally { try { if (file.exists) file.delete(); } catch { /* best effort */ } }
      if (!b64) { setLive((l) => (l ? { ...l, checking: false } : l)); gateGiveUp(t); return; }
      try {
        const server = await getSttProvider().command(b64, 'audio/wav', t.ctx, turnExtras(t, 'device+check', { skipTts: true }));
        if (t.check) t.check.wav(server); else onCheck(id, server);
      } catch {
        // The device result stands; the check is best-effort.
        setLive((l) => (l && current(id) ? { ...l, checking: false } : l));
        gateGiveUp(t);
      }
    })();
  }, [onCheck]);

  /**
   * v1.4.5 spoken yes / no: answers the screen's open voice question (voiceAsk: "Pay ₹80,000 now? Say yes to pay.")
   * or the Confirm card that was open when the dealer pressed the mic. A "yes" runs the same code path as the button.
   * Never on an OTP turn. Returns true when the turn was an answer (nothing else to do).
   */
  const answerTurn = useCallback((id: number, text: string): boolean => {
    const t = turnRef.current;
    if (!t || t.id !== id || t.otp) return false;
    const done = (note: string) => {
      t.stage = 'confirmed';
      setThinking(false); setListening(false); setInfo(null);
      const said = parseResponse({ transcript: text, confidence: 1, intent: note.endsWith('yes') ? 'VOICE_YES' : 'VOICE_NO', score: 1, status: 'ok', engine: 'device', method: 'yes_no' });
      voiceMetrics.tag(t.metric, { note }); voiceMetrics.end(t.metric, { outcome: 'answered' }); logDelivered(t, said, 'device', true);
    };
    const a = answerPending(text, undefined, isAdvancePhrase);
    if (a) {
      done(`voice-${a}`);
      haptic.select();
      if (a === 'no') voiceRespond({ text: 'Okay, cancelled.', cue: cueKindFor({ kind: 'cancelled' }) });
      return true;
    }
    const p = t.prevPreview;
    if (!p || p.plan.kind === 'none' || p.plan.kind === 'blocked' || (p.command.status ?? 'ok') !== 'ok') return false;
    // v1.4.5 S2.2: "go ahead" / "proceed" press the current step; they never confirm an open card (Go home…).
    if (isAdvancePhrase(text)) return false;
    const yn = parseYesNo(text);
    if (!yn) return false;
    t.prevPreview = null;
    done(`card-${yn}`);
    if (yn === 'yes') runConfirmed(p.command);
    else voiceRespond({ text: 'Okay, cancelled.', cue: cueKindFor({ kind: 'cancelled' }) });
    return true;
  }, [runConfirmed]);

  /**
   * Device / typed text → server text path (slots, numbers, OTP, options) or the local matcher.
   * `local`: the already computed local reading. `guard` (confidence gate, shaky phone text and no usable
   * Whisper): the server's text reading may act on its own only when it is itself sure (status ok and
   * score ≥ WHISPER_DISAGREE_MIN); anything weaker becomes a one-tap "Did you mean …?" / say again.
   */
  const handleText = useCallback(async (id: number, text: string, confidence: number, via: 'device' | 'typed', opts: { local?: CommandResponse; guard?: boolean } = {}) => {
    const t = turnRef.current;
    if (!t || t.id !== id) return;
    const ctx = t.ctx;
    if (via === 'typed' && answerTurn(id, text)) return;
    // v1.4.5 OTP turn, local first: a digit-only utterance is read on the phone (works offline, the code never
    // leaves the phone). Exactly 6 digits → fill (Esign: fill + verify, see deliver); any other count → masked
    // "Say all 6 digits or type them.". A sentence (not digits) still asks the server as before.
    if (t.otp) {
      const plan = planOtpTurn(text);
      if (plan.kind === 'local') {
        voiceMetrics.tag(t.metric, { note: 'otp:local' });
        deliver(id, plan.command, { path: via === 'typed' ? 'device+text' : 'device', matcher: 'keyword' });
        return;
      }
    }
    // v1.4.5 S2.2: "proceed" / "aage chaliye" / "submit" on a destructive step is decided on the phone at once
    // (exact grammar, same as the server's advance.py): voice advances immediately, offline too.
    if (!t.otp) {
      const adv = resolveAdvance(text, getVoiceStep(ctx.screen));
      if (adv) { voiceMetrics.tag(t.metric, { note: 'advance:local' }); deliver(id, adv, { path: via === 'typed' ? 'device+text' : 'device', matcher: 'keyword' }); return; }
    }
    const local = opts.local ?? localCommand(text, matchCommand(text), confidence);
    const matcher = (local.matcher === 'keyword' ? 'keyword' : local.matcher === 'fuzzy' ? 'fuzzy' : 'none') as TurnMatcher;
    const serverText = needsServerText(text, ctx) || local.status === 'retry';
    if (!serverText) {
      // v1.4.2: a plain local "Did you mean" (no negation / question / vehicle guard) also asks the server's
      // text path (LaBSE + cues on the full sentence, ~15–100 ms). Its answer replaces the local one only when
      // it is auto (sure, not destructive) and arrives within CONFIRM_SERVER_BUDGET_MS; otherwise the local
      // "Did you mean" stands. Never for OTP / expected fields (those already went to the server above).
      // The confidence gate is not weakened: shaky phone text never reaches here unguarded (the gate delivers
      // its own result, or calls back with guard: true, which skips this ask).
      const match = matchCommand(text);
      if (!opts.guard && shouldAskServerOnConfirm(match)) {
        const server = await serverOverConfirm(local, match, () => getSttProvider().text(text, ctx, turnExtras(t, 'device+text', { skipTts: true })), { guard: opts.guard });
        if (!current(id)) return;
        if (server) {
          deliver(id, server, { path: 'device+text', matcher: server.matcher === 'labse' || server.method === 'semantic' ? 'labse' : 'server' });
          return;
        }
      }
      if (offlineVerdict(local, voiceRoutes.allDown()) === 'no_connection') { noConnection(id); return; }
      deliver(id, local, { path: via === 'typed' ? 'device+text' : 'device', matcher });
      return;
    }
    setThinking(true);
    // fix-xtreme-select: the phone's own reading of the on-screen chips (never for an expected field / OTP).
    // The server stays first; a FULL chip match only stops a dead tunnel from holding the turn (serverOrOption),
    // and any chip answer is the offline fallback below. Shaky text (guard) never auto-acts on it.
    // v1.4.5: also the screen's numeric fields (loan amount on Asset, TA repay) and customer rows (resolveOnPhone).
    const option = ctx.expect && ctx.expect !== 'amount' && ctx.expect !== 'reg' ? null : resolveOnPhone(text, ctx, confidence);
    const ask = () => getSttProvider().text(text, ctx, turnExtras(t, 'server', { skipTts: true }));
    try {
      const got = await serverOrOption(ask, opts.guard ? null : option);
      if (!current(id)) return;
      if (got.from === 'option') {
        voiceMetrics.tag(t.metric, { note: 'option:server-late' });
        deliver(id, got.cmd, { path: 'device', matcher: 'keyword' });
        return;
      }
      const cmd = got.cmd;
      // A weak server guess on a phrase the phone matched better: keep the local reading.
      // Never over a field answer (a loan amount clamp / repay "How much?" is a clarify / retry on purpose).
      const useLocal = local.status !== 'retry' && (cmd.status ?? 'ok') !== 'ok' && !(cmd.normalizedFields?.length) && !isFieldAnswer(cmd);
      // v1.4.5: an amount never navigates and "pay …" is never the mandate, whatever an older server says.
      const chosen = guardAnswer(useLocal ? local : cmd, text, ctx);
      const sure = (chosen.status ?? 'ok') === 'ok' && chosen.score >= WHISPER_DISAGREE_MIN;
      deliver(id, opts.guard && !sure ? downgradeCommand(chosen) : chosen, { path: 'device+text', matcher: useLocal ? matcher : cmd.matcher === 'labse' || cmd.method === 'semantic' ? 'labse' : 'server' });
    } catch (e) {
      if (!current(id)) return;
      // Server unreachable: the on-device reading still works for plain commands (never for numbers / OTP).
      // On a screen with chips the phone resolves them itself ("extreme 125 r" → Xtreme 125R) instead of
      // "Sorry, say that again" (fix-xtreme-select).
      if (!ctx.expect || ctx.expect === 'amount' || ctx.expect === 'reg') {
        const off = offlineReading(local, option);
        if (off === option) voiceMetrics.tag(t.metric, { note: 'option:offline' });
        // v1.4.5: no route at all and nothing sure on the phone → "No connection" instead of a fuzzy guess.
        if (offlineVerdict(off, voiceRoutes.allDown() && routeFailureKind(e) !== 'app') === 'no_connection') { noConnection(id); return; }
        deliver(id, off === option && opts.guard ? optionAsConfirm(off) : off, { path: 'device', matcher: off === option ? 'keyword' : matcher });
      } else if (t.otp) {
        // OTP turn, server unreachable: masked "Say all 6 digits or type them." (a digit-free plain command still works).
        voiceMetrics.tag(t.metric, { note: 'otp:offline' });
        deliver(id, otpOfflineCommand(text, local), { path: 'device', matcher });
      } else fail(id, e);
    }
  }, [deliver, fail, noConnection, answerTurn]);

  /**
   * The recognizer's final text for turn `id`. `rawConfidence` is the recogniser's own value (-1 / 0 =
   * unknown on Android; 0.5 = built from the last partial). v1.4.2 confidence gate: a confident result acts at
   * once (as before); a shaky one waits for Whisper (≤ WHISPER_WAIT_MS after release) or, with no audio copy,
   * becomes a one-tap "Did you mean …?". Slots / numbers / OTP / on-screen options keep the server text path.
   */
  const onDeviceFinal = useCallback((id: number, raw: string, rawConfidence: number) => {
    const t = turnRef.current;
    if (!t || t.id !== id || t.handled) return;
    t.handled = true;
    clearTurnTimers(t);
    releaseParallel(t);
    const text = raw.trim();
    setListening(false);
    if (!t.released) { t.released = true; voiceMetrics.mark(t.metric, 'release'); } // hands-free: end-of-speech
    if (!text) { fail(id, new VoiceError('no_speech')); return; }
    deviceFails.current = 0;
    voiceMetrics.mark(t.metric, 'finalText');
    setLive({ text: t.otp ? otpMaskFor(text) : text, final: true, checking: t.wantCheck, source: 'device', turn: id });
    // The second check is best-effort: never leave "checking" up if the audio or Whisper never answers.
    if (t.wantCheck) t.timers.push(setTimeout(() => setLive((l) => (l && current(id) ? { ...l, checking: false } : l)), 8000));
    const conf = normalizeAsrConfidence(rawConfidence, Platform.OS);
    noteDeviceText(t, text, conf);
    if (answerTurn(id, text)) return;
    // The matcher saw 0.8 for "unknown" before v1.4.2; keep that so its behaviour is unchanged.
    const matcherConf = conf ?? 0.8;
    if (needsServerText(text, t.ctx)) {
      // Slots / numbers / OTP / options: the server's text path decides (OTP never auto-verifies anyway). Not gated.
      updateAsrDiag({ gate: 'not gated (server text)' });
      void handleText(id, text, matcherConf, 'device');
      startCheck(id);
      return;
    }
    const local = localCommand(text, matchCommand(text), matcherConf);
    const matcher = (local.matcher === 'keyword' ? 'keyword' : local.matcher === 'fuzzy' ? 'fuzzy' : 'none') as TurnMatcher;
    const a = assessDeviceResult({
      text, confidence: conf, local: { status: local.status, score: local.score, band: local.confidenceBand }, partials: t.partials, heardSpeech: true,
    });
    if (!a.shaky) {
      t.gate = 'done';
      updateAsrDiag({ gate: gateDiagText({ decision: 'confident' }) });
      voiceMetrics.tag(t.metric, { note: 'gate:confident' });
      void handleText(id, text, matcherConf, 'device', { local });
      startCheck(id);
      return;
    }
    // Shaky: don't act yet. The pill keeps the draft text with the "checking" dot; the Whisper check starts now
    // if the audio file already exists (else onAudio starts it, since the turn is handled).
    t.gate = 'waiting';
    setThinking(true);
    const whisper = t.wantCheck ? new Promise<CommandResponse | null>((res) => { t.gateResolve = res; }) : null;
    startCheck(id);
    const releasedAt = releaseTime(t);
    // With chunked streaming (voice-stream / DA-30), Whisper's result is ready at release, so the shaky path
    // costs ~0 ms instead of up to 600 ms; the streaming client registers its result in earlyWhisper.ts and it
    // races the WAV check here (first usable wins).
    const early = getEarlyWhisper({ id, ctx: t.ctx, releasedAt });
    void runGate({ shaky: true, wantCheck: t.wantCheck, device: local, releasedAt, now, whisper, early }).then((g) => {
      if (!current(id) || turnRef.current !== t) return;
      t.gate = 'done';
      t.gateResolve = null;
      voiceMetrics.mark(t.metric, 'gate');
      // Phone had no match and no usable Whisper: today's server /text fallback, guarded (see handleText).
      const retryText = g.downgraded && local.status === 'retry';
      updateAsrDiag({ gate: gateDiagText({ decision: g.decision, waitedMs: g.waitedMs, reasons: a.reasons, confidence: conf, retryText }) });
      voiceMetrics.tag(t.metric, { note: `gate:${g.decision}` });
      if (g.use === 'whisper') {
        t.check?.settle(); // the gate used Whisper's answer (stream or WAV): a later one must not reconcile again
        deliver(id, g.command, { path: 'server', matcher: g.command.matcher === 'labse' || g.command.method === 'semantic' ? 'labse' : 'server' });
        return;
      }
      if (retryText) { void handleText(id, text, matcherConf, 'device', { local, guard: true }); return; }
      if (offlineVerdict(g.command, voiceRoutes.allDown()) === 'no_connection') { noConnection(id); return; }
      deliver(id, g.command, { path: 'device', matcher });
    });
  }, [fail, noConnection, handleText, startCheck, deliver, answerTurn]);

  /** Server path: record → POST /command (skipTts) → deliver. */
  const sendRecording = useCallback(async (id: number) => {
    try {
      const t0 = turnRef.current;
      let r = t0?.id === id && t0.streamed ? await pcm.stop() : await ptt.pressOut();
      if (r?.kind === 'fallback') r = await ptt.pressOut(); // live capture never started: this turn used the recorder
      if (!r || !current(id)) return;
      const t = turnRef.current!;
      if (r.kind === 'too_short') { setListening(false); setLive(null); setError('Hold the mic while you speak, then let go.'); voiceMetrics.end(t.metric, { outcome: 'too_short' }); logTurnEnd(t, 'too_short'); return; }
      if (r.kind === 'permission_prompted') { setListening(false); setLive(null); setInfo('Microphone is on. Hold the mic and say a command.'); voiceMetrics.end(t.metric, { outcome: 'prompted' }); logTurnEnd(t, 'prompted'); return; }
      setListening(false);
      setThinking(true);
      setLive({ text: r.kind === 'stream' && t.partial ? liveTextFromPartial({ text: t.partial }, t.otp) : '', final: true, checking: true, source: 'server', turn: id });
      let command: CommandResponse;
      if (r.kind === 'stream') {
        const p = r.finish(t.ctx, turnExtras(t, 'stream', { skipTts: true }));
        streams.set(id, p.then((c) => (c.transcript.trim() ? c : null))); // early-Whisper source, for consistency
        command = await p;
      } else command = await getSttProvider().command(r.base64, r.mimeType, t.ctx, turnExtras(t, 'server', { skipTts: true }));
      if (!current(id)) return;
      if (!isOtpCommand(command) && command.transcript.trim() && answerTurn(id, command.transcript)) { setLive(null); return; }
      voiceMetrics.mark(t.metric, 'finalText');
      setLive(command.transcript.trim() ? { text: isOtpCommand(command) || t.otp ? maskOtp(6) : command.transcript, final: true, checking: false, source: 'server', turn: id } : null);
      deliver(id, command, { path: 'server', matcher: command.matcher === 'labse' || command.method === 'semantic' ? 'labse' : 'server' });
    } catch (e) {
      fail(id, e);
    } finally {
      if (current(id)) setThinking(false);
    }
  }, [ptt.pressOut, pcm.stop, deliver, fail, answerTurn]);

  /** Start a turn (press-in, or a hands-free tap). Visual state flips synchronously — before permissions resolve. */
  const beginTurn = useCallback((pressedAt: number = now()) => {
    // v1.4.5: pressing while Zippy reads out stops the read-out and listens (barge-in), never a recording disc
    // that isn't listening. Short bundled clips / cues were always interruptible.
    const bargeIn = pressAction({ readingOut: isReadingOut() }) === 'stop_readout_then_listen';
    void stopSpeaking();
    const prev = turnRef.current;
    if (prev) {
      clearTurnTimers(prev); prev.asr?.abort(); dropParallel(prev);
      const why = prevTurnEndReason({ handled: prev.handled, released: prev.released, asrEnded: !!prev.asrEnded });
      if (why) logTurnEnd(prev, why);
    }
    const id = ++req.current;
    const s = getVoiceSettings();
    let ctx = currentCommandContext();
    // v1.4.5 TA "How much?": the next turn on the same screen is sent as expect 'amount' (≤ 60 s).
    const ask = expectNextRef.current;
    expectNextRef.current = null;
    if (ask && !ctx.expect && ask.screen === ctx.screen && Date.now() - ask.at < 60_000) ctx = { ...ctx, expect: ask.expect };
    const lang = recognizerLang(s.locale);
    const sup = deviceAsrSupport(lang);
    const why = explainAsrPath({ platform: Platform.OS, flagOn: s.onDeviceAsr, moduleLoaded: sup.moduleLoaded, recognitionAvailable: sup.available, disabledThisSession: deviceOff.current, disabledBy: deviceOffBy.current });
    const path = why.path; resetAsrTurn(path, why.reason);
    const otp = ctx.expect === 'otp';
    const metric = voiceMetrics.start({ mode: s.mode, path: path === 'device' ? 'device' : 'server' }, pressedAt);
    if (bargeIn) voiceMetrics.tag(metric, { note: 'barge-in' });
    const t: Turn = {
      id, metric, mode: s.mode, path, ctx, otp, pressedAt, released: false, asr: null, partial: '', handled: false, result: null, stage: 'nothing',
      toastId: null, audioUri: null, checkStarted: false, wantCheck: path === 'device' && !otp && sup.canRecord, timers: [],
      partials: [], gate: 'none', gateResolve: null, prevPreview: previewRef.current,
    };
    if (path === 'device') t.check = new TurnCheck((r) => onCheck(id, r));
    turnRef.current = t;
    setError(null); setInfo(null); setPreview(null); setThinking(false);
    setListening(true);
    setLive({ text: '', final: false, checking: false, source: path === 'device' ? 'device' : 'server', turn: id });

    if (path === 'server') {
      const onEndpoint = s.mode === 'handsfree' ? (d: 'end' | 'no_speech' | 'max') => {
        if (!current(id) || t.released) return;
        if (d === 'no_speech') { void ptt.cancel(); void pcm.cancel(); setListening(false); setLive(null); setError(voiceErrorMessage(new VoiceError('no_speech'))); voiceMetrics.end(metric, { outcome: 'no_speech' }); logTurnEnd(t, 'no_speech'); return; }
        t.released = true;
        voiceMetrics.mark(metric, 'release');
        void sendRecording(id);
      } : undefined;
      if (s.serverStream && pcm.available) {
        // v1.4.2: stream live PCM; the server's partial words show while the dealer speaks (same pill as the device path).
        t.streamed = true;
        voiceMetrics.tag(metric, { note: 'stream' });
        pcm.begin({
          ctx, languageCode: s.locale === 'auto' ? undefined : recognizerLang(s.locale), onEndpoint, extras: turnExtras(t, 'stream'),
          onPartial: (p) => {
            if (!current(id) || t.handled || !p.text.trim()) return;
            if (!t.partial) voiceMetrics.mark(metric, 'firstPartial');
            t.partial = p.text;
            setLive({ text: liveTextFromPartial(p, t.otp), final: t.released, checking: t.released, source: 'server', turn: id });
          },
          onCaptureFailed: () => { if (current(id)) { t.streamed = false; ptt.pressIn(onEndpoint); } },
        });
        return;
      }
      ptt.pressIn(onEndpoint);
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
          deviceOff.current = true; deviceOffBy.current = 'permission';
          updateAsrDiag({ lastError: 'not-allowed' });
          setListening(false); setLive(null);
          setInfo('Using the voice server. Hold the mic again to talk.');
          voiceMetrics.end(metric, { outcome: 'permission' });
          logTurnEnd(t, 'permission');
          return;
        }
        if (t.mode === 'ptt') {
          // The OS prompt stole the touch; the next hold records.
          setListening(false); setLive(null);
          setInfo('Microphone is on. Hold the mic and say a command.');
          voiceMetrics.end(metric, { outcome: 'prompted' });
          logTurnEnd(t, 'prompted');
          return;
        }
      }
      // v1.4.5: the previous recogniser session must emit its 'end' first (≤ 400 ms), so its late 'end' can
      // never end this one (asrSession.ts). Listeners are registered only after this wait.
      const prep = await prepareDeviceAsr();
      if (!current(id)) return;
      if (prep.hadOpen) voiceMetrics.tag(metric, { note: prep.timedOut ? 'asr:prev-end-timeout' : `asr:prev-end-${Math.round(prep.waitedMs)}ms` });
      if (t.mode === 'ptt' && t.released) {
        // Let go before the recognizer started.
        setListening(false); setLive(null);
        setError('Hold the mic while you speak, then let go.');
        voiceMetrics.end(metric, { outcome: 'too_short' });
        logTurnEnd(t, 'too_short');
        return;
      }
      const names = getVoiceOptions(ctx.screen).map((o) => o.label);
      const startedAt = now();
      /** One recogniser session (called again for a transparent restart: same turn, partial text kept). */
      const launch = (): DeviceAsrHandle | null => startDeviceAsr({
        locale: s.locale,
        contextualStrings: contextualStrings(names),
        persistAudio: t.wantCheck,
        preferOnDevice: true,
        onPartial: (text) => {
          if (!current(id) || t.handled) return;
          t.partial = text;
          if (t.partials[t.partials.length - 1] !== text) { t.partials.push(text); if (t.partials.length > MAX_PARTIALS) t.partials.shift(); }
          countAsrPartial(now());
          setLive({ text: t.otp ? otpMaskFor(text) : text, final: false, checking: false, source: 'device', turn: id });
        },
        onSpeechEnd: () => { if (current(id) && t.mode === 'handsfree' && !t.released) { t.released = true; voiceMetrics.mark(metric, 'release'); releaseParallel(t); } },
        onFinal: (text, conf) => onDeviceFinal(id, text, conf),
        onAudio: (uri) => {
          if (turnRef.current?.id !== id) { try { new File(uri).delete(); } catch { /* ignore */ } return; }
          if (t.audioUri && t.audioUri !== uri && !t.checkStarted) { try { new File(t.audioUri).delete(); } catch { /* ignore */ } } // restarted session: keep the newest copy
          t.audioUri = uri;
          if (t.handled) startCheck(id);
        },
        onError: (code, _msg, info) => {
          if (!current(id) || t.handled) return;
          updateAsrDiag({ service: info.service, onDevice: info.onDeviceRequested, persist: info.persistRequested, lastError: code });
          if (t.par && !t.par.released && isParallelClash(code, now() - t.par.startedAt)) {
            // Most likely the parallel PCM capture took the mic: turn that off for the session, not the recogniser
            // or its audio copy (no drop_persist, no failure count). The dealer just tries again.
            dropParallel(t); markParallelBroken('recogniser_error'); parallelOff('recogniser_error');
            t.handled = true; clearTurnTimers(t); setListening(false); setLive(null);
            setInfo('Couldn’t hear that clearly. Hold the mic and try again.');
            voiceMetrics.end(metric, { outcome: 'asr_parallel' });
            logTurnEnd(t, 'asr_parallel');
            return;
          }
          const kind = classifyAsrError(code, info);
          // v1.4.5: finger still down — the recogniser's "no speech" is a self-end: onEnd restarts it once,
          // transparently (parallel capture, timers and the listening state stay as they are).
          if (kind === 'no_speech' && selfEndAction({ mode: t.mode, released: t.released, handled: false, restarts: t.restarts ?? 0, partial: t.partial }) === 'restart') return;
          dropParallel(t);
          if (kind === 'cancelled') return;
          t.handled = true;
          clearTurnTimers(t);
          setListening(false);
          if (kind === 'no_speech') { setLive(null); setError(voiceErrorMessage(new VoiceError('no_speech'))); voiceMetrics.end(metric, { outcome: 'no_speech' }); logTurnEnd(t, 'no_speech'); return; }
          if (kind === 'retry_network' || kind === 'drop_persist') {
            // On-device model missing / audio copy refused: next turn uses the network recognizer / no copy. Not a failure.
            if (kind === 'retry_network') markOnDeviceBroken(recognizerLang(s.locale)); else markPersistBroken();
            setLive(null);
            setInfo('Couldn’t hear that clearly. Hold the mic and try again.');
            voiceMetrics.end(metric, { outcome: `asr_${kind}` });
            logTurnEnd(t, `asr_${kind}`);
            return;
          }
          if (kind === 'permission') { deviceOff.current = true; deviceOffBy.current = 'permission'; }
          else if (kind === 'disable' || ++deviceFails.current >= MAX_DEVICE_FAILURES) { deviceOff.current = true; deviceOffBy.current = 'error'; }
          setLive(null);
          setInfo(deviceOff.current ? 'Phone speech recognition isn’t available here. Using the voice server — hold the mic again.' : 'Couldn’t hear that clearly. Hold the mic and try again.');
          voiceMetrics.end(metric, { outcome: `asr_${kind}` });
          logTurnEnd(t, `asr_${kind}`);
        },
        onStart: () => { t.asrEnded = false; },
        onEnd: () => {
          t.asrEnded = true;
          if (!current(id) || t.handled) return;
          const act = selfEndAction({ mode: t.mode, released: t.released, handled: t.handled, restarts: t.restarts ?? 0, partial: t.partial });
          if (act === 'ignore') return; // released: the final / FINAL_GRACE_MS timer decides
          if (act === 'finalize') { onDeviceFinal(id, t.partial, 0.5); return; }
          if (act === 'restart') {
            // v1.4.5: ended by itself while the finger is still down → start again, transparently (listening stays on).
            t.restarts = (t.restarts ?? 0) + 1;
            voiceMetrics.tag(metric, { note: 'asr:restart' });
            const h = launch();
            if (h) { t.asr = h; t.asrEnded = false; return; }
            if (t.handled || !current(id)) return; // start() failed: onError already told the dealer
          }
          // Gave up: a clear message, never a silent recording disc.
          t.handled = true;
          clearTurnTimers(t);
          dropParallel(t);
          setListening(false); setLive(null);
          if (t.mode === 'ptt') { setInfo(DIDNT_CATCH); haptic.error(); voiceMetrics.end(metric, { outcome: 'asr_ended' }); logTurnEnd(t, 'asr_ended'); return; }
          setError(voiceErrorMessage(new VoiceError('no_speech'))); voiceMetrics.end(metric, { outcome: 'no_speech' }); logTurnEnd(t, 'no_speech');
        },
      });
      t.asr = launch();
      // start() threw: onError already classified it (e.g. drop_persist). Only a missing module disables here.
      if (!t.asr) { if (!t.handled) { deviceOff.current = true; deviceOffBy.current = 'error'; } return; }
      markAsrStarted({ service: t.asr.info.service, onDevice: t.asr.info.onDeviceRequested, persist: t.asr.info.persistRequested }, startedAt);
      // v1.4.2 voice.parallelStream (default off): also stream PCM to Whisper so a shaky result has Whisper's answer
      // at release. Started after the recogniser so it gets the mic first; partials are not shown; never on OTP.
      if (wantParallelStream({ path: 'device', settingOn: s.parallelStream, otp, pcmAvailable: pcmRef.current.available })) {
        t.par = { startedAt: now(), released: false };
        updateAsrDiag({ parallel: parallelDiagText('on') });
        pcmRef.current.begin({
          ctx, languageCode: s.locale === 'auto' ? undefined : lang, parallel: true, extras: turnExtras(t, 'device+check'), onPartial: () => {},
          // release / drop still calls pcm.stop() / cancel() (clears its pending start); stop() then yields 'fallback' → null
          onCaptureFailed: () => { markParallelBroken('capture_failed'); parallelOff('capture_failed'); },
        });
      } else if (s.parallelStream && !otp && isParallelBroken()) updateAsrDiag({ parallel: parallelDiagText('paused') });
      // Cap: 15 s, same as letting go (so the cap is never mistaken for a self-end). Hands-free otherwise ends
      // at the recognizer's end-of-speech.
      t.timers.push(setTimeout(() => { if (current(id) && !t.handled) endInputRef.current(); }, PTT_MAX_HOLD_MS));
    })();
  }, [ptt.pressIn, ptt.cancel, pcm.begin, pcm.cancel, pcm.available, sendRecording, onDeviceFinal, startCheck, onCheck, setPreview]);

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
      dropParallel(t);
      setListening(false); setLive(null);
      setError('Hold the mic while you speak, then let go.');
      voiceMetrics.end(t.metric, { outcome: 'too_short' });
      logTurnEnd(t, 'too_short');
      return;
    }
    // Show what was heard right away; the recognizer's final result replaces it in a moment.
    setListening(false);
    if (t.partial) { voiceMetrics.mark(t.metric, 'finalText'); setLive({ text: t.otp ? otpMaskFor(t.partial) : t.partial, final: true, checking: true, source: 'device', turn: t.id }); }
    releaseParallel(t); // finish() now, so Whisper's answer is ready by the time the gate asks
    t.asr.stop();
    const id = t.id;
    t.timers.push(setTimeout(() => { if (current(id) && !t.handled) onDeviceFinal(id, t.partial, 0.5); }, FINAL_GRACE_MS));
  }, [sendRecording, onDeviceFinal]);

  endInputRef.current = endInput;

  /** Cancel any recording / request in flight, drop the preview and stop speech. */
  const abort = useCallback((outcome: string = 'cancelled') => {
    const t = turnRef.current;
    req.current += 1;
    if (t) { clearTurnTimers(t); t.asr?.abort(); if (!t.handled || t.stage === 'nothing') voiceMetrics.end(t.metric, { outcome }); logTurnEnd(t, outcome); }
    void ptt.cancel();
    void pcm.cancel();
    void stopSpeaking();
    setThinking(false); setListening(false); setLive(null); setError(null); setInfo(null); setPreview(null);
  }, [ptt.cancel, pcm.cancel, setPreview]);

  /**
   * v1.4.2 double-tap: drop the turn the first tap started WITHOUT side effects — no delivery (every async step
   * checks `current(id)`, which this bumps), no banner / hint / cue / read-out, metric outcome 'double_tap'
   * (never counted as a success). Returns the dropped turn id so the live transcript can forget its line.
   */
  const discard = useCallback((): number | null => {
    const t = turnRef.current;
    const id = t && t.id === req.current && t.stage === 'nothing' && !t.result ? t.id : null;
    if (id === null) return null; // nothing in flight: leave an earlier result / toast alone
    abort('double_tap');
    return id;
  }, [abort]);

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
    if (isTurnLive() || ptt.phase !== 'idle' || pcm.phase !== 'idle') {
      abort();
      setInfo('Okay, cancelled.');
      voiceRespond({ text: 'Okay, cancelled.', cue: cueKindFor({ kind: 'cancelled' }) });
      return;
    }
    beginTurn(at);
  }, [beginTurn, abort, ptt.phase, pcm.phase]);

  // Auto-stop at the max hold length behaves like letting go.
  ptt.onAutoStop.current = () => { endInput(); };
  pcm.onAutoStop.current = () => { endInput(); };

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
    if (t) { t.stage = 'gone'; logTurnOutcome(t, 'dropped', 'dismissed'); }
    voiceRespond({ text: 'Okay, cancelled.', cue: cueKindFor({ kind: 'cancelled' }) });
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
    const ctx = currentCommandContext();
    const otp = ctx.expect === 'otp';
    turnRef.current = {
      id, metric, mode: getVoiceSettings().mode, path: 'device', ctx, otp, pressedAt: now(), released: true, asr: null, partial: '',
      handled: true, result: null, stage: 'nothing', toastId: null, audioUri: null, checkStarted: false, wantCheck: false, timers: [],
      partials: [], gate: 'none', gateResolve: null,
    };
    voiceMetrics.mark(metric, 'release');
    voiceMetrics.mark(metric, 'finalText');
    setLive({ text: otp ? otpMaskFor(clean) : clean, final: true, checking: false, source: 'typed', turn: id });
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

  const phase: VoiceUiPhase = listening || ptt.phase !== 'idle' || pcm.phase !== 'idle' ? 'listening' : thinking ? 'thinking' : 'idle';

  return {
    phase, live, error, info, preview, toast, undo, chooseAlt, dismissToast, pressIn, pressOut, tap, confirm, cancel, choose, editField, editTranscript, sayAgain,
    abort, discard, stagePreview,
  };
}
