import { navRef } from '../navigation/navRef';
import type { CommandContext } from './types';
import { expectFor } from './voiceLogic';
import { getVoiceOptions } from './voiceOptions';

function makeId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) { try { return c.randomUUID(); } catch { /* fall through */ } }
  const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${Date.now().toString(16)}-${r()}${r()}-${r()}${r()}`;
}

/**
 * Stable in-memory id for this app session (never persisted). Sent with every /command, /tts and
 * /tts/done so the server can track turns and whether Zippy is still speaking.
 */
export const VOICE_SESSION_ID: string = makeId();

/** sessionId + screen + expect + tappable options for the route the dealer is looking at right now. */
export function currentCommandContext(): CommandContext {
  const route = navRef.isReady() ? navRef.getCurrentRoute() : undefined;
  const name = route?.name;
  const expect = expectFor(name, route?.params);
  const options = getVoiceOptions(name);
  return {
    sessionId: VOICE_SESSION_ID,
    ...(name ? { screen: name, context: { route: name } } : {}),
    ...(expect ? { expect } : {}),
    ...(options.length ? { options } : {}),
  };
}
