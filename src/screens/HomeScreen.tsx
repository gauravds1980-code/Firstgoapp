import React, { useCallback, useEffect, useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { casesFor, invoicesFor, rcCasesFor, taInfFor } from '../services/business';
import { useRcCases } from '../state/stores';
import { inrShort } from '../components/business';
import type { RootStackParamList } from '../navigation/types';
import { Badge, ButtonLabel, Card, ErrorState, Icon, IconName, Pill, PressableScale, Segmented, Skeleton, Text } from '../components/ui';
import { Condition, CONDITION_LABEL, PRODUCTS, ProductId } from '../config/products';
import { dealerTagline, fetchDealerHome, initials, RecentApp } from '../services/dealer';
import { useApp } from '../state/AppState';
import { USED_VEHICLES_ENABLED } from '../config/phases';
import { colors, elevation, gutter, radius, space, touch } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { HeaderDockSlot } from '../components/assistant/HeaderDockSlot';

type HomeData = Awaited<ReturnType<typeof fetchDealerHome>>;

/**
 * Single-stack Home (per /workspace/boom-mockups/nav-single-stack.png): everything reachable
 * from one scroll — hero start, Today, Loans, Actions, Payouts, MVP 5 slot, assistant FAB.
 * Profile/settings via the header avatar. No bottom tab bar.
 */
export default function HomeScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { product, setProduct, condition, setCondition, categories, conditions, profile, phase, session } = useApp();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rc] = useRcCases(session?.dealerId ?? 'anon', () => rcCasesFor(casesFor(profile)));
  const tiles = React.useMemo<Tile[]>(() => {
    const cs = casesFor(profile);
    const inv = invoicesFor(cs);
    const unclaimed = inv.filter((i) => i.status === 'Not claimed');
    const t: Tile[] = [
      { route: 'Payouts', label: 'Payouts', icon: 'cash-multiple', color: colors.tileMustard, count: unclaimed.length, sub: `${inrShort(unclaimed.reduce((a, i) => a + i.amount, 0))} to claim` },
      { route: 'Portfolio', label: 'Portfolio', icon: 'chart-donut', color: colors.tileTeal, count: 0, sub: `${cs.filter((c) => c.pos > 0).length} active loans` },
      { route: 'Cases', label: 'Cases done', icon: 'check-decagram-outline', color: colors.tileNavy, count: 0, sub: `${cs.length} disbursed` },
      { route: 'RcPendency', label: 'RC pendency', icon: 'card-account-details-outline', color: colors.tileMaroon, count: rc.filter((c) => c.status === 'Pending').length, sub: 'pending RCs' },
    ];
    if (profile?.hasTaInf) {
      const l = taInfFor(profile);
      const avail = l.reduce((a, x) => a + x.sanctioned - x.utilised, 0);
      t.push({ route: 'TaInf', label: 'TA / INF limits', icon: 'warehouse', color: colors.primaryDark, count: 0, sub: `${inrShort(avail)} available` });
    }
    return t;
  }, [profile, rc]);

  const load = useCallback(async () => {
    setError(false);
    try { setData(await fetchDealerHome()); } catch { setError(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const p = PRODUCTS[product];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* Header: logo mark + wordmark + dealer, bell, avatar → Profile & settings */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter.screen, minHeight: 64, gap: space.sm }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <LogoMark />
        </View>
        <View style={{ flex: 1 }} accessibilityRole="header">
          <Text variant="bodyStrong" color={colors.primary}>IDFC <Text variant="bodyStrong" color={colors.primary} style={{ fontFamily: 'Inter_800ExtraBold' }}>FIRST</Text> Bank</Text>
          <Text variant="caption" color={colors.textSecondary} numberOfLines={2}>{session?.name ?? 'Dealer'}{profile ? ` · ${dealerTagline(profile)}` : ''}</Text>
        </View>
        <HeaderDockSlot />
        <PressableScale accessibilityRole="button" accessibilityLabel={`Notifications, ${data?.unread ?? 0} unread`} style={iconBtn}>
          <Icon name="bell-outline" size={26} color={colors.text} />
          <Badge count={data?.unread ?? 0} style={{ position: 'absolute', top: 4, right: 2 }} />
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityLabel={`Profile and settings, ${session?.name ?? 'Dealer'}`} onPress={() => nav.navigate('Profile')} style={iconBtn}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary }}>
            <Text variant="label" color={colors.primary}>{initials(session?.name ?? 'Dealer')}</Text>
          </View>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter.screen, paddingTop: space.xs, gap: space.lg, paddingBottom: 140 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {/* HERO — dominant one-tap start */}
        {/* iOS clips shadows on overflow:'hidden' views, so on iOS the shadow lives on a wrapper (Android/web unchanged). */}
        <View style={IOS ? [{ borderRadius: radius.xl, backgroundColor: colors.primary }, elevation.raised as object] : undefined}>
        <LinearGradient colors={['#B43140', colors.primary, colors.primaryDark]} locations={[0, 0.48, 1]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
          style={[{ borderRadius: radius.xl, padding: space.lg, gap: space.md, overflow: 'hidden' }, IOS ? null : elevation.raised as object]}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -32, top: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.07)' }} />
          <View pointerEvents="none" style={{ position: 'absolute', right: 40, bottom: -60, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(0,0,0,0.10)' }} />
          <View style={{ gap: space.xxs }}>
            <Text variant="overline" color="rgba(255,255,255,0.8)">START A</Text>
            <Text variant="h1" color={colors.onPrimary}>Pre-Qualified {USED_VEHICLES_ENABLED ? `${CONDITION_LABEL[condition]} ` : ''}{p.label} Journey</Text>
          </View>
          {/* Category switch only when the dealer is enabled for both 2W and Car */}
          {categories.length > 1 && (
            <Segmented<ProductId> inverse value={product} onChange={setProduct}
              options={categories.map((id) => ({ value: id, label: PRODUCTS[id].label, icon: PRODUCTS[id].icon }))} />
          )}
          {/* New / Used only when the dealer has both for this category */}
          {conditions.length > 1 ? (
            <Segmented<Condition> inverse value={condition} onChange={setCondition}
              options={conditions.map((c) => ({ value: c, label: CONDITION_LABEL[c], icon: c === 'new' ? 'star-four-points-outline' : 'history' }))} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' }}>
              {categories.length === 1 && <HeroChip icon={p.icon} label={`${p.label} only`} />}
              {USED_VEHICLES_ENABLED && <HeroChip icon={condition === 'new' ? 'star-four-points-outline' : 'history'} label={`${CONDITION_LABEL[condition]} vehicles`} />}
              {profile?.oem && profile.type !== 'multiBrand' && <HeroChip icon="factory" label={profile.oem} />}
            </View>
          )}
          <PressableScale accessibilityRole="button" accessibilityLabel="Search by the customer's registered mobile number" onPress={() => nav.navigate('SearchMobile', { stage: 'enter' })}
            style={[{ minHeight: touch.cta, borderRadius: radius.pill, backgroundColor: colors.cta, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.xs }, elevation.card as object]}>
            <Icon name="cellphone-text" size={22} color={colors.text} style={{ flexShrink: 0 }} />
            <ButtonLabel color={colors.text}>Search by Mobile Number</ButtonLabel>
          </PressableScale>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
            <Icon name="qrcode-scan" size={16} color="rgba(255,255,255,0.85)" />
            <Text variant="caption" color="rgba(255,255,255,0.85)">or tap <Text variant="label" color={colors.onPrimary}>Scan QR</Text> below · fastest</Text>
            <Icon name="arrow-down" size={16} color="rgba(255,255,255,0.85)" />
          </View>
        </LinearGradient>
        </View>

        {/* Today */}
        <Section title="Today">
          {error ? <Card><ErrorState title="Couldn't load today's numbers" body="Pull down to refresh or try again." onRetry={load} /></Card> : (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {data ? (
                [['3', 'Applications'], ['3', 'Approved'], ['₹3.06L', 'Disbursed']].map(([v, l]) => (
                  <Card key={l} style={{ flex: 1, padding: space.md, gap: space.xxs }}>
                    <Text variant="h2">{v}</Text>
                    <Text variant="caption" color={colors.textSecondary}>{l}</Text>
                  </Card>
                ))
              ) : [0, 1, 2].map((i) => <View key={i} style={{ flex: 1 }}><Skeleton h={76} r={radius.lg} /></View>)}
            </View>
          )}
        </Section>

        {/* Loans */}
        <Section title="Loans" link="View all" onLink={() => nav.navigate('QuickList', { kind: 'loans' })}>
          <Card style={{ padding: 0 }}>
            {(data ? data.recent.filter((r) => categories.includes(r.product)) : [null, null]).map((r, i, arr) => <LoanRow key={r?.id ?? i} app={r} last={i === arr.length - 1} />)}
          </Card>
        </Section>

        {/* Actions — 2x2 coloured tiles with count badges */}
        <Section title="Actions">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {(data ? tiles : [null, null, null, null]).map((a, i) => <ActionTile key={a?.route ?? i} action={a} onPress={() => a && nav.navigate(a.route as never)} />)}
          </View>
          <Text variant="caption" color={colors.textSecondary}>Example data in Actions screens</Text>
        </Section>

        {/* Payouts / disbursals (formerly the Pay tab) */}
        <Section title="Payouts" link="View all" onLink={() => nav.navigate('Payouts')}>
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bank-transfer-in" size={24} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" color={colors.textSecondary}>Credited today · settlement a/c ••4321</Text>
                {data ? <Text variant="h2">{inr(data.payoutsToday)}</Text> : <Skeleton w={120} h={24} />}
              </View>
            </View>
            {data?.payouts.slice(0, 2).map((po) => (
              <View key={po.utr} style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{inr(po.amount)} · {po.lan}</Text>
                  <Text variant="caption" color={colors.textSecondary}>UTR {po.utr} · {po.when}</Text>
                </View>
                <Pill label="CREDITED" tone="success" />
              </View>
            ))}
          </Card>
        </Section>

        {/* MVP 5 placeholder — intentionally NOT built */}
        <View accessibilityLabel="Reserved slot: cross-sell shelf, coming in MVP 5"
          style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 72 }}>
          <View style={{ width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={20} color={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" color={colors.textMuted}>Cross-sell shelf</Text>
            <Text variant="caption" color={colors.textMuted}>Business loan · credit card — coming in MVP 5 (now: MVP {phase})</Text>
          </View>
        </View>
      </ScrollView>

      <LinearGradient pointerEvents="none" colors={['rgba(253,244,239,0)', colors.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 + insets.bottom }} />

      {/* Fixed bottom-centre SCAN QR FAB (PhonePe/UPI mental model) — the dominant one-tap start */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, space.sm) + space.xs, alignItems: 'center' }}>
        <PressableScale onPress={() => { haptic.success(); nav.navigate('ScanQr'); }} haptics={false}
          accessibilityRole="button" accessibilityLabel={`Scan QR. Scan the customer's QR to start a ${p.label} loan`}
          style={{ alignItems: 'center', gap: space.xxs }}>
          <View style={[{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, borderWidth: 4, borderColor: colors.cta, alignItems: 'center', justifyContent: 'center' }, elevation.raised as object]}>
            <Icon name="qrcode-scan" size={32} color={colors.onPrimary} />
          </View>
          <View style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
            <Text variant="label" color={colors.onPrimary}>Scan QR</Text>
          </View>
        </PressableScale>
      </View>

    </View>
  );
}

/** iOS draws shadows only on unclipped views (see hero + action tiles). */
const IOS = Platform.OS === 'ios';

const iconBtn = { width: touch.min, height: touch.min, alignItems: 'center' as const, justifyContent: 'center' as const };

/** The IDFC FIRST "F" bars mark. */
function LogoMark() {
  return (
    <View style={{ width: 22, height: 20, gap: 3 }}>
      <View style={{ width: 22, height: 4.5, backgroundColor: '#fff', borderRadius: 1 }} />
      <View style={{ width: 15, height: 4.5, backgroundColor: '#fff', borderRadius: 1 }} />
      <View style={{ width: 7, height: 4.5, backgroundColor: '#fff', borderRadius: 1 }} />
    </View>
  );
}

function Section({ title, link, onLink, children }: { title: string; link?: string; onLink?: () => void; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touch.min }}>
        <Text variant="h2" accessibilityRole="header">{title}</Text>
        {link && (
          <PressableScale onPress={onLink} accessibilityRole="link" accessibilityLabel={`${link} ${title}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: touch.min, paddingLeft: space.md }}>
            <Text variant="bodyStrong" color={colors.primary}>{link}</Text>
            <Icon name="chevron-right" size={20} color={colors.primary} />
          </PressableScale>
        )}
      </View>
      {children}
    </View>
  );
}

type Tile = { route: keyof RootStackParamList; label: string; icon: IconName; color: string; count: number; sub: string };

function ActionTile({ action, onPress }: { action: Tile | null; onPress: () => void }) {
  if (!action) return <View style={{ width: '48%', flexGrow: 1 }}><Skeleton h={104} r={radius.lg} /></View>;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${action.label}${action.count ? `, ${action.count} pending` : ''}`}
      style={[{ width: '48%', flexGrow: 1, minHeight: 104, backgroundColor: action.color, borderRadius: radius.lg, padding: space.md, justifyContent: 'space-between', overflow: IOS ? 'visible' : 'hidden' }, elevation.card as object]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={action.icon} size={22} color={colors.onPrimary} />
        </View>
        {action.count > 0 && (
          <View style={{ minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 7, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="label" color={colors.text}>{action.count}</Text>
          </View>
        )}
      </View>
      <View>
        <Text variant="bodyStrong" color={colors.onPrimary} numberOfLines={1}>{action.label}</Text>
        <Text variant="caption" color="rgba(255,255,255,0.82)" numberOfLines={1}>{action.sub}</Text>
      </View>
    </PressableScale>
  );
}

function LoanRow({ app, last }: { app: RecentApp | null; last: boolean }) {
  const tone = app?.status === 'DISBURSED' ? 'success' : app?.status === 'APPROVED' ? 'info' : 'warning';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, minHeight: 72, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      {app ? (
        <>
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={PRODUCTS[app.product].icon} size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{app.id}</Text>
            <Text variant="caption" color={colors.textSecondary}>{inr(app.amount)} · {app.when}</Text>
          </View>
          <Pill label={app.status} tone={tone} />
        </>
      ) : (<><Skeleton w={44} h={44} r={radius.md} /><View style={{ flex: 1, gap: 6 }}><Skeleton w="50%" /><Skeleton w="70%" h={12} /></View><Skeleton w={72} h={20} /></>)}
    </View>
  );
}

function HeroChip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.16)' }}>
      <Icon name={icon} size={16} color={colors.onPrimary} />
      <Text variant="label" color={colors.onPrimary}>{label}</Text>
    </View>
  );
}
