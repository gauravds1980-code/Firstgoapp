import React, { useCallback, useEffect, useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ADVANCE_MIN, availableOf, casesFor, rcCasesFor, taInfFor } from '../services/business';
import { homePayoutCard, statementInvoicesFor } from '../services/payoutStatement';
import { inRange, useAdvance, useDateRange, useInvoices, useRcCases, useTaInf, useWcApplication } from '../state/stores';
import { inrShort } from '../components/business';
import type { RootStackParamList } from '../navigation/types';
import { ButtonLabel, Card, EmptyState, ErrorState, Icon, IconName, Pill, PressableScale, Segmented, Skeleton, Text } from '../components/ui';
import { reportFooterHeight, useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { scrollZippyAvoid, ZippyAvoid } from '../components/assistant/zippyAvoid';
import { Condition, CONDITION_LABEL, PRODUCTS, ProductId } from '../config/products';
import { dealerTagline, fetchDealerHome, initials, RecentApp } from '../services/dealer';
import { useApp } from '../state/AppState';
import { USED_VEHICLES_ENABLED } from '../config/phases';
import { colors, elevation, fontScaleCap, gutter, headerBtn, radius, space, touch } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic } from '../utils/haptics';
import { HeaderDockSlot } from '../components/assistant/HeaderDockSlot';
import { alignedMicBottom } from '../voice/micDock';
import { useVoiceMicAnchor } from '../voice/VoiceMic';
import { ZIPPY_SAFE_GUTTER } from '../components/assistant/ZippyBubble';
import { BrandLockup } from '../components/BrandMarks';
import { ZippyTipSlot } from '../components/assistant/ZippyTipSlot';
import { SHOW_DEV_UI } from '../config/devFlags';
import { copyUtr, ToastView, useToast } from '../components/Toast';
import { IconWell, PhosphorName } from '../components/phosphor';
import { AlertCard, BellBadge, HomeSummaryCard, InFlightRow, type SummaryLine } from '../components/library';
import { readoutAllowed, unreadOf } from '../services/alerts';
import { useAlerts } from '../state/useAlerts';
import { isMoneyInFlightEnabled, mifAlerts, mifFilesFor, mifTotals, applyFilter, sortFiles, fmtTime } from '../services/moneyInFlight';
import { statusFilesFor, todayActivity, todayCounts } from '../services/loanStatus';
import { useMifLocal } from '../state/stores';
import { inFlightRowModel } from './MoneyInFlightScreen';

type HomeData = Awaited<ReturnType<typeof fetchDealerHome>>;

/** Scan QR FAB: 72dp disc + gap + ~22dp label. The scroll content reserves this + ZIPPY_SAFE_GUTTER so the last rows clear it (and Zippy). */
const FAB_H = 72 + space.xxs + 22;
/** Compact loan preview row (id, then amount · time). Only as many rows as fit above the FAB are previewed. */
const LOAN_ROW_H = 64;
/** One "today's credit" row on the Home Payouts card (amount · LAN, time, UTR) + its top rule; re-measured on layout. */
const CREDIT_ROW_H = 76;
/** Clear space kept between the bottom of the Payouts card and the top of the Scan QR FAB + label. */
const PAY_CLEAR = space.md;
/** 'this month' → 'This month'. */
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Short hero chip labels, so they never ellipsize at 360dp. */
const PRODUCT_SHORT: Record<ProductId, string> = { twoWheeler: '2W', car: 'Car', cv: 'CV' };

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
  const utrToast = useToast();
  const dealerId = session?.dealerId ?? 'anon';
  // Same stores as the Payouts / RC screens, so a claim or RC submit updates these tiles immediately.
  const cases = React.useMemo(() => casesFor(profile), [profile]);
  const rcSeed = React.useMemo(() => rcCasesFor(cases), [cases]);
  // v1.4.8: the commission statement is the payout seed (same as the Payouts screen, the advance limit and the alerts).
  const invSeed = React.useMemo(() => statementInvoicesFor(session?.mobile, profile), [session?.mobile, profile]);
  const [rc] = useRcCases(dealerId, rcSeed);
  const invoices = useInvoices(dealerId, invSeed);
  // Live TA / INF balances from the shared store (same source as the TA / INF screen).
  const facility = useTaInf(session?.dealerId, () => taInfFor(profile));
  const wcApp = useWcApplication(session?.dealerId);
  // Advance payout position (same store as Payouts; NOT date-filtered: always the last 3 months).
  const advance = useAdvance(dealerId, invoices);
  const advanceLine = advance.outstanding > 0 ? `${inrShort(advance.outstanding)} advance o/s` : advance.available >= ADVANCE_MIN ? `${inrShort(advance.available)} advance` : undefined;
  // Tiles use the SAME source and date range (shared date filter) as the Payouts / Portfolio / Cases screens,
  // so a tile never says 72 when the screen behind it says 21.
  const [range] = useDateRange();
  // Section-aware Zippy help: which Home block is in view.
  const sec = useSectionTracker<'start' | 'today' | 'money' | 'loans' | 'actions' | 'payouts'>('start');
  // v1.4.6 Money in flight (gated: never for new-two-wheeler-only dealers). Where it is on, today's LOAN credits live on
  // its card and the Payouts tile / block show dealer COMMISSION only; where it is off, Home keeps the old Payouts block.
  const mifOn = isMoneyInFlightEnabled(profile);
  const mifFiles = React.useMemo(() => mifFilesFor(session?.mobile, profile), [session?.mobile, profile]);
  const mifLocal = useMifLocal(dealerId);
  const mif = React.useMemo(() => mifTotals(mifFiles), [mifFiles]);
  const mifEvents = React.useMemo(() => mifAlerts(mifFiles), [mifFiles]);
  const openMoney = (p: RootStackParamList['MoneyInFlight']) => nav.navigate('MoneyInFlight', { ...p, at: Date.now() });
  // v1.4.7 alerts: live unread count on the bell (shared inbox per dealer id), and a Zippy nudge for unread alerts —
  // never inside quiet hours (IST, from the clock, not the phone's timezone).
  const alerts = useAlerts();
  const unreadAlerts = React.useMemo(() => unreadOf(alerts.events, alerts.inbox), [alerts.events, alerts.inbox]);
  const alertNudge = unreadAlerts.length && readoutAllowed(Date.now(), alerts.prefs.quiet)
    ? [{ id: 'alerts-unread', label: `${unreadAlerts.length} new alert${unreadAlerts.length === 1 ? '' : 's'}`, detail: unreadAlerts[0]!.title, actionLabel: 'Open alerts', onAction: () => nav.navigate('Alerts', { at: Date.now() }) }]
    : [];
  useZippyPending([...alertNudge, ...(mifOn ? mifEvents.map((e) => ({ id: e.id, label: e.title, detail: e.caption, actionLabel: e.tone === 'success' ? 'Open credit' : 'Show overdue', onAction: () => openMoney(e.tone === 'success' ? { lan: e.lan } : { filter: 'overdue' }) })) : [])]);
  // Only this dealer's products (a CV-only dealer never sees two-wheeler rows).
  // v1.4.9: today's applications / approvals / disbursals come from the SAME per-dealer list the voice status answers
  // use (services/loanStatus.ts), so "aaj kitne approve hue" always says what the Today tiles show.
  const statusFiles = React.useMemo(() => statusFilesFor(session?.mobile, profile), [session?.mobile, profile]);
  const statusToday = React.useMemo(() => (statusFiles.length ? todayCounts(statusFiles) : null), [statusFiles]);
  const statusRows = React.useMemo<RecentApp[]>(() => todayActivity(statusFiles).map((r) => ({
    id: r.id, when: `Today, ${fmtTime(r.at).replace(' ', '\u00A0')}`, status: r.status, amount: r.amount, product: r.product,
  })), [statusFiles]);
  const recent = data ? (statusToday ? statusRows : data.recent).filter((r) => categories.includes(r.product)) : null;
  const payouts = data ? data.payouts.filter((po) => categories.includes(po.product)) : null;
  const payoutsToday = payouts ? payouts.reduce((t, po) => t + po.amount, 0) : 0;
  // design-a (Proposal B): each tile leads with ONE live figure from the same source as the screen behind it.
  // No figure until its source has loaded (no fake "0" hero); a real zero (e.g. 0 pending RCs) is shown.
  const tiles = React.useMemo<Tile[]>(() => {
    const cs = cases.filter((c) => inRange(c.disbursedOn, range));
    const inv = invoices.filter((i) => inRange(i.date, range));
    const unclaimed = inv.filter((i) => i.status === 'Not claimed');
    const when = range.preset === 'thisMonth' ? 'this month' : range.preset === 'lastMonth' ? 'last month' : range.preset === 'last3Months' ? 'last 3 months' : 'in range';
    const toClaim = unclaimed.reduce((a, i) => a + i.amount, 0);
    const t: Tile[] = [
      // v1.4.6: with Money in flight the Payouts tile is dealer commission only (loan credits moved to the MIF card).
      mifOn
        ? { route: 'Payouts', label: 'Payouts', icon: 'payouts', color: colors.tileMustard, count: unclaimed.length,
          hero: inrShort(toClaim), heroNote: 'commission to claim', sub: `${unclaimed.length} invoice${unclaimed.length === 1 ? '' : 's'} not claimed`, sub2: advanceLine }
        : { route: 'Payouts', label: 'Payouts', icon: 'payouts', color: colors.tileMustard, count: unclaimed.length,
          hero: payouts ? inrShort(payoutsToday) : undefined, heroNote: 'credited today',
          sub: `${inrShort(toClaim)} to claim`, sub2: advanceLine },
      { route: 'Portfolio', label: 'Portfolio', icon: 'portfolio', color: colors.tileTeal, count: 0,
        hero: profile ? String(cs.filter((c) => c.pos > 0).length) : undefined, heroNote: 'active loans', sub: cap(when) },
      { route: 'Cases', label: 'Cases done', icon: 'cases', color: colors.tileNavy, count: 0,
        hero: profile ? String(cs.length) : undefined, heroNote: 'disbursed', sub: cap(when) },
      // The pending-RC count IS the hero figure (prominent), so no duplicate badge beside it.
      { route: 'RcPendency', label: 'RC pendency', icon: 'rc', color: colors.tileMaroon, count: 0,
        hero: String(rc.filter((c) => c.status === 'Pending').length), heroNote: 'pending' },
    ];
    if (profile?.hasTaInf && facility !== null) {
      const inf = profile.facilityType === 'INF';
      t.push({ route: 'TaInf', label: inf ? 'Inventory Funding' : 'Trade Advance', icon: inf ? 'inventoryFunding' : 'tradeAdvance', color: colors.primaryDark,
        count: facility ? facility.tranches.filter((x) => x.status === 'overdue').length : 0,
        hero: facility ? inrShort(availableOf(facility)) : undefined, heroNote: 'available', sub: facility ? undefined : 'Loading…',
        chip: facility ? (facility.enhancement ? 'Enhancement requested' : 'Enhance my limit') : undefined });
    } else if (profile) {
      // No TA / INF yet: the same route opens the "Avail a limit" comparison and apply flow. No facility numbers here.
      t.push({ route: 'TaInf', label: 'Get working capital', icon: 'workingCapital', color: colors.primaryDark, count: 0,
        sub: wcApp ? `Application submitted · ${wcApp.facility}` : 'Apply for Trade Advance or INF', chip: wcApp ? 'Pending' : undefined });
    }
    return t;
  }, [profile, cases, invoices, rc, range, advanceLine, facility, wcApp, payouts, payoutsToday, mifOn]);
  // Commission still to claim in the shared date range (the Payouts block when Money in flight is on).
  // v1.4.8 statement: the latest short-pay (danger caption on the Payouts card; opens that line).
  const payCard = React.useMemo(() => homePayoutCard(invoices), [invoices]);
  const commissionToClaim = React.useMemo(() => invoices.filter((i) => inRange(i.date, range) && i.status === 'Not claimed').reduce((a, i) => a + i.amount, 0), [invoices, range]);

  // Today's three figures come from ONE list (today's applications), so "Approved" can never be 0 next
  // to a non-zero "Disbursed": a disbursed loan was approved first.
  const today = recent && statusToday ? { apps: statusToday.apps, approved: statusToday.approved, disbursed: statusToday.disbursed } : recent ? {
    apps: recent.length,
    approved: recent.filter((r) => r.status !== 'PENDING').length,
    disbursed: recent.filter((r) => r.status === 'DISBURSED').reduce((t, r) => t + r.amount, 0),
  } : null;
  const fabBottom = Math.max(insets.bottom, space.sm) + space.xs;
  // The FAB zone is Home's "footer": floating Zippy rests above it (and its tip slot).
  const route = useRoute().name;
  useEffect(() => { reportFooterHeight(route, fabBottom + FAB_H); }, [route, fabBottom]);
  // v1.4.2: the bottom-right voice mic sits level with the 72 dp Scan QR disc (same centre line), 16 dp from the right.
  useVoiceMicAnchor(alignedMicBottom(fabBottom, 72));
  // v1.3.0: preview only the loan rows that sit fully above the Scan QR FAB on the first screen (1–3).
  const [viewH, setViewH] = useState(0);
  const [loansAt, setLoansAt] = useState({ section: 0, card: 0 });
  const loansTop = loansAt.section + loansAt.card;
  const fabTop = viewH - fabBottom - FAB_H;
  const previewRows = viewH && loansTop ? Math.max(1, Math.min(3, Math.floor((fabTop - space.xs - loansTop - 2) / LOAN_ROW_H))) : 2;
  // design-a P1: the whole Payouts card (credited-today amount, advance row, today's credit rows) must fit in the band
  // between the top of the scroller and the Scan QR FAB, so it can be scrolled fully clear of the FAB + label.
  // Measure the card's fixed part and one credit row; preview only as many credit rows (max 2) as fit.
  const [payHeadH, setPayHeadH] = useState(0);
  const [creditRowH, setCreditRowH] = useState(CREDIT_ROW_H);
  const payBand = fabTop - PAY_CLEAR - space.md * 2; // card padding top + bottom
  const creditRows = viewH && payHeadH ? Math.max(0, Math.min(2, Math.floor((payBand - payHeadH) / (creditRowH + space.sm)))) : 2;

  const load = useCallback(async () => {
    setError(false);
    try { setData(await fetchDealerHome()); } catch { setError(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const p = PRODUCTS[product];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* Header: the shared bank lockup (IDFC mark + one-line "IDFC FIRST Bank" + "» FIRSTgo"), Zippy's dock,
          bell, avatar → Profile & settings (v1.4.2: the voice mic is bottom-right, level with Scan QR). Only the lockup's text column shrinks; the trailing controls keep
          fixed boxes. A little extra top padding keeps the wordmark off the status bar / notch. */}
      {/* v1.3.0: the lockup has priority — compact 36dp mark, 16dp side padding, and every action is the same
          40dp circle in a 44pt box (dock slot reserved whether Zippy floats or is docked), so "IDFC FIRST Bank"
          fits in full at 360dp (the wordmark scales itself down a little if it must). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.xs, minHeight: 64 }}>
        <BrandLockup markSize={36} style={{ flex: 1, marginRight: space.xxs }} />
        <HeaderDockSlot />
        {/* v1.4.7: live unread count from the alerts inbox (was a static 2); opens the inbox. */}
        <BellBadge count={alerts.unread} onPress={() => nav.navigate('Alerts', { at: Date.now() })} />
        <PressableScale accessibilityRole="button" accessibilityLabel={`Profile and settings, ${session?.name ?? 'Dealer'}`} onPress={() => nav.navigate('Profile')} hitSlop={headerBtn.hitSlop} style={iconBtn}>
          <View style={{ width: headerBtn.disc, height: headerBtn.disc, borderRadius: headerBtn.disc / 2, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary }}>
            <Text variant="label" color={colors.primary} maxFontSizeMultiplier={fontScaleCap.control}>{initials(session?.name ?? 'Dealer')}</Text>
          </View>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter.screen, paddingTop: space.xs, gap: space.md, paddingBottom: fabBottom + FAB_H + Math.max(ZIPPY_SAFE_GUTTER, PAY_CLEAR) }}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onScroll={(e) => { sec.onScroll(e); scrollZippyAvoid(); }} scrollEventThrottle={64}
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
              {categories.length === 1 && <HeroChip icon={p.icon} label={PRODUCT_SHORT[product]} a11y={`${p.label} only`} />}
              {USED_VEHICLES_ENABLED && <HeroChip icon={condition === 'new' ? 'star-four-points-outline' : 'history'} label={CONDITION_LABEL[condition]} a11y={`${CONDITION_LABEL[condition]} vehicles`} />}
              {profile?.oem && profile.type !== 'multiBrand' && <HeroChip icon="factory" label={profile.oem.split(' ')[0]!} a11y={profile.oem} />}
            </View>
          )}
          <ZippyAvoid>
          <PressableScale accessibilityRole="button" accessibilityLabel="Search by the customer's registered mobile number" onPress={() => nav.navigate('SearchMobile', { stage: 'enter' })}
            style={[{ minHeight: touch.cta, borderRadius: radius.pill, backgroundColor: colors.cta, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.xs }, elevation.card as object]}>
            <Icon name="cellphone-text" size={22} color={colors.text} style={{ flexShrink: 0 }} />
            <ButtonLabel color={colors.text}>Search by mobile</ButtonLabel>
          </PressableScale>
          </ZippyAvoid>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
            <Icon name="qrcode-scan" size={16} color="rgba(255,255,255,0.85)" />
            <Text variant="caption" color="rgba(255,255,255,0.85)" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }}>or tap <Text variant="label" color={colors.onPrimary}>Scan QR</Text> below · fastest</Text>
          </View>
        </LinearGradient>
        </View>

        {/* Today */}
        <Section title="Today" onLayout={sec.at('today')}>
          {error ? <Card><ErrorState title="Couldn't load today's numbers" body="Pull down to refresh or try again." onRetry={load} /></Card> : (
            <ZippyAvoid style={{ flexDirection: 'row', gap: space.sm }}>
              {data && today ? (
                [[String(today.apps), 'Applied'], [String(today.approved), 'Approved'], [inrShort(today.disbursed), 'Disbursed']].map(([v, l]) => (
                  <Card key={l} style={{ flex: 1, minWidth: 0, padding: space.sm, paddingHorizontal: space.md, gap: space.xxs }}>
                    <Text variant="h2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={fontScaleCap.compact}>{v}</Text>
                    <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{l}</Text>
                  </Card>
                ))
              ) : [0, 1, 2].map((i) => <View key={i} style={{ flex: 1 }}><Skeleton h={68} r={radius.lg} /></View>)}
            </ZippyAvoid>
          )}
        </Section>

        {/* v1.4.6 Money in flight — after Today, before Loans (mockup 01-money-in-flight-home.png). Gated. */}
        {mifOn && (
          <View onLayout={sec.at('money')}>
            <HomeSummaryCard overline="Money in flight" loading={!data}
              onPress={() => openMoney({ filter: mif.overdueCount ? 'overdue' : 'all' })} onViewAll={() => openMoney({ filter: 'all' })}
              empty={!mif.inFlightCount && !mif.creditedRecentCount ? 'No loan money in flight. Sanctioned files appear here until they are credited to your account.' : undefined}
              hero={mif.inFlightCount ? `${inrShort(mif.inFlightAmount)} in flight · ${mif.inFlightCount} file${mif.inFlightCount === 1 ? '' : 's'}` : 'Nothing in flight'}
              lines={[
                mif.overdueCount ? { text: `${mif.overdueCount} overdue`, tone: 'overdue' } : { text: 'All on time', tone: 'calm' },
                ...(mif.stuckCount ? [{ text: `${mif.stuckCount} stuck`, tone: 'calm' } as SummaryLine] : []),
                ...(mif.creditedTodayAmount ? [{ text: `${inrShort(mif.creditedTodayAmount)} credited today`, tone: 'credited' } as SummaryLine] : []),
              ]}
              alert={mifEvents.filter((e) => e.tone === 'success').slice(0, 1).map((e) => (
                <AlertCard key={e.id} tone="success" title={e.title} caption={e.caption} onPress={() => openMoney({ lan: e.lan })} />
              ))[0]}
              rows={sortFiles(applyFilter(mifFiles, 'all')).slice(0, 2).map((f, i, arr) => (
                <InFlightRow key={f.lan} compact row={inFlightRowModel(f, !!mifLocal.rcUploaded[f.lan])} last={i === arr.length - 1} onPress={() => openMoney({ lan: f.lan })} />
              ))} />
          </View>
        )}

        {/* Loans */}
        <Section title="Loans" link="View all" onLink={() => nav.navigate('QuickList', { kind: 'loans' })}
          onLayout={(e) => { sec.at('loans')(e); const y = e.nativeEvent.layout.y; setLoansAt((a) => (a.section === y ? a : { ...a, section: y })); }}>
          <View onLayout={(e) => { const y = e.nativeEvent.layout.y; setLoansAt((a) => (a.card === y ? a : { ...a, card: y })); }}>
          <Card style={{ padding: 0 }}>
            {recent && recent.length === 0 ? (
              <EmptyState icon="file-document-plus-outline" title="No loans yet today"
                body={`Start one with Scan QR below, or search the customer's mobile number for a ${p.label.toLowerCase()} offer.`}
                action={{ label: 'Search by mobile number', icon: 'cellphone-text', onPress: () => nav.navigate('SearchMobile', { stage: 'enter' }) }} />
            ) : (recent ? recent.slice(0, previewRows) : Array.from({ length: Math.min(2, previewRows) }, () => null)).map((r, i, arr) => <LoanRow key={r?.id ?? i} app={r} last={i === arr.length - 1} />)}
          </Card>
          </View>
        </Section>

        {/* Actions — 2x2 coloured tiles with count badges */}
        <Section title="Actions" onLayout={sec.at('actions')}>
          <ZippyAvoid style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {(data ? tiles : [null, null, null, null]).map((a, i) => <ActionTile key={a?.route ?? i} action={a} onPress={() => a && nav.navigate(a.route as never)} />)}
          </ZippyAvoid>
          {/* v1.3.0: Help & tutorials — a slim row under the tiles (the 2x2 grid stays intact on a 360dp phone). */}
          <HelpRow onPress={() => nav.navigate('Help')} />
          {SHOW_DEV_UI && <Text variant="caption" color={colors.textSecondary}>Example data in Actions screens</Text>}
        </Section>

        {/* Payouts / disbursals (formerly the Pay tab) */}
        <Section title="Payouts" link="View all" onLink={() => nav.navigate('Payouts')} onLayout={sec.at('payouts')}>
          <Card style={{ gap: space.sm }}>
            {/* Fixed part of the card (amount + advance row + empty note), measured to fit the credit rows above the FAB. */}
            <View style={{ gap: space.sm }} onLayout={(e) => { const h = Math.ceil(e.nativeEvent.layout.height); setPayHeadH((v) => (v === h ? v : h)); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bank-transfer-in" size={24} color={colors.success} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ZippyAvoid style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><Text variant="caption" color={colors.textSecondary}>{mifOn ? 'Commission to claim · dealer payouts' : 'Credited today · settlement a/c ••4321'}</Text></ZippyAvoid>
                {data ? <ZippyAvoid style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><Text variant="display" color={colors.text} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={fontScaleCap.compact}>{inr(mifOn ? commissionToClaim : payoutsToday)}</Text></ZippyAvoid> : <Skeleton w={120} h={32} />}
              </View>
            </View>
            {/* Advance payout position, live from the shared advance store. */}
            <PressableScale onPress={() => nav.navigate('Payouts')} accessibilityRole="button"
              accessibilityLabel={`Advance payout: ${inr(advance.available)} available${advance.outstanding > 0 ? `, ${inr(advance.outstanding)} outstanding` : ''}. Open Payouts`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, minHeight: touch.min }}>
              <ZippyAvoid weight="soft"><Icon name="cash-fast" size={22} color={colors.primary} /></ZippyAvoid>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" numberOfLines={1}>Advance payout · {inrShort(advance.available)} available</Text>
                <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{advance.outstanding > 0 ? `${inr(advance.outstanding)} outstanding` : `Up to 3 × your monthly average`}</Text>
              </View>
              <ZippyAvoid><Icon name="chevron-right" size={22} color={colors.textSecondary} /></ZippyAvoid>
            </PressableScale>
            {payCard.caption && payCard.short ? (
              <PressableScale onPress={() => nav.navigate('Payouts', { invoice: payCard.short!.invoice, lan: payCard.short!.lan, at: Date.now() })} accessibilityRole="button"
                accessibilityLabel={`${payCard.caption}. ${payCard.short.customer}. Open the statement line`} style={{ minHeight: touch.min, justifyContent: 'center' }}>
                <Text variant="label" color={colors.danger}>{payCard.caption}</Text>
              </PressableScale>
            ) : null}
            {mifOn && (
              <Text variant="caption" color={colors.textSecondary}>Commission only. Loan amounts credited today are under Money in flight.</Text>
            )}
            {!mifOn && payouts && payouts.length === 0 && (
              <Text variant="caption" color={colors.textSecondary}>No credits yet today. Payouts land here minutes after each disbursal.</Text>
            )}
            </View>
            {(mifOn ? [] : payouts ?? []).slice(0, creditRows).map((po, i) => (
              <View key={po.utr} onLayout={i === 0 ? (e) => { const h = Math.ceil(e.nativeEvent.layout.height); setCreditRowH((v) => (v === h ? v : h)); } : undefined}
                style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.sm, gap: space.sm }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ZippyAvoid style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><Text variant="label" numberOfLines={1}>{inr(po.amount)} · {po.lan}</Text></ZippyAvoid>
                  <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{po.when}</Text>
                  {po.utr ? (
                    <ZippyAvoid style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
                    <PressableScale haptics={false} onPress={() => { void copyUtr(po.utr, utrToast.show); }} accessibilityRole="button" accessibilityLabel={`UTR ${po.utr}. Tap to copy`}
                      hitSlop={{ top: 8, bottom: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%' }}>
                      <Text variant="caption" color={colors.textSecondary} numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 1 }}>UTR {po.utr}</Text>
                      <Icon name="content-copy" size={14} color={colors.primary} />
                    </PressableScale>
                    </ZippyAvoid>
                  ) : null}
                </View>
                <ZippyAvoid><Pill label="Credited" tone="success" /></ZippyAvoid>
              </View>
            ))}
          </Card>
        </Section>

      </ScrollView>

      <LinearGradient pointerEvents="none" colors={['rgba(253,244,239,0)', colors.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: fabBottom + FAB_H }} />

      {/* Zippy's tip: anchored just above the Scan QR FAB, auto-dismisses. */}
      <ZippyTipSlot style={{ position: 'absolute', left: 0, right: 0, bottom: fabBottom + FAB_H + space.xs }} />

      {/* UTR copy toast: same dark style as JourneyScreen's toast, sitting above the Scan QR FAB. */}
      {utrToast.toast ? <ToastView text={utrToast.toast.text} tone={utrToast.toast.tone} side={gutter.screen} bottom={fabBottom + FAB_H + space.sm} /> : null}

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

const iconBtn = { width: headerBtn.box, height: headerBtn.box, flexShrink: 0, alignItems: 'center' as const, justifyContent: 'center' as const };

function Section({ title, link, onLink, children, onLayout }: { title: string; link?: string; onLink?: () => void; children: React.ReactNode; onLayout?: React.ComponentProps<typeof View>['onLayout'] }) {
  return (
    <View style={{ gap: space.xs }} onLayout={onLayout}>
      {/* v1.3.0: the link is an avoid-rect, so floating Zippy moves off it (no reserved right lane any more).
          Rows without a link drop the 48dp touch height to keep Home compact. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: link ? touch.min : 0 }}>
        <ZippyAvoid weight="soft" style={{ flexShrink: 1 }}>
          <Text variant="h2" accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{title}</Text>
        </ZippyAvoid>
        {link && (
          <ZippyAvoid style={{ flexShrink: 0 }}>
            <PressableScale onPress={onLink} accessibilityRole="link" accessibilityLabel={`${link} ${title}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: touch.min, paddingLeft: space.md }}>
              <Text variant="bodyStrong" color={colors.primary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control}>{link}</Text>
              <Icon name="chevron-right" size={20} color={colors.primary} />
            </PressableScale>
          </ZippyAvoid>
        )}
      </View>
      {children}
    </View>
  );
}

type Tile = {
  route: keyof RootStackParamList; label: string; icon: PhosphorName; color: string; count: number;
  /** The tile's one live figure (omitted while its source loads, or when it has none, e.g. Get working capital). */
  hero?: string; heroNote?: string; sub?: string; sub2?: string; chip?: string;
};

/**
 * design-a, Proposal B: a white card on the cream canvas (hairline border, soft card shadow). Ink title and
 * secondary caption on white; the tile's colour lives only in the 40dp icon well (Phosphor fill glyph, ink on
 * mustard / white on teal, navy, maroon, primaryDark — see wellGlyph). Count badge stays yellow with ink digits.
 */
function ActionTile({ action, onPress }: { action: Tile | null; onPress: () => void }) {
  if (!action) return <View style={{ width: '48%', flexGrow: 1 }}><Skeleton h={136} r={radius.lg} /></View>;
  const a11y = [action.label, action.hero ? `${action.hero} ${action.heroNote ?? ''}`.trim() : '', action.sub ?? '', action.sub2 ?? '',
    action.count ? `${action.count} pending` : '', action.chip ?? ''].filter(Boolean).join(', ');
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}
      style={[{ width: '48%', flexGrow: 1, minHeight: 136, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.xs }, elevation.card as object]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.xs }}>
        <IconWell name={action.icon} bg={action.color} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 }}>
          {action.chip ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, paddingHorizontal: space.xs, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: action.chip === 'Pending' ? colors.warningSoft : colors.primarySoft }}>
              <Icon name={action.chip === 'Enhance my limit' ? 'trending-up' : 'clock-outline'} size={14} color={action.chip === 'Pending' ? colors.warning : colors.primary} />
              <Text variant="caption" color={action.chip === 'Pending' ? colors.warning : colors.primary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }}>{action.chip}</Text>
            </View>
          ) : null}
          {action.count > 0 && (
            <View style={{ minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 7, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="label" color={colors.text} maxFontSizeMultiplier={fontScaleCap.control}>{action.count}</Text>
            </View>
          )}
        </View>
      </View>
      <View>
        <Text variant="bodyStrong" color={colors.text} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{action.label}</Text>
        {action.hero ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <Text variant="h1" color={colors.text} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={fontScaleCap.compact} style={{ fontVariant: ['tabular-nums'], flexShrink: 1 }}>{action.hero}</Text>
            {action.heroNote ? <Text variant="caption" color={colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }}>{action.heroNote}</Text> : null}
          </View>
        ) : null}
        {action.sub ? <Text variant="caption" color={colors.textSecondary} numberOfLines={action.hero ? 1 : 2}>{action.sub}</Text> : null}
        {action.sub2 ? <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{action.sub2}</Text> : null}
      </View>
    </PressableScale>
  );
}

/**
 * Help & tutorials entry: play glyph, title, one-line hint. Floating Zippy keeps off the title, hint and
 * chevron (hard) and only rests on the decorative play glyph if nothing else is free (soft).
 */
function HelpRow({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel="Help and tutorials. Short how-to videos for every step"
      style={[{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.sm, paddingRight: space.sm, paddingVertical: space.xs, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, elevation.card as object]}>
      <ZippyAvoid weight="soft">
        <IconWell name="help" bg={colors.aiUser} />
      </ZippyAvoid>
      <ZippyAvoid style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>Help & tutorials</Text>
          <Text variant="caption" color={colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>Short how-to videos for every step</Text>
        </View>
        <Icon name="chevron-right" size={22} color={colors.textSecondary} />
      </ZippyAvoid>
    </PressableScale>
  );
}

const STATUS_LABEL: Record<RecentApp['status'], string> = { DISBURSED: 'Disbursed', APPROVED: 'Approved', PENDING: 'Pending' };

function LoanRow({ app, last }: { app: RecentApp | null; last: boolean }) {
  const tone = app?.status === 'DISBURSED' ? 'success' : app?.status === 'APPROVED' ? 'info' : 'warning';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: LOAN_ROW_H, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      {app ? (
        <>
          <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={PRODUCTS[app.product].icon} size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={1}>{app.id}</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{inr(app.amount)} · {app.when}</Text>
          </View>
          <ZippyAvoid><Pill label={STATUS_LABEL[app.status]} tone={tone} /></ZippyAvoid>
        </>
      ) : (<><Skeleton w={40} h={40} r={radius.md} /><View style={{ flex: 1, gap: 6 }}><Skeleton w="50%" /><Skeleton w="70%" h={12} /></View><Skeleton w={72} h={20} /></>)}
    </View>
  );
}

/** Short hero title, no jargon; the product is in the pill / switch right under it. "used" only when enabled. */
function heroTitle(condition: Condition): string {
  return USED_VEHICLES_ENABLED && condition === 'used' ? 'New used-vehicle loan' : 'New loan';
}

function HeroChip({ icon, label, a11y }: { icon: IconName; label: string; a11y?: string }) {
  return (
    <View accessible accessibilityLabel={a11y ?? label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.16)' }}>
      <Icon name={icon} size={16} color={colors.onPrimary} />
      <Text variant="label" color={colors.onPrimary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }}>{label}</Text>
    </View>
  );
}
