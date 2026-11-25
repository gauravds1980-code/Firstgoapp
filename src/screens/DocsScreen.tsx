import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { useZippyMood } from '../components/assistant/zippyStore';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { Banner, Button, Icon, Pill, PressableScale, Text } from '../components/ui';
import { PRODUCTS } from '../config/products';
import { disbursal } from '../services';
import type { DisbursalDocType } from '../services/types';
import { useApp } from '../state/AppState';
import { colors, fontScaleCap, radius, space } from '../theme/tokens';
import { charges } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { reportValidationError } from '../tutorial/tutorialStore';

const DOCS: { key: DisbursalDocType; title: string; sub: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { key: 'invoice', title: 'Invoice', sub: 'Vehicle tax invoice', icon: 'receipt-text-outline' },
  { key: 'insurance', title: 'Insurance', sub: 'Valid policy with IDFC FIRST hypothecation', icon: 'shield-check-outline' },
  { key: 'deliveryPhoto', title: 'Asset delivery photo', sub: 'Customer with the vehicle', icon: 'camera-outline' },
];

/** Fixed width of the trailing Upload / Retry / Uploading control (fits "Uploading" with its icon). */
const DOC_ACTION_W = 96;

export default function DocsScreen() {
  const nav = useNavigation();
  const { journey, product, update, session } = useApp();
  const [busy, setBusy] = useState<DisbursalDocType | null>(null);
  const [disbursing, setDisbursing] = useState(false);
  const [failed, setFailed] = useState<Partial<Record<DisbursalDocType, string>>>({});
  const allUp = DOCS.every((d) => journey.docs[d.key]);
  const doneCount = DOCS.filter((d) => journey.docs[d.key]).length;
  useZippyMood(busy || disbursing ? 'thinking' : null); // otherwise the route default ('happy' — loan approved)
  const sec = useSectionTracker<DisbursalDocType>('invoice');
  useZippyPending(DOCS.filter((d) => !journey.docs[d.key]).map((d) => ({
    id: d.key, label: `${d.title} not uploaded`, detail: failed[d.key] ?? d.sub, actionLabel: `Upload ${d.title.toLowerCase()}`, onAction: () => { if (!busy) upload(d.key); },
  })));

  const upload = async (k: DisbursalDocType) => {
    if (busy) return; // one upload at a time (double-tap safe)
    setBusy(k); setFailed((f) => ({ ...f, [k]: undefined }));
    const r = await disbursal.uploadDisbursalDoc(k);
    setBusy(null);
    if (!r.ok) { haptic.error(); reportValidationError('Docs'); setFailed((f) => ({ ...f, [k]: r.message })); return; }
    if (r.ok) {
      haptic.success();
      const docs = { ...journey.docs, [k]: true };
      update({ docs });
      if (DOCS.every((d) => docs[d.key])) proceed(); // all 3 in → disburse automatically
    }
  };
  async function proceed() {
    setDisbursing(true);
    const r = await disbursal.requestDisbursal(journey.offer.loanApplicationNumber, charges(product, journey.loan).net,
      `${session?.name ?? 'Dealer'} · IDFC FIRST ••4321`, Math.round((Date.now() - journey.startedAt) / 1000));
    setDisbursing(false);
    if (r.ok) { update({ disbursal: r.data }); nav.navigate('Disbursal'); }
  }

  return (
    <JourneyScreen step="docs" assistant="docs" onScroll={sec.onScroll} footer={<Button label={disbursing ? 'Requesting disbursal…' : allUp ? 'Request disbursal' : `Upload ${3 - doneCount} more to disburse`} icon="bank-transfer" onPress={proceed} loading={disbursing} disabled={!allUp} />}>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check-decagram" size={48} color={colors.success} />
        </View>
        <Text variant="h1" style={{ textAlign: 'center' }}>Loan Approved!</Text>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>Upload the 3 documents below to release the vehicle and trigger disbursal.</Text>
      </View>

      {allUp ? (
        <Banner tone="success" icon={PRODUCTS[product].icon} title="Vehicle can be released" body="All documents received. You may hand over the vehicle to the customer." />
      ) : (
        <Banner tone="warning" icon="lock-outline" title="Don't release the vehicle yet" body={`Upload invoice, insurance and delivery photo first (${doneCount}/3 done).`} />
      )}

      <View style={{ gap: space.sm }} onLayout={sec.group('docs')}>
        {DOCS.map((d) => {
          const done = journey.docs[d.key];
          const fail = failed[d.key];
          return (
            <View key={d.key} onLayout={sec.at(d.key, 'docs')} style={{ gap: space.xxs }}>
            <PressableScale onPress={() => !done && upload(d.key)} disabled={busy !== null && busy !== d.key}
              accessibilityRole="button" accessibilityLabel={`${d.title}. ${done ? 'Uploaded' : 'Tap to upload'}`}
              style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: done ? colors.successBright : fail ? colors.danger : colors.border }}>
              <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: done ? colors.successSoft : colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={d.icon} size={24} color={done ? colors.success : colors.primary} />
              </View>
              {/* v1.2.9: text column shrinks and wraps (title + pill wrap too); the trailing control has a fixed width, so the
                  Required pill never runs into Upload at 360dp or at 1.3× font scale. */}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.xs, rowGap: 2 }}>
                  <Text variant="bodyStrong" style={{ flexShrink: 1 }}>{d.title}</Text>
                  {!done && <ZippyAvoid><Pill label="Required" tone={fail ? 'danger' : 'warning'} /></ZippyAvoid>}
                </View>
                <Text variant="caption" color={colors.textSecondary}>{d.sub}</Text>
              </View>
              {/* The Upload / Retry column is an avoid-rect: floating Zippy never rests on it. */}
              <ZippyAvoid style={{ width: DOC_ACTION_W, flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' }}>
                {done ? <Icon name="check-circle" size={26} color={colors.successBright} />
                  : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon name={busy === d.key ? 'loading' : 'tray-arrow-up'} size={22} color={colors.primary} />
                      <Text variant="label" color={colors.primary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control} style={{ flexShrink: 1 }}>{busy === d.key ? 'Uploading' : fail ? 'Retry' : 'Upload'}</Text>
                    </View>}
              </ZippyAvoid>
            </PressableScale>
            {fail ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">{fail} Tap to retry.</Text> : null}
            </View>
          );
        })}
      </View>
    </JourneyScreen>
  );
}
