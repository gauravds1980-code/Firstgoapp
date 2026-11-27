/**
 * v1.4.2 non-verbal voice cues: which cue ends a turn, and spoken Piper replies off by default.
 * Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SPOKEN_REPLIES, cueKindFor, replyMode, shouldSpeakReplies } from '../voiceCues';

// voiceSettings.ts / piper.ts import react-native / expo-audio and cannot load under node: check their source.
const src = (f: string) => readFileSync(join(process.cwd(), 'src/voice', f), 'utf8');

test('voice.spokenReplies defaults to false and persists under firstgo.voice.spokenReplies', () => {
  assert.equal(DEFAULT_SPOKEN_REPLIES, false);
  const s = src('voiceSettings.ts');
  assert.match(s, /spokenReplies: DEFAULT_SPOKEN_REPLIES,/);
  assert.match(s, /spokenReplies: 'firstgo\.voice\.spokenReplies'/);
});

test('cueKindFor: acted / undone / cancelled / assistant → accepted', () => {
  assert.equal(cueKindFor({ didAct: true, status: 'ok' }), 'accepted');
  assert.equal(cueKindFor({ kind: 'acted' }), 'accepted');
  assert.equal(cueKindFor({ didAct: true, kind: 'acted', hasCandidates: true }), 'accepted'); // confirmed action
  assert.equal(cueKindFor({ kind: 'undone' }), 'accepted');
  assert.equal(cueKindFor({ kind: 'cancelled' }), 'accepted');
  assert.equal(cueKindFor({ kind: 'assistant' }), 'accepted');
});

test('cueKindFor: retry / reprompt / nothing / no match → notUnderstood', () => {
  assert.equal(cueKindFor({ kind: 'preview', status: 'retry', hasCandidates: false }), 'notUnderstood');
  assert.equal(cueKindFor({ kind: 'preview', status: 'reprompt' }), 'notUnderstood');
  assert.equal(cueKindFor({ kind: 'nothing', status: 'retry' }), 'notUnderstood');
  assert.equal(cueKindFor({ kind: 'nothing' }), 'notUnderstood');
  assert.equal(cueKindFor({ status: 'retry' }), 'notUnderstood');
});

test('cueKindFor: clarify / candidates / Did you mean / Confirm sheet → confirm', () => {
  assert.equal(cueKindFor({ kind: 'preview', status: 'clarify' }), 'confirm');
  assert.equal(cueKindFor({ kind: 'preview', status: 'retry', hasCandidates: true }), 'confirm'); // Did you mean
  assert.equal(cueKindFor({ kind: 'preview', status: 'reprompt', hasCandidates: true }), 'confirm');
  assert.equal(cueKindFor({ kind: 'preview', status: 'ok' }), 'confirm'); // ask-before-acting Confirm sheet
  assert.equal(cueKindFor({ kind: 'preview' }), 'confirm');
  assert.equal(cueKindFor({}), 'confirm');
});

test('shouldSpeakReplies / replyMode: speech (and /tts) only when the flag is on', () => {
  assert.equal(shouldSpeakReplies(false), false);
  assert.equal(shouldSpeakReplies(true), true);
  assert.equal(shouldSpeakReplies(DEFAULT_SPOKEN_REPLIES), false);
  assert.equal(replyMode(false), 'cue');
  assert.equal(replyMode(true), 'speech');
});

test('piper safety net: playReply and speak bail out before any clip or /tts when the flag is off', () => {
  const p = src('piper.ts');
  const guard = String.raw`\) \{\n {2}if \(!shouldSpeakReplies\(getVoiceSettings\(\)\.spokenReplies\)\) \{ cb\?\.onDone\?\.\(\); return; \}`;
  assert.match(p, new RegExp(String.raw`export async function playReply\([^\n]*` + guard));
  assert.match(p, new RegExp(String.raw`export async function speak\([\s\S]*?` + guard));
  assert.match(p, /export async function stopSpeaking\(\) \{\n {2}stopVoiceCue\(\);/);
});

test('useVoiceCommand keeps skipTts on every server call', () => {
  const u = src('useVoiceCommand.ts');
  const calls = u.match(/getSttProvider\(\)\.(command|text)\([^;]*;/g) ?? [];
  assert.ok(calls.length >= 3);
  for (const c of calls) assert.match(c, /skipTts: true/);
});
