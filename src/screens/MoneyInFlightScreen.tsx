import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { RouteProp, useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { Chip, ExampleTag, inrShort, StatCard } from '../components/business';
import { Banner, Button, Card, EmptyState, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { copyUtr, useToast } from '../components/Toast';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { AgeingPill, InFlightRow, QuerySheet, SearchBar, StageChip, Timeline, type InFlightRowModel, type TimelineItem } from '../components/library';
import { SHOW_DEV_UI } from '../config/devFlags';
import type { RootStackParamList } from '../navigation/types';
import { delay } from '../services/mock';
import {
  ageingOf, applyFilter, BLOCKERS, creditMismatch, daysInStage, effectiveBlocker, filterCounts, fmtTime, fmtWhen, isMoneyInFlightEnabled, MifFile,
  MifFilter, mifFilesFor, MIF_FILTERS, mifTotals, preselectReason, QUERY_REASONS, searchFiles, SETTLEMENT_MASK, sheetCtas, sortFiles, STAGE_LABEL,
  ticketIdFor, type SheetCta,
} from '../services/moneyInFlight';
import { useApp } from '../state/AppState';
import { recordMifQuery, recordMifRcUpload, useMifLocal } from '../state/stores';
import { AGEING_LABEL, ageingBannerTone, MIF_STAGES } from '../theme/library';
import { colors, space } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { inr, maskMobile } from '../utils/finance';
import { customerOptions } from '../voice/customerMatch';
import { setMifVoiceContext } from '../voice/moneyVoice';
import { useVoiceStep } from '../voice/useAutoAdvance';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';
import { clearVoiceOptions, setVoiceOptions } from '../voice/voiceOptions';
import { useUndoSource } from '../voice/voiceUndo';

const ROUTE = 'MoneyInFlight';
const MIN = 60_000;
const model = (f: MifFile) => f.vehicle.replace(/\s*\(.*\)$/, '');

/** Row view model for the shared InFlightRow (list + Home preview use the same mapping). */
export function inFlightRowModel(f: MifFile, rcUploaded?: boolean): InFlightRowModel {
  const b = effectiveBlocker(f, rcUploaded);
  return {
    key: f.lan, customer: f.customer, vehicle: model(f), lan: f.lan, product: f.product, amount: inr(f.sanctioned), stage: f.stage,
    ...(f.stage === 'credited'
      ? { note: f.credited ? `Credited ${fmtWhen(f.credited.at).replace(/^(\w+),/, (_m, d: string) => d.toLowerCase() + ',')}` : undefined }
      : { blocker: b ? BLOCKERS[b].label : undefined, days: daysInStage(f) }),
  };
}

/**
 * v1.4.6 Feature 1 — Money in flight (spec 01-money-in-flight.md, approved 28 Nov 2026). Every sanctioned file until the
 * loan amount is credited to the dealer's settlement account: stage, named blocker, ageing; credited files stay 3 days.
 * Rows open a case sheet (tap or "open Pooja Iyer"); the sheet's primary CTA is the dealer's fix when it is his, else
 * Raise a query (QuerySheet, explicit Confirm). Gated: new-two-wheeler-only dealers see a polite not-available state.
 */
export default function MoneyInFlightScreen() {
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'MoneyInFlight'>>();
  const { profile, session } = useApp();
  const enabled = isMoneyInFlightEnabled(profile);
  const dealerId = session?.dealerId ?? 'anon';
  const files = useMemo(() => mifFilesFor(session?.mobile, profile), [session?.mobile, profile]);
  const local = useMifLocal(dealerId);
  const [filter, setFilter] = useState<MifFilter>('all');
  const [query, setQuery] = useState('');
  const [openLan, setOpenLan] = useState<string | null>(null);
  const [mode, setMode] = useState<'detail' | 'query'>('detail');
  const [busy, setBusy] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const toast = useToast();
  // Freshness: the mock feed was "updated 4 min ago"; pull to refresh stamps now. A dev switch makes one refresh fail.
  const [updatedAt, setUpdatedAt] = useState(() => Date.now() - 4 * MIN);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const failNext = useRef(false);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(i); }, []);
  const ago = Math.max(0, Math.round((Date.now() - updatedAt) / MIN));
  const updatedLabel = ago === 0 ? 'Updated just now' : `Updated ${ago} min ago`;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await delay(700);
    if (failNext.current) { failNext.current = false; setStale(true); haptic.error(); } else { setStale(false); setUpdatedAt(Date.now()); }
    setRefreshing(false);
  }, []);

  const totals = useMemo(() => mifTotals(files), [files]);
  const counts = useMemo(() => filterCounts(files), [files]);
  const shown = useMemo(() => {
    const base = query.trim() ? searchFiles(files, query) : applyFilter(files, filter);
    const inFilter = query.trim() && filter !== 'all' ? base.filter((f) => applyFilter(files, filter).includes(f)) : base;
    return sortFiles(inFilter);
  }, [files, filter, query]);
  const open = files.find((f) => f.lan === openLan) ?? null;

  // Route params: Home card / alert / voice ("Ramesh ka paisa aaya?" → lan, "kaunsi file atki hai" → stuck).
  useEffect(() => {
    if (!params) return;
    if (params.filter) setFilter(params.filter);
    setQuery(params.q ?? '');
    if (params.q && !params.filter) setFilter('all');
    if (params.lan && files.some((f) => f.lan === params.lan)) {
      setShowAccount(false);
      setOpenLan(params.lan);
      setMode(params.query ? 'query' : 'detail');
    } else if (params.filter || params.q !== undefined) {
      setOpenLan(null);
    }
  }, [params?.at, params?.filter, params?.lan, params?.q, params?.query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Voice: the open file (for "is file pe query raise karo"), rows as customer options ("open Pooja Iyer"), Undo.
  const focused = useIsFocused();
  useEffect(() => { setMifVoiceContext({ openLan: focused ? openLan : null }); }, [openLan, focused]);
  useEffect(() => () => setMifVoiceContext({ openLan: null }), []);
  useFocusEffect(useCallback(() => {
    const token = setVoiceOptions(customerOptions(shown, (f) => ({ lan: f.lan, name: f.customer, vehicle: model(f) })), ROUTE);
    return () => clearVoiceOptions(token);
  }, [shown]));
  const draft = useVoiceDraft();
  useEffect(() => {
    if (!focused || !draft?.slots.customerLan) return;
    const want = voiceDraft.take('customerLan');
    if (want && files.some((f) => f.lan === want)) { haptic.select(); setMode('detail'); setShowAccount(false); setOpenLan(want); }
  }, [draft, focused, files]);
  useUndoSource<string | null>('customer', () => openLan, (v) => { setMode('detail'); setOpenLan(v); }, focused);

  // Zippy: overdue nudge (in-app only, from the same files as the list).
  const overdue = useMemo(() => sortFiles(applyFilter(files, 'overdue')), [files]);
  useSectionTracker('list');
  useZippyPending(enabled && overdue.length ? [{
    id: 'mif-overdue', label: `${overdue.length} file${overdue.length === 1 ? '' : 's'} overdue`,
    detail: `Oldest is ${overdue[0]!.customer.split(' ')[0]}, ${overdue[0]!.blocker ? BLOCKERS[overdue[0]!.blocker].label : STAGE_LABEL[overdue[0]!.stage]}, ${daysInStage(overdue[0]!)} days.`,
    actionLabel: 'Show overdue', onAction: () => { setQuery(''); setFilter('overdue'); },
  }] : []);

  const openFile = (lan: string) => { haptic.select(); setShowAccount(false); setMode('detail'); setOpenLan(lan); };
  const closeSheet = () => { setOpenLan(null); setMode('detail'); };

  const ctas = open ? sheetCtas(open, { rcUploaded: !!local.rcUploaded[open.lan] }) : { primary: null, secondary: null };
  const ticket = open ? local.queries[open.lan] : undefined;
  const runCta = async (c: SheetCta) => {
    if (!open) return;
    if (c.kind === 'query') { setMode('query'); return; }
    if (c.kind === 'remindCustomer') { haptic.success(); toast.show(`Reminder sent to ${maskMobile(open.mobile)}`); return; }
    if (c.kind === 'viewAccount') { haptic.select(); setShowAccount((v) => !v); return; }
    if (c.kind === 'uploadRc') {
      setBusy(open.lan);
      await delay(900);
      recordMifRcUpload(dealerId, open.lan);
      setBusy(null);
      haptic.success();
      toast.show(`RC copy uploaded for ${open.customer}. The bank will check it.`);
    }
  };
  const runRef = useRef(runCta);
  runRef.current = runCta;

  // Voice "proceed" / "aage chaliye": on the sheet = its primary CTA; on the list = open the most urgent visible row.
  const sheetVisible = !!open && mode === 'detail' && focused;
  useVoiceStep(!focused || !enabled ? null : sheetVisible
    ? (ctas.primary ? { route: ROUTE, sheet: 'mif-case', extra: { customer: { name: open!.customer, lan: open!.lan } }, cta: { id: `mif-${ctas.primary.kind}`, label: ctas.primary.label, press: () => { void runRef.current(ctas.primary!); } } } : { route: ROUTE, sheet: 'mif-case' })
    : mode === 'detail' && shown[0] ? { route: ROUTE, extra: { filter }, cta: { id: 'mif-open-first', label: `Open ${shown[0].customer}`, press: () => openFile(shown[0]!.lan) } } : { route: ROUTE, extra: { filter } });

  const submitQuery = async (reason: { id: string; label: string }, note: string) => {
    if (!open) throw new Error('no file');
    await delay(900);
    const n = Object.keys(local.queries).filter((l) => l === open.lan).length + 1;
    const ticketId = ticketIdFor(open.lan, n);
    recordMifQuery(dealerId, open.lan, { ticketId, reasonId: reason.id, reasonLabel: reason.label, ...(note ? { note } : {}), raisedAt: new Date().toISOString() });
    toast.show(`Query ${ticketId} sent to your RM.`);
    setMode('detail');
    return { ticketId };
  };

  if (!enabled) {
    return (
      <JourneyScreen title="Money in flight" titleInBody assistant="money" showTerms={false}>
        <View style={{ gap: space.xxs }}>
          <Text variant="h1">Money in flight</Text>
          <Text variant="body" color={colors.textSecondary}>Loan amounts from sanction to your account</Text>
        </View>
        <Card>
          <EmptyState icon="bank-transfer-in" title="Not available for your dealership yet"
            body="Money in flight covers used two-wheeler, car and commercial vehicle loans. Your loan credits stay on Home and Payouts as before."
            action={{ label: 'Go to Home', icon: 'home-outline', onPress: () => nav.navigate('Home') }} />
        </Card>
      </JourneyScreen>
    );
  }

  return (
    <JourneyScreen title="Money in flight" titleInBody assistant="money" showTerms={false} toast={toast.toast?.text} toastTone={toast.toast?.tone}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">Money in flight</Text>
        <Text variant="body" color={colors.textSecondary}>Loan amounts from sanction to your account</Text>
        <ExampleTag />
        <Text variant="caption" color={colors.textSecondary}>This is the customer's loan, not your dealer payout. Payouts stay on Payouts.</Text>
      </View>

      <View style={{ gap: space.xs }}>
        <ZippyAvoid style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <StatCard compact label="In flight" value={inrShort(totals.inFlightAmount)} sub={`${totals.inFlightCount} file${totals.inFlightCount === 1 ? '' : 's'}`} />
          <StatCard compact label="Overdue" value={String(totals.overdueCount)} tone={totals.overdueCount ? colors.danger : colors.text} sub={totals.overdueCount ? 'need action' : 'all on time'} />
          <StatCard compact label="Credited today" value={inrShort(totals.creditedTodayAmount)} tone={totals.creditedTodayAmount ? colors.success : colors.text} sub={`${totals.creditedTodayCount} file${totals.creditedTodayCount === 1 ? '' : 's'}`} />
        </ZippyAvoid>
        <Text variant="caption" color={colors.textSecondary}>{updatedLabel}</Text>
      </View>

      {stale && (
        <View style={{ gap: space.xs }}>
          <Banner tone="warning" title="Couldn't refresh" body={`Showing figures from ${fmtTime(new Date(updatedAt)).replace(' ', ' ')}. Credited ticks are from that time.`} />
          <Button label="Retry" icon="refresh" variant="secondary" loading={refreshing} onPress={refresh} />
        </View>
      )}

      <View style={{ gap: space.sm }}>
        <SearchBar value={query} onChange={setQuery} />
        <ZippyAvoid style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {MIF_FILTERS.map((c) => (
            <Chip key={c.id} label={c.label} count={String(counts[c.id])} on={filter === c.id} onPress={() => { haptic.select(); setFilter(c.id); }} />
          ))}
        </ZippyAvoid>
      </View>

      <Card style={{ padding: 0 }}>
        {files.length === 0 ? (
          <EmptyState icon="file-document-plus-outline" title="No loan money in flight"
            body="Sanctioned files appear here until they are credited to your account." action={{ label: 'Start a new loan', icon: 'qrcode-scan', onPress: () => nav.navigate('ScanQr') }} />
        ) : shown.length === 0 ? (
          <EmptyState icon="filter-remove-outline" title={query.trim() ? `No file matches “${query.trim()}”` : 'Nothing in this filter'}
            body={query.trim() ? 'Search by first or last name, the 10-digit mobile or its last 4 digits.' : 'Files move here as their stage changes.'}
            action={{ label: 'Show all in flight', icon: 'format-list-bulleted', onPress: () => { setQuery(''); setFilter('all'); } }} />
        ) : shown.map((f, i) => (
          <InFlightRow key={f.lan} row={inFlightRowModel(f, !!local.rcUploaded[f.lan])} onPress={() => openFile(f.lan)} last={i === shown.length - 1} />
        ))}
      </Card>
      {SHOW_DEV_UI && (
        <PressableScale onPress={() => { failNext.current = true; toast.show('Next refresh will fail (demo)', 'error'); }} accessibilityRole="button" accessibilityLabel="Simulate a failed refresh">
          <Text variant="caption" color={colors.textMuted}>Demo: simulate a failed refresh</Text>
        </PressableScale>
      )}

      <Sheet visible={!!open && mode === 'detail'} onClose={closeSheet} title={open?.customer ?? ''} subtitle={open ? `${open.lan} · ${open.vehicle}` : undefined}
        footer={open && (ctas.primary || ctas.secondary) ? (
          <>
            {ctas.primary && <Button label={ctas.primary.label} loading={busy === open.lan} onPress={() => runCta(ctas.primary!)} />}
            {ctas.secondary && <Button label={ctas.secondary.label} variant="secondary" onPress={() => runCta(ctas.secondary!)} />}
          </>
        ) : undefined}>
        {open && <CaseDetail f={open} rcUploaded={!!local.rcUploaded[open.lan]} ticket={ticket} showAccount={showAccount} updatedLabel={updatedLabel}
          onCopyUtr={() => { void copyUtr(open.credited?.utr, toast.show); }} />}
      </Sheet>

      <QuerySheet visible={!!open && mode === 'query'} onClose={() => setMode('detail')} voiceRoute={ROUTE}
        subject={open ? `${open.customer} · ${open.lan} · ${model(open)}` : ''} reasons={QUERY_REASONS}
        preselect={open ? preselectReason(open) : undefined} openTicket={ticket?.ticketId} onSubmit={submitQuery} />
    </JourneyScreen>
  );
}

/** Case sheet body: amounts, stage banner, what the dealer can do, timeline (spec §c "Case detail sheet"). */
function CaseDetail({ f, rcUploaded, ticket, showAccount, updatedLabel, onCopyUtr }: {
  f: MifFile; rcUploaded: boolean; ticket?: { ticketId: string; raisedAt: string }; showAccount: boolean; updatedLabel: string; onCopyUtr: () => void;
}) {
  const b = effectiveBlocker(f, rcUploaded);
  const meta = b ? BLOCKERS[b] : null;
  const band = ageingOf(f);
  const days = daysInStage(f);
  const cur = MIF_STAGES.indexOf(f.stage);
  const items: TimelineItem[] = MIF_STAGES.map((st, i) => {
    const ev = f.history.find((h) => h.stage === st);
    const state = f.stage === 'credited' ? 'done' : i < cur ? 'done' : i === cur ? 'current' : 'future';
    return {
      key: st, title: STAGE_LABEL[st], state, ...(ev ? { time: fmtWhen(ev.at).replace(/^Today, /, '') } : {}),
      ...(i === cur && meta && f.stage !== 'credited' ? { detail: meta.label, detailTone: band === 'overdue' ? colors.danger : colors.textSecondary } : {}),
      ...(st === 'credited' && f.credited ? { detail: `UTR ${f.credited.utr}` } : {}),
    };
  });
  return (
    <>
      <View>
        <ReadOnlyRow label="Sanctioned amount" value={inr(f.sanctioned)} />
        {f.credited ? <ReadOnlyRow label="Credited to your account" value={inr(f.credited.amount)} strong /> : <ReadOnlyRow label="Expected in your account" value={inr(f.expectedNet)} strong />}
        {f.credited && creditMismatch(f) ? <ReadOnlyRow label="Expected" value={inr(f.expectedNet)} /> : null}
        <ReadOnlyRow label="Settlement a/c" value={SETTLEMENT_MASK} />
        <ReadOnlyRow label="Mobile" value={maskMobile(f.mobile)} />
      </View>

      {f.credited ? (
        <>
          <Banner tone="success" title={`Credited to dealer · ${inr(f.credited.amount)}`} body={`${fmtWhen(f.credited.at).replace(' ', ' ')} · settlement a/c ${SETTLEMENT_MASK}`} />
          {creditMismatch(f) && <Banner tone="warning" title={`Credited ${inr(f.credited.amount)}, expected ${inr(f.expectedNet)}`} body="Raise a query so your RM can check the difference." />}
          <PressableScale onPress={onCopyUtr} haptics={false} accessibilityRole="button" accessibilityLabel={`UTR ${f.credited.utr}. Tap to copy`} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text variant="label" color={colors.primary}>UTR {f.credited.utr} · tap to copy</Text>
          </PressableScale>
        </>
      ) : (
        <>
          <Banner tone={band ? ageingBannerTone[band] : 'info'} title={`${STAGE_LABEL[f.stage]}${meta ? ` · ${meta.label}` : ''}`}
            body={`${band ? AGEING_LABEL[band] : ''} · ${days === 0 ? 'entered this stage today' : `${days} day${days === 1 ? '' : 's'} in this stage`}`} />
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
            <StageChip stage={f.stage} />
            <AgeingPill days={days} showDays />
          </View>
          {meta && (
            <View style={{ gap: 2 }}>
              <Text variant="label">{meta.owner === 'dealer' ? 'What you can do' : meta.owner === 'customer' ? 'Waiting for the customer' : 'With the bank'}</Text>
              <Text variant="body">{meta.help}</Text>
            </View>
          )}
        </>
      )}
      {showAccount && <Banner tone="info" icon="bank-outline" title={`Settlement account ${SETTLEMENT_MASK} · IDFC FIRST Bank`} body="Read-only. To change the account the bank pays into, speak to your RM." />}
      {ticket && <Banner tone="info" icon="ticket-outline" title={`Query ${ticket.ticketId} raised ${fmtWhen(new Date(ticket.raisedAt), new Date()).replace(/^Today/, 'today').replace(' ', ' ')}`} body="Your RM will reply in the app." />}
      <Timeline items={items} />
      <Text variant="caption" color={colors.textSecondary}>{updatedLabel} · Example data</Text>
    </>
  );
}
