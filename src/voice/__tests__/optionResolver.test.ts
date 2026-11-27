/**
 * fix-xtreme-select: on-device resolution of on-screen chips (Asset screen) when the server's /text path is
 * unreachable. Run: npm run test:voice
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, type ProductId } from '../../config/products';
import { localCommand, matchCommand } from '../intentMatcher';
import { offlineReading, optionAsConfirm, resolveScreenOption, serverOrOption } from '../optionResolver';
import type { CommandResponse, VoiceOption } from '../types';
import { planTarget, shouldAutoExecute, slotDetailRows } from '../voiceLogic';
import { vehicleLabel } from '../voiceOptions';

/** The chips AssetScreen registers (same mapping as its useFocusEffect). */
function chipsFor(product: ProductId): VoiceOption[] {
  const p = PRODUCTS[product];
  return [
    ...p.catalogue.map((a) => ({ id: a.id, kind: 'vehicle_model', label: vehicleLabel(a), brand: a.brand, model: a.model, variant: a.variant, value: a.id })),
    ...p.tenureOptions.map((tn) => ({ id: `tenure-${tn}`, kind: 'tenure', label: `${tn} months`, value: String(tn) })),
  ];
}
const TW = chipsFor('twoWheeler');
const pick = (text: string, chips = TW) => resolveScreenOption(text, chips);

const AUTO: [string, string][] = [
  ['extreme 125 r', 'hero-xtreme'], ['extreme 125r', 'hero-xtreme'], ['xtreme 125 r', 'hero-xtreme'], ['select extreme 125 r', 'hero-xtreme'],
  ['Xtreme 125R', 'hero-xtreme'], ['hero xtreme 125r', 'hero-xtreme'], ['extreme one twenty five r', 'hero-xtreme'],
  ['splendor plus', 'hero-splendor'], ['splendor+', 'hero-splendor'], ['vida v2', 'hero-vida'], ['bullet 350', 're-bullet'],
  ['activa 6g', 'honda-activa'], ['activa 6 g', 'honda-activa'], ['apache rtr 160', 'tvs-apache'], ['pulsar n250', 'bajaj-pulsar'],
  ['pulsar n 250', 'bajaj-pulsar'], ['ather 450x', 'ather-450x'], ['450 x', 'ather-450x'], ['four fifty x', 'ather-450x'],
  ['24 months', 'tenure-24'], ['select 36 months', 'tenure-36'],
];
const CONFIRM: [string, string][] = [
  ['hero extreme', 'hero-xtreme'], ['vida', 'hero-vida'], ['select vida', 'hero-vida'], ['apache', 'tvs-apache'], ['splendor', 'hero-splendor'],
  ['one twenty five r', 'hero-xtreme'], ['xtrem 125 r', 'hero-xtreme'],
];

test('bug: "extreme 125 r" is a retry for the command matcher but resolves to the Xtreme chip on the phone', () => {
  const local = localCommand('extreme 125 r', matchCommand('extreme 125 r'));
  assert.equal(local.status, 'retry');
  const c = pick('extreme 125 r')!;
  assert.equal(c.intent, 'SELECT_VEHICLE_MODEL');
  assert.equal(c.status, 'ok');
  assert.equal(c.confidenceBand, 'auto');
  assert.equal(c.autoExecute, true);
  assert.deepEqual(c.action, { type: 'select', kind: 'vehicle_model', id: 'hero-xtreme', label: 'Hero Xtreme 125R', value: 'hero-xtreme' });
  assert.deepEqual(c.slots, { vehicle: 'Hero Xtreme 125R', assetId: 'hero-xtreme', brand: 'Hero MotoCorp', model: 'Xtreme 125R' });
  assert.equal(c.responseText, 'Select Hero Xtreme 125R?');
  assert.equal(c.score, 1);
  assert.deepEqual(planTarget(c), { kind: 'select', optionKind: 'vehicle_model', id: 'hero-xtreme', label: 'Hero Xtreme 125R', value: 'hero-xtreme' });
  assert.equal(shouldAutoExecute(c, false), true);
  assert.equal(shouldAutoExecute(c, true), false, 'ask-before-acting still shows Confirm');
});

test('full model names auto-select the one matching chip', () => {
  for (const [text, id] of AUTO) {
    const c = pick(text);
    assert.ok(c, text);
    assert.equal(c!.action.type === 'select' && c!.action.id, id, text);
    assert.equal(c!.confidenceBand, 'auto', text);
    assert.equal(c!.autoExecute, true, text);
  }
});

test('tenure select has the server shape (SELECT_OPTION, tenureMonths)', () => {
  const c = pick('24 months')!;
  assert.equal(c.intent, 'SELECT_OPTION');
  assert.deepEqual(c.action, { type: 'select', kind: 'tenure', id: 'tenure-24', label: '24 months', value: '24' });
  assert.equal(c.slots?.tenureMonths, 24);
  assert.equal(c.responseText, 'Select 24 months?');
  assert.equal(pick('2 years')!.action.type === 'select' && (pick('2 years')!.action as { id: string }).id, 'tenure-24');
  assert.equal(pick('25 months'), null, 'not a chip');
  assert.equal(pick('24')!.confidenceBand, 'confirm', 'a bare number never auto-selects');
});

test('partial / fuzzy names are a Confirm preview of the unique chip, never auto', () => {
  for (const [text, id] of CONFIRM) {
    const c = pick(text);
    assert.ok(c, text);
    assert.equal(c!.status, 'ok', text);
    assert.equal(c!.action.type === 'select' && c!.action.id, id, text);
    assert.equal(c!.confidenceBand, 'confirm', text);
    assert.equal(c!.autoExecute, false, text);
    assert.equal(shouldAutoExecute(c!, false), false, text);
  }
});

test('a conflicting model number never selects: "Did you mean …?" clarify', () => {
  for (const [text, id] of [['pulsar ns 200', 'bajaj-pulsar'], ['xtreme 160', 'hero-xtreme'], ['activa 125', 'honda-activa'], ['bullet 500', 're-bullet']] as const) {
    const c = pick(text)!;
    assert.ok(c, text);
    assert.equal(c.status, 'clarify', text);
    assert.equal(c.action.type, 'none', text);
    assert.equal(c.autoExecute, false, text);
    assert.equal(c.candidates?.[0]?.option?.id, id, text);
    assert.match(c.responseText ?? '', /^Did you mean /, text);
  }
});

test('models that are not on screen do not pick a chip', () => {
  for (const text of ['jupiter 125', 'ntorq 125', 'tvs jupiter', 'open payouts', 'go home', 'hello', 'start kyc']) {
    const c = pick(text);
    assert.ok(!c || c.action.type !== 'select', `${text} → ${c?.action.type}`);
    assert.ok(!c || c.status !== 'ok', text);
  }
});

test('no options / an empty text → null', () => {
  assert.equal(resolveScreenOption('extreme 125 r', []), null);
  assert.equal(resolveScreenOption('extreme 125 r', undefined), null);
  assert.equal(resolveScreenOption('  ', TW), null);
  assert.equal(resolveScreenOption('select', TW), null);
});

test('two equally good chips → clarify with both', () => {
  const chips: VoiceOption[] = [
    { id: 'a', kind: 'vehicle_model', label: 'Hero Xtreme 125R', brand: 'Hero MotoCorp', model: 'Xtreme 125R', value: 'a' },
    { id: 'b', kind: 'vehicle_model', label: 'Hero Xtreme 160R', brand: 'Hero MotoCorp', model: 'Xtreme 160R', value: 'b' },
  ];
  const c = resolveScreenOption('hero xtreme', chips)!;
  assert.equal(c.status, 'clarify');
  assert.deepEqual(c.candidates?.map((x) => x.option?.id), ['a', 'b']);
  assert.equal((resolveScreenOption('xtreme 160', chips)!.action as { id: string }).id, 'b');
});

test('used-condition chips (ids ending -used) resolve the same way', () => {
  const used = TW.map((o) => (o.kind === 'vehicle_model' ? { ...o, id: `${o.id}-used`, value: `${o.id}-used` } : o));
  const c = resolveScreenOption('extreme 125 r', used)!;
  assert.equal(c.slots?.assetId, 'hero-xtreme-used');
});

test('offline reading: chip when full or the command matcher had nothing; a real command wins otherwise; never for expect', () => {
  const retry = localCommand('extreme 125 r', matchCommand('extreme 125 r'));
  const opt = pick('extreme 125 r');
  assert.equal(offlineReading(retry, opt), opt);
  assert.equal(offlineReading(retry, null), retry);
  assert.equal(offlineReading(retry, opt, 'OTP'), retry);
  const home = localCommand('go home', matchCommand('go home'));
  assert.equal(home.status, 'ok');
  assert.equal(offlineReading(home, pick('vida')), home, 'a partial chip never overrides a real local command');
  assert.equal(offlineReading(home, opt), opt);
});

test('shaky text: the chip becomes a Confirm preview of the same select', () => {
  const c = optionAsConfirm(pick('extreme 125 r')!);
  assert.equal(c.autoExecute, false);
  assert.equal(c.confidenceBand, 'confirm');
  assert.equal(shouldAutoExecute(c, false), false);
  assert.equal(planTarget(c).kind, 'select');
});

const server = (id: string): CommandResponse => ({ ...pick('vida')!, action: { type: 'select', kind: 'vehicle_model', id, label: id }, transcript: 'srv' });

test('serverOrOption: server answer wins when it comes back in time', async () => {
  const opt = pick('extreme 125 r');
  const r = await serverOrOption(async () => server('srv'), opt, 50);
  assert.equal(r.from, 'server');
  assert.equal(r.cmd.transcript, 'srv');
});

test('serverOrOption: unreachable / late server → the phone\'s full chip match', async () => {
  const opt = pick('extreme 125 r');
  const err = await serverOrOption(() => Promise.reject(new Error('network')), opt, 50);
  assert.equal(err.from, 'option');
  assert.equal(err.cmd, opt);
  const late = await serverOrOption(() => new Promise((res) => setTimeout(() => res(server('late')), 200)), opt, 20);
  assert.equal(late.from, 'option');
});

test('serverOrOption: without a full chip match the server error propagates (caller falls back)', async () => {
  await assert.rejects(serverOrOption(() => Promise.reject(new Error('network')), pick('vida'), 20));
  await assert.rejects(serverOrOption(() => Promise.reject(new Error('network')), null, 20));
});

test('DETAILS I HEARD: the assetId slug is not shown as a second "Model" row', () => {
  const rows = slotDetailRows(pick('extreme 125 r')!.slots);
  assert.deepEqual(rows.map((r) => r.label), ['Vehicle', 'Brand', 'Model']);
  assert.ok(!rows.some((r) => r.value === 'hero-xtreme'));
  assert.equal(rows.filter((r) => r.label === 'Model').length, 1);
  assert.deepEqual(slotDetailRows({ assetId: 'hero-xtreme' }), []);
  assert.deepEqual(slotDetailRows({ tenureMonths: 24 }), [{ key: 'tenureMonths', label: 'Tenure', value: '24 months' }]);
});

/** Spoken variants of a catalogue model (as written, lowercased, numbers split from letters, + → plus, brand, extreme). */
function spokenVariants(a: { brand: string; model: string }): string[] {
  const m = a.model;
  return [...new Set([
    m, m.toLowerCase(), m.replace(/(\d)([a-z])/gi, '$1 $2'), m.replace(/([a-z])(\d)/gi, '$1 $2').replace(/(\d)([a-z])/gi, '$1 $2'),
    m.replace(/\+/g, ' plus'), vehicleLabel(a), `${a.brand} ${m}`, `select ${m}`, m.replace(/xtreme/i, 'extreme'),
  ])];
}

test('sweep: every catalogue vehicle (all categories) auto-selects its own chip from spoken variants', () => {
  const misses: string[] = [];
  let n = 0;
  for (const pid of Object.keys(PRODUCTS) as ProductId[]) {
    const chips = chipsFor(pid);
    for (const a of PRODUCTS[pid].catalogue) {
      for (const v of spokenVariants(a)) {
        n++;
        const c = resolveScreenOption(v, chips);
        const id = c?.action.type === 'select' ? c.action.id : null;
        if (id !== a.id || c?.autoExecute !== true) misses.push(`${pid}: "${v}" → ${id ?? 'none'} ${c?.confidenceBand ?? ''}`);
      }
    }
    for (const tn of PRODUCTS[pid].tenureOptions) {
      n++;
      const c = resolveScreenOption(`${tn} months`, chips);
      if (!(c?.action.type === 'select' && c.action.id === `tenure-${tn}` && c.autoExecute)) misses.push(`${pid}: "${tn} months"`);
    }
  }
  assert.ok(n > 100);
  assert.deepEqual(misses, []);
});

test('sweep: other categories — names only partially heard confirm, unknown models stay unresolved', () => {
  const cv = chipsFor('cv');
  const car = chipsFor('car');
  assert.equal(resolveScreenOption('yodha', cv)?.confidenceBand, 'confirm');
  assert.equal(resolveScreenOption('ultra t seven', cv)?.autoExecute, true);
  assert.equal(resolveScreenOption('xuv seven hundred', car)?.autoExecute, true);
  assert.equal(resolveScreenOption('xuv 500', car)?.status, 'clarify');
  assert.equal(resolveScreenOption('innova', car), null);
  assert.equal(resolveScreenOption('banana', car), null);
  assert.equal(resolveScreenOption('tata', cv), null, 'a brand alone names no chip');
});
