import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { useZippyMood } from '../components/assistant/zippyStore';
import { Banner, Button, Icon, PressableScale, Text } from '../components/ui';
import { disbursal } from '../services';
import type { DisbursalDocType } from '../services/types';
import { useApp } from '../state/AppState';
import { colors, radius, space } from '../theme/tokens';
import { charges } from '../utils/finance';
import { haptic } from '../utils/haptics';

const DOCS: { key: DisbursalDocType; title: string; sub: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { key: 'invoice', title: 'Invoice', sub: 'Vehicle tax invoice', icon: 'receipt-text-outline' },
  { key: 'insurance', title: 'Insurance', sub: 'Valid policy with IDFC FIRST hypothecation', icon: 'shield-check-outline' },
  { key: 'deliveryPhoto', title: 'Asset delivery photo', sub: 'Customer with the vehicle', icon: 'camera-outline' },
];

export default function DocsScreen() {
  const nav = useNavigation();
  const { journey, product, update, session } = useApp();
  const [busy, setBusy] = useState<DisbursalDocType | null>(null);
  const [disbursing, setDisbursing] = useState(false);
  const allUp = DOCS.every((d) => journey.docs[d.key]);
  useZippyMood(busy || disbursing ? 'thinking' : null); // otherwise the route default ('happy' — loan approved)

  const upload = async (k: DisbursalDocType) => {
    setBusy(k);
    const r = await disbursal.uploadDisbursalDoc(k);
    setBusy(null);
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
    <JourneyScreen step="docs" assistant="docs" footer={<Button label={disbursing ? 'Requesting disbursal…' : allUp ? 'Proceed for Disbursal' : 'Disbursal starts after the 3rd upload'} icon="bank-transfer" onPress={proceed} loading={disbursing} disabled={!allUp} />}>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check-decagram" size={48} color={colors.success} />
        </View>
        <Text variant="h1" style={{ textAlign: 'center' }}>Loan Approved!</Text>
        <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>Upload the 3 documents below to release the vehicle and trigger disbursal.</Text>
      </View>

      {allUp ? (
        <Banner tone="success" icon="motorbike" title="Vehicle can be released" body="All documents received. You may hand over the vehicle to the customer." />
      ) : (
        <Banner tone="warning" icon="lock-outline" title="Don't release the vehicle yet" body={`Upload invoice, insurance and delivery photo first (${DOCS.filter((d) => journey.docs[d.key]).length}/3 done).`} />
      )}

      <View style={{ gap: space.sm }}>
        {DOCS.map((d) => {
          const done = journey.docs[d.key];
          return (
            <PressableScale key={d.key} onPress={() => !done && upload(d.key)} disabled={busy !== null && busy !== d.key}
              accessibilityRole="button" accessibilityLabel={`${d.title}. ${done ? 'Uploaded' : 'Tap to upload'}`}
              style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: done ? colors.successBright : colors.border }}>
              <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: done ? colors.successSoft : colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={d.icon} size={24} color={done ? colors.success : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{d.title}</Text>
                <Text variant="caption" color={colors.textSecondary}>{d.sub}</Text>
              </View>
              {done ? <Icon name="check-circle" size={26} color={colors.successBright} />
                : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Icon name={busy === d.key ? 'loading' : 'tray-arrow-up'} size={22} color={colors.primary} />
                    <Text variant="label" color={colors.primary}>{busy === d.key ? 'Uploading' : 'Upload'}</Text>
                  </View>}
            </PressableScale>
          );
        })}
      </View>
    </JourneyScreen>
  );
}
