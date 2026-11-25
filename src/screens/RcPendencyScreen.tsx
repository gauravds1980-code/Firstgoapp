import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Platform, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { JourneyScreen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { Chip, ExampleTag } from '../components/business';
import { Banner, Button, Card, EmptyState, Field, Icon, Pill, PressableScale, Text } from '../components/ui';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { casesFor, fmtDateShort, normaliseReg, ocrRegFromPhoto, prettyReg, RcCase, rcCasesFor, REG_REGEX, regSuggestions, TODAY } from '../services/business';
import { useApp } from '../state/AppState';
import { useRcCases } from '../state/stores';
import { colors, radius, space, touch } from '../theme/tokens';
import { NB_HYPHEN } from '../navigation/types';
import { haptic, hapticMoment } from '../utils/haptics';
import { reportValidationError } from '../tutorial/tutorialStore';

const ageTone = (d: number) => (d > 30 ? colors.danger : d > 15 ? colors.cta : colors.successBright);
const ageLabel = (d: number) => (d > 30 ? 'Overdue' : d > 15 ? 'Due soon' : 'On time');

interface Draft { reg: string; photo?: string; ocr?: boolean; reading?: boolean }

/** RC pendency: type / select the registration number and/or upload an RC photo (mock OCR); single or bulk submit. */
export default function RcPendencyScreen() {
  const { profile, session } = useApp();
  const dealerId = session?.dealerId ?? 'anon';
  const seed = useMemo(() => rcCasesFor(casesFor(profile)), [profile]);
  const [cases, setCases] = useRcCases(dealerId, seed);
  const [tab, setTab] = useState<'Pending' | 'Submitted'>('Pending');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string[] | null>(null); // lans in the sheet
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const tm = setTimeout(() => setToast(null), 3500); return () => clearTimeout(tm); }, [toast]);
  const pending = cases.filter((c) => c.status === 'Pending').sort((a, b) => b.daysPending - a.daysPending);
  const submitted = cases.filter((c) => c.status === 'Submitted');
  const list = tab === 'Pending' ? pending : submitted;
  const selecting = selected.length > 0;

  useSectionTracker('list');
  useZippyPending(pending.length ? [{ id: 'rc', label: `${pending.length} RC${pending.length === 1 ? '' : 's'} still to share`, detail: `Oldest is ${pending[0]!.daysPending} days — over 30 days counts as overdue.`, actionLabel: 'Share oldest RC', onAction: () => openSheet([pending[0]!.lan]) }] : []);

  const toggle = (lan: string) => { haptic.select(); setSelected((s) => (s.includes(lan) ? s.filter((x) => x !== lan) : [...s, lan])); };
  const openSheet = (lans: string[]) => { setDrafts((d) => { const n = { ...d }; lans.forEach((l) => { n[l] = n[l] ?? { reg: '' }; }); return n; }); setEditing(lans); };
  const setDraft = (lan: string, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [lan]: { ...(d[lan] ?? { reg: '' }), ...p } }));

  const capture = async (lan: string, source: 'camera' | 'gallery') => {
    try {
      if (source === 'camera' && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          haptic.error();
          // iOS never re-prompts after a denial, so offer a route to Settings instead of failing silently.
          if (Platform.OS === 'ios' && !perm.canAskAgain) {
            Alert.alert('Camera access is off', 'Allow camera access in Settings to photograph the RC, or pick a photo from your gallery.', [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
            ]);
          }
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, allowsEditing: false };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const uri = res.assets[0].uri;
      setDraft(lan, { photo: uri, reading: true });
      const o = await ocrRegFromPhoto(uri, res.assets[0].fileName);
      hapticMoment.rcCaptured();
      setDraft(lan, { reg: prettyReg(o.regNo), ocr: true, reading: false });
    } catch { haptic.error(); setDraft(lan, { reading: false }); }
  };

  const valid = (lan: string) => REG_REGEX.test(normaliseReg(drafts[lan]?.reg ?? ''));
  const submit = () => {
    if (!editing) return;
    const ok = editing.filter(valid);
    if (!ok.length) { haptic.error(); reportValidationError('RcPendency'); return; }
    haptic.success();
    setCases((cs) => cs.map((c) => (ok.includes(c.lan) ? { ...c, status: 'Submitted', regNo: prettyReg(drafts[c.lan]!.reg), photo: drafts[c.lan]!.photo, submittedOn: TODAY } : c)));
    setSelected((s) => s.filter((x) => !ok.includes(x)));
    setEditing(null);
    // Feedback: the case leaves Pending, the Submitted count goes up, and a toast confirms it.
    setToast(ok.length === 1 ? `RC ${prettyReg(drafts[ok[0]!]!.reg)} submitted · moved to Submitted` : `${ok.length} RCs submitted · moved to Submitted`);
  };
  const editingCases = (editing ?? []).map((l) => cases.find((c) => c.lan === l)).filter(Boolean) as RcCase[];
  const validCount = (editing ?? []).filter(valid).length;

  return (
    <JourneyScreen title="RC pendency" titleInBody assistant="rc" showTerms={false} toast={toast} footer={selecting ? (
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <Button label="Clear all" variant="secondary" onPress={() => setSelected([])} style={{ flex: 1 }} />
        <Button label={`Share ${selected.length} RC${selected.length > 1 ? 's' : ''}`} icon="share-variant" onPress={() => openSheet(selected)} style={{ flex: 2 }} />
      </View>
    ) : undefined}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">RC pendency</Text>
        <Text variant="body" color={colors.textSecondary}>Share the registration number or RC photo for disbursed loans</Text>
        <ExampleTag />
      </View>
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <Chip label="Pending" count={String(pending.length)} on={tab === 'Pending'} onPress={() => setTab('Pending')} />
        <Chip label="Submitted" count={String(submitted.length)} on={tab === 'Submitted'} onPress={() => setTab('Submitted')} />
      </View>
      {tab === 'Pending' && pending.length > 0 && (
        <Text variant="caption" color={colors.textSecondary}>Tap a case to add its RC · long-press or tick boxes to share several at once</Text>
      )}
      {tab === 'Pending' && pending.length === 0 && (
        <Card><EmptyState tone="success" icon="card-account-details-star-outline" title="All RCs shared"
          body="Nothing pending. New loans appear here a couple of days after disbursal — snap the RC as soon as registration is done."
          action={submitted.length ? { label: 'View submitted RCs', icon: 'history', onPress: () => setTab('Submitted') } : undefined} /></Card>
      )}
      {tab === 'Submitted' && submitted.length === 0 && (
        <Card><EmptyState icon="send-clock-outline" title="No RCs submitted yet"
          body="Tap a pending case, then type the registration number or snap the RC — we'll read the number for you."
          action={pending.length ? { label: 'Go to pending RCs', icon: 'arrow-left', onPress: () => setTab('Pending') } : undefined} /></Card>
      )}

      <View style={{ gap: space.sm }}>
        {list.map((c, i) => {
          const on = selected.includes(c.lan);
          return (
            <Animated.View key={c.lan} entering={FadeInDown.delay(Math.min(i, 8) * 40)} exiting={FadeOut} layout={LinearTransition.springify().damping(18)}>
              <PressableScale onPress={() => (c.status === 'Pending' ? (selecting ? toggle(c.lan) : openSheet([c.lan])) : undefined)} onLongPress={() => c.status === 'Pending' && toggle(c.lan)}
                accessibilityRole="button" accessibilityLabel={`${c.customer}, ${c.vehicle}, ${c.daysPending} days pending${c.regNo ? `, ${c.regNo}` : ''}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, overflow: 'hidden' }}>
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: c.status === 'Submitted' ? colors.primary : ageTone(c.daysPending) }} />
                {c.status === 'Pending' && (
                  // 48dp square hit area (touch.min) around the 24dp box; the negative margin keeps the row's text where it was.
                  <PressableScale onPress={() => toggle(c.lan)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Select ${c.customer}`} style={{ width: touch.min, height: touch.min, marginLeft: -space.sm, marginRight: -space.xxs, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={on ? colors.primary : colors.textSecondary} />
                  </PressableScale>
                )}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="bodyStrong">{c.customer}</Text>
                  {/* Model and ID on separate lines; the ID's hyphen never breaks ("TW‑184406"). */}
                  <Text variant="caption" color={colors.textSecondary}>{c.vehicle}</Text>
                  <Text variant="caption" color={colors.textSecondary}>{c.lan.replace('-', NB_HYPHEN)} · Disbursed {fmtDateShort(c.disbursedOn)}</Text>
                  {c.regNo && <Text variant="label" color={colors.primary}>{c.regNo}</Text>}
                </View>
                <ZippyAvoid style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  {c.status === 'Pending' ? (
                    <>
                      <Text variant="h3" color={ageTone(c.daysPending)}>{c.daysPending}d</Text>
                      <Pill label={ageLabel(c.daysPending)} tone={c.daysPending > 30 ? 'danger' : c.daysPending > 15 ? 'warning' : 'success'} />
                    </>
                  ) : <Pill label="Submitted" tone="info" />}
                </ZippyAvoid>
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editingCases.length > 1 ? `Share ${editingCases.length} RCs` : 'Share RC'}
        subtitle="Type or pick the registration number, or snap the RC — we'll read the number for you"
        footer={<Button label={validCount ? `Submit ${validCount} for verification` : 'Enter a valid registration number'} icon="send-check" disabled={!validCount} onPress={submit} />}>
        {editingCases.map((c) => <RcEntry key={c.lan} c={c} d={drafts[c.lan] ?? { reg: '' }} onChange={(p) => setDraft(c.lan, p)} onCapture={(s) => capture(c.lan, s)} compact={editingCases.length > 1} />)}
      </Sheet>
    </JourneyScreen>
  );
}

function RcEntry({ c, d, onChange, onCapture, compact }: { c: RcCase; d: Draft; onChange: (p: Partial<Draft>) => void; onCapture: (s: 'camera' | 'gallery') => void; compact: boolean }) {
  const norm = normaliseReg(d.reg);
  const err = d.reg && !REG_REGEX.test(norm) ? 'Format like MH12AB1234' : undefined;
  const sugg = useMemo(() => regSuggestions(c.lan), [c.lan]);
  return (
    <View style={{ gap: space.sm, paddingBottom: compact ? space.sm : 0, borderBottomWidth: compact ? 1 : 0, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>{c.customer} · {c.vehicle}</Text>
        <Text variant="label" color={ageTone(c.daysPending)}>{c.daysPending}d</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <PhotoButton icon="camera-outline" label="Snap RC" onPress={() => onCapture('camera')} />
        <PhotoButton icon="image-outline" label="Gallery" onPress={() => onCapture('gallery')} />
        {d.photo ? <Image source={{ uri: d.photo }} style={{ width: 64, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted }} accessibilityLabel="RC photo" /> : null}
      </View>
      {d.reading && <Banner tone="info" icon="text-recognition" title="Reading registration number…" body="From the RC photo. Takes a second." />}
      <Field label={d.ocr ? 'Registration number (read from RC photo · check it)' : 'Registration number'} value={d.reg} placeholder="MH12AB1234" autoCapitalize="characters" maxLength={13}
        onChangeText={(t) => onChange({ reg: t.toUpperCase(), ocr: d.ocr && t.toUpperCase() === d.reg ? d.ocr : false })} error={err}
        right={REG_REGEX.test(norm) ? <Icon name="check-circle" size={22} color={colors.successBright} style={{ marginRight: space.md }} /> : undefined} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' }}>
        <Text variant="caption" color={colors.textSecondary}>Issued by RTO for your dealership:</Text>
        {sugg.map((s) => <Chip key={s} label={prettyReg(s)} on={norm === s} onPress={() => { haptic.select(); onChange({ reg: prettyReg(s), ocr: false }); }} />)}
      </View>
    </View>
  );
}

function PhotoButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: touch.min, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primaryTint }}>
      <Icon name={icon} size={18} color={colors.primary} />
      <Text variant="label" color={colors.primary}>{label}</Text>
    </PressableScale>
  );
}
