/** v1.4.2: live transcript store — in memory only, OTP masked, source chips, interim vs final. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskSpoken, MAX_ENTRIES, voiceTranscript, type DealerLine } from '../voiceTranscript';

const dealer = () => voiceTranscript.entries().filter((e): e is DealerLine => e.role === 'dealer');

test('transcript: interim words update one line per turn, then turn final', () => {
  voiceTranscript.clear();
  voiceTranscript.live({ text: 'Open case', final: false, source: 'device', turn: 7 });
  voiceTranscript.live({ text: 'Open case for Ramesh Kum', final: false, source: 'device', turn: 7 });
  assert.equal(dealer().length, 1);
  assert.equal(dealer()[0].final, false);
  assert.equal(dealer()[0].source, 'phone');
  voiceTranscript.live({ text: 'Open case for Ramesh Kumar', final: true, source: 'device', turn: 7 });
  assert.equal(dealer()[0].final, true);
  assert.equal(dealer()[0].text, 'Open case for Ramesh Kumar');
  // The pill's quoted final text does not change the line.
  voiceTranscript.live({ text: '“Open case for Ramesh Kumar”', final: true, source: 'device', turn: 7 });
  assert.equal(dealer()[0].text, 'Open case for Ramesh Kumar');
});

test('transcript: a Whisper / server correction flips the chip to Server', () => {
  voiceTranscript.clear();
  voiceTranscript.live({ text: 'show my pay outs', final: true, source: 'device', turn: 1 });
  voiceTranscript.live({ text: 'Show my payouts for this month', final: true, source: 'server', turn: 1 });
  assert.equal(dealer().length, 1);
  assert.equal(dealer()[0].source, 'server');
  assert.equal(dealer()[0].text, 'Show my payouts for this month');
  voiceTranscript.live({ text: 'open portfolio', final: true, source: 'typed', turn: 2 });
  assert.equal(dealer()[1].source, 'typed');
});

test('transcript: empty / turn-less live state adds nothing; a discarded turn leaves no line', () => {
  voiceTranscript.clear();
  voiceTranscript.live({ text: '', final: false, source: 'device', turn: 3 });
  voiceTranscript.live({ text: 'hello', final: false });
  voiceTranscript.live(null);
  assert.equal(voiceTranscript.entries().length, 0);
  voiceTranscript.live({ text: 'op', final: false, source: 'device', turn: 4 });
  voiceTranscript.dropTurn(4);
  assert.equal(voiceTranscript.entries().length, 0);
});

test('transcript: OTP digits are masked everywhere and marked hidden', () => {
  voiceTranscript.clear();
  voiceTranscript.live({ text: 'The OTP is 482913', final: true, source: 'device', turn: 9 });
  const d = dealer()[0];
  assert.equal(d.hidden, true);
  assert.ok(!/\d/.test(d.text), d.text);
  assert.match(d.text, /The OTP is •+/);
  // Spoken digits and spaced digits too.
  assert.ok(!/\d/.test(maskSpoken('otp 4 8 2 9 1 3').text));
  assert.ok(!/four|eight|nine/i.test(maskSpoken('my otp is four eight two nine one three').text));
  // Already masked by the hook on the OTP screen → still marked hidden.
  assert.equal(maskSpoken('••••••').hidden, true);
  // Zippy rows are masked too.
  voiceTranscript.zippy('reply', 'Filled OTP 482913');
  const z = voiceTranscript.entries().at(-1)!;
  assert.ok(!/\d/.test(z.text));
  // Plain text with numbers but no OTP stays as said.
  assert.deepEqual(maskSpoken('show 3 pending cases'), { text: 'show 3 pending cases', hidden: false });
});

test('transcript: Zippy rows (reply / action / error), deduped, capped', () => {
  voiceTranscript.clear();
  voiceTranscript.zippy('action', 'Opening Payouts');
  voiceTranscript.zippy('action', 'Opening Payouts');
  voiceTranscript.zippy('reply', '  ');
  assert.equal(voiceTranscript.entries().length, 1);
  for (let i = 0; i < MAX_ENTRIES + 10; i += 1) voiceTranscript.live({ text: `turn ${i}`, final: true, source: 'device', turn: 100 + i });
  assert.equal(voiceTranscript.entries().length, MAX_ENTRIES);
  let n = 0;
  const un = voiceTranscript.subscribe(() => { n += 1; });
  voiceTranscript.clear();
  un();
  assert.equal(n, 1);
  assert.equal(voiceTranscript.entries().length, 0);
});

test('transcript: in memory only — no storage, file, network or console use in the module', () => {
  // Compiled module next to this test (the voice test build mirrors src/ into .voicetest/).
  const raw = readFileSync(join(__dirname, '..', 'voiceTranscript.js'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only, not the doc comment
  const requires = [...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ['./voiceLogic'], 'only the pure OTP mask helper is imported');
  for (const bad of ['AsyncStorage', 'secureStorage', 'SecureStore', 'expo-file-system', 'localStorage', 'fetch(', 'console.', 'JSON.stringify']) {
    assert.ok(!src.includes(bad), `voiceTranscript must not use ${bad}`);
  }
});
