import React, { useCallback, useEffect, useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { casesFor, invoicesFor, rcCasesFor, taInfFor } from '../services/business';
import { inRange, useDateRange, useRcCases } from '../state/stores';
import { inrShort } from '../components/business';
import type { RootStackParamList } from '../navigation/types';
import { Badge, ButtonLabel, Card, EmptyState, ErrorState, Icon, IconName, Pill, PressableScale, Segmented, Skeleton, Text } from '../components/ui';
import { useSectionTracker } from '../components/assistant/zippySection';
import { Condition, CONDITION_LABEL, PRODUCTS, ProductId } from '../config/products';
import { dealerTagline, fetchDealerHome, initials, RecentApp } from '../services/dealer';
import { useApp } from '../state/AppState';
import { USED_VEHICLES_ENABLED } from '../config/phases';
import { colors, elevation, fontScaleCap, gutter, radius, space, touch } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { HeaderDockSlot } from '../components/assistant/HeaderDockSlot';
import { HeaderVoiceMic } from '../voice/HeaderVoiceMic';
import { ZIPPY_RIGHT_LANE } from '../components/assistant/ZippyBubble';
import { BrandLockup } from '../components/BrandMarks';
import { ZippyTipSlot } from '../components/assistant/ZippyTipSlot';
import { SHOW_DEV_UI } from '../config/devFlags';

type HomeData = Awaited<ReturnType<typeof fetchDealerHome>>;

/** Scan QR FAB: 72dp disc + gap + ~22dp label. The scroll content reserves this + 24 so the last rows clear it. */
const FAB_H = 72 + space.xxs + 22;
const FAB_CLEARANCE = 24;

/**
 * Single-stack Home (per /workspace/boom-mockups/nav-single-stack.png): everything reachable
 * from one scroll — hero start, Today, Loans, Actions, Payouts, MVP 5 slot, assistant FAB.
 * Profile/settings via the header avatar. No bottom tab bar.
 */
export default function HomeScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { product, setProduct, condition, setCondition, categories, conditions, profile, session } = useApp();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rc] = useRcCases(session?.dealerId ?? 'anon', () => rcCasesFor(casesFor(profile)));
  // Tiles use the SAME source and date range (shared date filter) as the Payouts / Portfolio / Cases screens,
  // so a tile never says 72 when the screen behind it says 21.
  const [range] = useDateRange();
  const tiles = React.useMemo<Tile[]>(() => {
    const cs = casesFor(profile).filter((c) => inRange(c.disbursedOn, range));
    const inv = invoicesFor(casesFor(profile)).filter((i) => inRange(i.date, range));
    const unclaimed = inv.filter((i) => i.status === 'Not claimed');
    const when = range.preset === 'thisMonth' ? 'this month' : range.preset === 'lastMonth' ? 'last month' : 'in range';
    const t: Tile[] = [
      { route: 'Payouts', label: 'Payouts', icon: 'cash-multiple', color: colors.tileMustard, count: unclaimed.length, sub: `${inrShort(unclaimed.reduce((a, i) => a + i.amount, 0))} to claim` },
      { route: 'Portfolio', label: 'Portfolio', icon: 'chart-donut', color: colors.tileTeal, count: 0, sub: `${cs.filter((c) => c.pos > 0).length} active · ${when}` },
      { route: 'Cases', label: 'Cases done', icon: 'check-decagram-outline', color: colors.tileNavy, count: 0, sub: `${cs.length} disbursed · ${when}` },
      { route: 'RcPendency', label: 'RC pendency', icon: 'card-account-details-outline', color: colors.tileMaroon, count: rc.filter((c) => c.status === 'Pending').length, sub: 'pending RCs' },
    ];
    if (profile?.hasTaInf) {
      const l = taInfFor(profile);
      const avail = l.reduce((a, x) => a + x.sanctioned - x.utilised, 0);
      t.push({ route: 'TaInf', label: 'TA / INF limits', icon: 'warehouse', color: colors.primaryDark, count: 0, sub: `${inrShort(avail)} available` });
    }
    return t;
  }, [profile, rc, range]);

  // Section-aware Zippy help: which Home block is in view.
  const sec = useSectionTracker<'start' | 'today' | 'loans' | 'actions' | 'payouts'>('start');
  // Only this dealer's products (a CV-only dealer never sees two-wheeler rows).
  const recent = data ? data.recent.filter((r) => categories.includes(r.product)) : null;
  const payouts = data ? data.payouts.filter((po) => categories.includes(po.product)) : null;
  const payoutsToday = payouts ? payouts.reduce((t, po) => t + po.amount, 0) : 0;
  // Today's three figures come from ONE list (today's applications), so "Approved" can never be 0 next
  // to a non-zero "Disbursed": a disbursed loan was approved first.
  const today = recent ? {
    apps: recent.length,
    approved: recent.filter((r) => r.status !== 'PENDING').length,
    disbursed: recent.filter((r) => r.status === 'DISBURSED').reduce((t, r) => t + r.amount, 0),
  } : null;
  const fabBottom = Math.max(insets.bottom, space.sm) + space.xs;

  const load = useCallback(async () => {
    setError(false);
    try { setData(await fetchDealerHome()); } catch { setError(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const p = PRODUCTS[product];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* Header: the shared bank lockup (IDFC mark + one-line "IDFC FIRST Bank" + "» FIRSTgo"), Zippy's dock,
          the standalone hold-to-talk mic, bell, avatar → Profile & settings. Only the lockup's text column shrinks; the trailing controls keep
          their 48dp boxes. A little extra top padding keeps the wordmark off the status bar / notch. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: gutter.screen, paddingTop: space.xs, minHeight: 64 }}>
        <BrandLockup markSize={44} style={{ flex: 1, marginRight: space.xxs }} />
        <HeaderDockSlot />
        <HeaderVoiceMic />
        <PressableScale accessibilityRole="button" accessibilityLabel={`Notifications, ${data?.unread ?? 0} unread`} style={iconBtn}>
          <Icon name="bell-outline" size={26} color={colors.text} />
          <Badge count={data?.unread ?? 0} style={{ position: 'absolute', top: 4, right: 2 }} />
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityLabel={`Profile and settings, ${session?.name ?? 'Dealer'}`} onPress={() => nav.navigate('Profile')} style={iconBtn}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary }}>
            <Text variant="label" color={colors.primary} maxFontSizeMultiplier={fontScaleCap.control}>{initials(session?.name ?? 'Dealer')}</Text>
          </View>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter.screen, paddingTop: space.xs, gap: space.lg, paddingBottom: fabBottom + FAB_H + FAB_CLEARANCE }}
        onScroll={sec.onScroll} scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {/* Dealer: name on one line, role / OEM on the next (ellipsized, never an orphan "·"). */}
        <View style={{ gap: 2 }}>
          <Text variant="h3" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{session?.name ?? 'Dealer'}</Text>
          {profile && <Text variant="caption" color={colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{dealerTagline(profile)} · {profile.branch}</Text>}
        </View>

        {/* HERO — short: title, product / OEM pills on one row, the CTA */}
        {/* iOS clips shadows on overflow:'hidden' views, so on iOS the shadow lives on a wrapper (Android/web unchanged). */}
        <View onLayout={sec.at('start')} style={IOS ? [{ borderRadius: radius.xl, backgroundColor: colors.primary }, elevation.raised as object] : undefined}>
        <LinearGradient colors={['#B43140', colors.primary, colors.primaryDark]} locations={[0, 0.48, 1]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
          style={[{ borderRadius: radius.xl, padding: space.md, gap: space.sm, overflow: 'hidden' }, IOS ? null : elevation.raised as object]}>
          <View pointerEvents="none" style={{ position: 'absolute', right: -32, top: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.07)' }} />
          <View pointerEvents="none" style={{ position: 'absolute', right: 40, bottom: -60, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(0,0,0,0.10)' }} />
          <Text variant="h2" color={colors.onPrimary} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{heroTitle(condition)}</Text>
          {/* Category switch when the dealer has more than one of 2W / Car / CV; single-product dealers get a chip (e.g. "Commercial Vehicle only") */}
          {categories.length > 1 && (
            <Segmented<ProductId> inverse value={product} onChange={setProduct}
              options={categories.map((id) => ({ value: id, label: PRODUCTS[id].label, icon: PRODUCTS[id].icon }))} />
          )}
          {/* New / Used only when the dealer has both for this category */}
          {conditions.length > 1 ? (
            <Segmented<Condition> inverse value={condition} onChange={setCondition}
              options={conditions.map((c) => ({ value: c, label: CONDITION_LABEL[c], icon: c === 'new' ? 'star-four-points-outline' : 'history' }))} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'nowrap', overflow: 'hidden' }}>
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
            <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }}>or tap <Text variant="label" color={colors.onPrimary}>Scan QR</Text> below · fastest</Text>
          </View>
        </LinearGradient>
        </View>

        {/* Today */}
        <Section title="Today" onLayout={sec.at('today')}>
          {error ? <Card><ErrorState title="Couldn't load today's numbers" body="Pull down to refresh or try again." onRetry={load} /></Card> : (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {data && today ? (
                [[String(today.apps), 'Applications'], [String(today.approved), 'Approved'], [inrShort(today.disbursed), 'Disbursed']].map(([v, l]) => (
                  <Card key={l} style={{ flex: 1, minWidth: 0, padding: space.md, gap: space.xxs }}>
                    <Text variant="h2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={fontScaleCap.compact}>{v}</Text>
                    <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{l}</Text>
                  </Card>
                ))
              ) : [0, 1, 2].map((i) => <View key={i} style={{ flex: 1 }}><Skeleton h={76} r={radius.lg} /></View>)}
            </View>
          )}
        </Section>

        {/* Loans */}
        <Section title="Loans" link="View all" onLink={() => nav.navigate('QuickList', { kind: 'loans' })} onLayout={sec.at('loans')}>
          <Card style={{ padding: 0 }}>
            {recent && recent.length === 0 ? (
              <EmptyState icon="file-document-plus-outline" title="No loans yet today"
                body={`Start one with Scan QR below, or search the customer's mobile number for a ${p.label.toLowerCase()} offer.`}
                action={{ label: 'Search by mobile number', icon: 'cellphone-text', onPress: () => nav.navigate('SearchMobile', { stage: 'enter' }) }} />
            ) : (recent ? recent.slice(0, 3) : [null, null]).map((r, i, arr) => <LoanRow key={r?.id ?? i} app={r} last={i === arr.length - 1} />)}
          </Card>
        </Section>

        {/* Actions — 2x2 coloured tiles with count badges */}
        <Section title="Actions" onLayout={sec.at('actions')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {(data ? tiles : [null, null, null, null]).map((a, i) => <ActionTile key={a?.route ?? i} action={a} onPress={() => a && nav.navigate(a.route as never)} />)}
          </View>
          {SHOW_DEV_UI && <Text variant="caption" color={colors.textSecondary}>Example data in Actions screens</Text>}
        </Section>

        {/* Payouts / disbursals (formerly the Pay tab) */}
        <Section title="Payouts" link="View all" onLink={() => nav.navigate('Payouts')} onLayout={sec.at('payouts')}>
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bank-transfer-in" size={24} color={colors.success} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="caption" color={colors.textSecondary}>Credited today · settlement a/c ••4321</Text>
                {data ? <Text variant="display" color={colors.text} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={fontScaleCap.compact}>{inr(payoutsToday)}</Text> : <Skeleton w={120} h={32} />}
              </View>
            </View>
            {payouts && payouts.length === 0 && (
              <Text variant="caption" color={colors.textSecondary}>No credits yet today. Payouts land here minutes after each disbursal.</Text>
            )}
            {payouts?.slice(0, 2).map((po) => (
              <View key={po.utr} style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, gap: space.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="label" numberOfLines={1}>{inr(po.amount)} · {po.lan}</Text>
                  <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{po.when}</Text>
                  <Text variant="caption" color={colors.textSecondary} numberOfLines={1} ellipsizeMode="middle">UTR {po.utr}</Text>
                </View>
                <Pill label="Credited" tone="success" />
              </View>
            ))}
          </Card>
        </Section>

      </ScrollView>

      <LinearGradient pointerEvents="none" colors={['rgba(253,244,239,0)', colors.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: fabBottom + FAB_H }} />

      {/* Zippy's tip: anchored just above the Scan QR FAB, auto-dismisses. */}
      <ZippyTipSlot style={{ position: 'absolute', left: 0, right: 0, bottom: fabBottom + FAB_H + space.xs }} />

      {/* Fixed bottom-centre SCAN QR FAB (PhonePe/UPI mental model) — the dominant one-tap start */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: fabBottom, alignItems: 'center' }}>
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

const iconBtn = { width: touch.min, height: touch.min, flexShrink: 0, alignItems: 'center' as const, justifyContent: 'center' as const };

/** Trailing inset for section link rows: Zippy's right lane measured from the screen edge, minus the screen gutter. */
const SECTION_LINK_INSET = Math.max(0, ZIPPY_RIGHT_LANE - gutter.screen);

function Section({ title, link, onLink, children, onLayout }: { title: string; link?: string; onLink?: () => void; children: React.ReactNode; onLayout?: React.ComponentProps<typeof View>['onLayout'] }) {
  return (
    <View style={{ gap: space.xs }} onLayout={onLayout}>
      {/* Rows with a link keep a clear right-hand lane for floating Zippy (+ its inner-side ✕), so the
          link never scrolls under Zippy's rest footprint. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touch.min, paddingRight: link ? SECTION_LINK_INSET : 0 }}>
        <Text variant="h2" accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }}>{title}</Text>
        {link && (
          <PressableScale onPress={onLink} accessibilityRole="link" accessibilityLabel={`${link} ${title}`} style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, minHeight: touch.min, paddingLeft: space.md }}>
            <Text variant="bodyStrong" color={colors.primary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control}>{link}</Text>
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

const STATUS_LABEL: Record<RecentApp['status'], string> = { DISBURSED: 'Disbursed', APPROVED: 'Approved', PENDING: 'Pending' };

function LoanRow({ app, last }: { app: RecentApp | null; last: boolean }) {
  const tone = app?.status === 'DISBURSED' ? 'success' : app?.status === 'APPROVED' ? 'info' : 'warning';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, minHeight: 72, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      {app ? (
        <>
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={PRODUCTS[app.product].icon} size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={1}>{app.id}</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{inr(app.amount)}</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{app.when}</Text>
          </View>
          <Pill label={STATUS_LABEL[app.status]} tone={tone} />
        </>
      ) : (<><Skeleton w={44} h={44} r={radius.md} /><View style={{ flex: 1, gap: 6 }}><Skeleton w="50%" /><Skeleton w="70%" h={12} /></View><Skeleton w={72} h={20} /></>)}
    </View>
  );
}

/** Short hero title, no jargon; the product is in the pill / switch right under it. "used" only when enabled. */
function heroTitle(condition: Condition): string {
  return USED_VEHICLES_ENABLED && condition === 'used' ? 'New used-vehicle loan' : 'New loan';
}

function HeroChip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.16)' }}>
      <Icon name={icon} size={16} color={colors.onPrimary} />
      <Text variant="label" color={colors.onPrimary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }}>{label}</Text>
    </View>
  );
}
