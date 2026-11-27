/**
 * v1.4.2 app wiring for voice backtest logging (see voiceTurnLog.ts for the pure core and the rules).
 * useVoiceCommand.ts calls these with its Turn object; per-turn ids live in a WeakMap here so the hook's
 * Turn type is unchanged.
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import appJson from '../../app.json';
import { secureStorage } from '../utils/secureStorage';
import { isVoiceConfigured, voiceBase, voiceRoutes } from './config';
import { createLogQueue } from './voiceLogQueue';
import type { CommandExtras } from './sttClient';
import { VoiceError, type CommandContext, type CommandResponse } from './types';
import { isOtpCommand } from './voiceLogic';
import {
  createVoiceTurnLog, deliveredOutcome, failureOutcome, isOtpTurn, newTurnId, shouldAttachClip, turnEndRecord, type DeviceTurnRecord, type KeyValueStorage, type TurnLogPath,
} from './voiceTurnLog';

/**
 * v1.4.5 /log offline queue storage: a JSON file in the app's document directory (200 entries can exceed what the
 * keychain holds; the entries carry no audio and no OTP digits, see voiceLogQueue.ts). localStorage on web.
 */
const fileStorage: KeyValueStorage = {
  async get(key) {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    const f = new File(Paths.document, `${key}.json`);
    return f.exists ? await f.text() : null;
  },
  async set(key, value) {
    if (Platform.OS === 'web') { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); return; }
    const f = new File(Paths.document, `${key}.json`);
    if (!f.exists) f.create();
    f.write(value);
  },
};

export const voiceLogQueue = createLogQueue({ storage: fileStorage });

export const voiceTurnLog = createVoiceTurnLog({
  fetch: (url, init) => fetch(url, init),
  storage: secureStorage,
  baseUrl: () => (isVoiceConfigured() ? voiceBase() : ''),
  platform: Platform.OS,
  appVersion: String((appJson as { expo?: { version?: string } }).expo?.version ?? ''),
  queue: voiceLogQueue,
  report: (base, outcome) => voiceRoutes.report(base, outcome),
});
// Load the hashed install id early so the first request already carries it.
void voiceTurnLog.deviceIdHash();

// v1.4.5 routes: cached + fetched route list at app start, then resend any queued /log posts; again on recovery.
voiceRoutes.onRecover(() => { void voiceTurnLog.flushQueue(); });
if (isVoiceConfigured()) {
  void voiceRoutes.start(secureStorage).catch(() => {}).then(() => voiceTurnLog.flushQueue()).catch(() => {});
}

/** The parts of useVoiceCommand's Turn this module reads. */
type TurnLike = {
  ctx: CommandContext;
  otp: boolean;
  audioUri: string | null;
  wantCheck: boolean;
  /** 'server' = record → /command turn; anything else is the phone recogniser path. */
  path?: string;
  /** Last live partial from the phone recogniser. */
  partial?: string;
  checkStarted?: boolean;
  /** v1.4.3: server-path turn that streamed live PCM (/stream/{id}/…) instead of the whole-clip /command. */
  streamed?: boolean;
};

/** `ended`: the turn's terminal /log line (delivered, dropped or error) was sent; later drop/error calls are no-ops. */
/** `serverAsked`: a server request (/command, /text, /stream) carried this turnId, so the server has its own line. */
type TurnInfo = { turnId: string; deviceText?: string; deviceConfidence?: number; ended?: boolean; serverAsked?: boolean };
const info = new WeakMap<object, TurnInfo>();

function infoFor(t: object): TurnInfo {
  let i = info.get(t);
  if (!i) { i = { turnId: newTurnId() }; info.set(t, i); }
  return i;
}

const otpTurn = (t: TurnLike, cmd?: CommandResponse | null) =>
  t.otp || isOtpTurn({ expect: t.ctx.expect, screen: t.ctx.screen, route: t.ctx.context?.route }) || (!!cmd && isOtpCommand(cmd));

/** Remember the phone recogniser's final text for this turn (sent with later requests). */
export function noteDeviceText(t: TurnLike, text: string, confidence: number | null | undefined): void {
  const i = infoFor(t);
  i.deviceText = text;
  i.deviceConfidence = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : undefined;
}

/** Extras for /command, /text, /stream bodies. OTP turns never carry the device transcript. */
export function turnExtras(t: TurnLike, path: TurnLogPath, base: CommandExtras = {}): CommandExtras {
  const i = infoFor(t);
  i.serverAsked = true;
  const otp = otpTurn(t);
  return {
    ...base,
    ...voiceTurnLog.meta({ turnId: i.turnId, path }),
    ...(!otp && i.deviceText ? { deviceTranscript: i.deviceText } : {}),
    ...(!otp && i.deviceConfidence !== undefined ? { deviceConfidence: i.deviceConfidence } : {}),
  };
}

/**
 * A turn the device decided (no /command as the primary): fire-and-forget POST /log. When the Whisper check runs
 * it uploads the clip itself under the same turnId, so the clip is only attached here when no check will run.
 */
export function logDeviceTurn(t: TurnLike, cmd: CommandResponse, outcome?: string, reason?: string, path?: TurnLogPath): void {
  if (otpTurn(t, cmd)) return;
  const i = infoFor(t);
  i.ended = true;
  const uri = !t.wantCheck ? t.audioUri : null;
  void (async () => {
    let audioBase64: string | undefined;
    if (uri) { try { audioBase64 = await new File(uri).base64(); } catch { /* clip optional */ } }
    const rec: DeviceTurnRecord = {
      turnId: i.turnId,
      path: path ?? (t.wantCheck ? 'device+check' : 'device'),
      deviceTranscript: i.deviceText ?? cmd.transcript,
      ...(i.deviceConfidence !== undefined ? { deviceConfidence: i.deviceConfidence } : {}),
      transcript: cmd.transcript,
      intent: cmd.intent,
      score: cmd.score,
      ...(cmd.confidenceBand ? { band: cmd.confidenceBand } : {}),
      ...(cmd.matcher || cmd.method ? { method: cmd.matcher ?? cmd.method } : {}),
      ...(cmd.candidates?.length ? { candidates: cmd.candidates.map((c) => ({ intent: c.intent, score: c.score, phrase: c.phrase })) } : {}),
      ...(t.ctx.screen ? { screen: t.ctx.screen } : {}),
      ...(t.ctx.context?.route ? { context: { route: t.ctx.context.route } } : {}),
      ...(outcome ? { outcome } : {}),
      ...(reason ? { reason } : {}),
      ...(audioBase64 ? { audioBase64, mimeType: 'audio/wav' } : {}),
    };
    await voiceTurnLog.postDeviceTurn(rec);
  })().catch(() => {});
}

/**
 * A result was shown or applied (deliver()). `path` is how it was decided. Phone-decided turns get the full
 * device record; server-decided turns (/text, /command, Whisper gate) already have a server line under the same
 * turnId, so they get a cheap line with the outcome and the intent the phone actually acted on.
 */
export function logDelivered(t: TurnLike, cmd: CommandResponse, path: string, acted: boolean): void {
  const { outcome, reason } = deliveredOutcome(cmd, acted);
  if (path === 'device') { logDeviceTurn(t, cmd, outcome, reason); return; }
  // v1.4.3: decided on the phone with no server request under this turnId (typed text matched locally): full record.
  if (!infoFor(t).serverAsked) { logDeviceTurn(t, cmd, outcome, reason, path === 'device+text' ? 'device+text' : undefined); return; }
  if (otpTurn(t, cmd)) return;
  const i = infoFor(t);
  i.ended = true;
  void voiceTurnLog.postDeviceTurn({
    turnId: i.turnId, outcome, reason, intent: cmd.intent, score: cmd.score,
    ...(cmd.confidenceBand ? { band: cmd.confidenceBand } : {}),
  }).catch(() => {});
}

/**
 * The turn ended without a delivered result: dropped (too short, cancelled, permission, prompted) or error
 * (fail(): network / timeout / http / no speech; recogniser errors). `why` is a VoiceError, an Error, or a code
 * string. Posts what was heard (final text, else the last partial) and the clip when one exists and no Whisper
 * check has taken it. At most one such line per turn, and none after a delivered result.
 */
export function logTurnEnd(t: TurnLike, why: unknown): void {
  if (otpTurn(t)) return;
  const i = infoFor(t);
  if (i.ended) return;
  i.ended = true;
  const code = why instanceof VoiceError ? why.code : typeof why === 'string' ? why : 'error';
  const { outcome, reason } = failureOutcome(code);
  const uri = shouldAttachClip({ otp: t.otp, audioUri: t.audioUri, checkStarted: t.checkStarted }) ? t.audioUri : null;
  const path: TurnLogPath = t.path === 'server' ? (t.streamed ? 'stream' : 'server') : t.wantCheck ? 'device+check' : 'device';
  void (async () => {
    let audioBase64: string | undefined;
    if (uri) {
      const file = new File(uri);
      // No check will run for this turn, so the temp clip is not needed after this upload.
      try { audioBase64 = await file.base64(); } catch { /* clip optional */ } finally { try { if (file.exists) file.delete(); } catch { /* best effort */ } }
    }
    const rec = turnEndRecord({
      turnId: i.turnId, path, outcome, reason, otp: t.otp, expect: t.ctx.expect, deviceText: i.deviceText, deviceConfidence: i.deviceConfidence,
      partial: t.partial, screen: t.ctx.screen, route: t.ctx.context?.route, audioBase64,
    });
    if (rec) await voiceTurnLog.postDeviceTurn(rec);
  })().catch(() => {});
}

/** Cheap after-the-fact outcome (the dealer confirmed / dismissed a preview): a /log line with turnId + outcome + reason. */
export function logTurnOutcome(t: TurnLike, outcome: string, reason?: string): void {
  if (otpTurn(t)) return;
  void voiceTurnLog.postDeviceTurn({ turnId: infoFor(t).turnId, outcome, ...(reason ? { reason } : {}) }).catch(() => {});
}
