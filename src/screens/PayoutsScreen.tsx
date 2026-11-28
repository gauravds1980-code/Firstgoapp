import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { JourneyScreen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { copyUtr, useToast } from '../components/Toast';
import { Chip, DateFilterBar, ExampleTag, inrShort } from '../components/business';
import { Banner, Button, Card, EmptyState, Icon, Pill, PressableScale, ReadOnlyRow, Text } from '../components/ui';
import { PayoutLineRow, QuerySheet, StatementSummaryCard, type PayoutLineRowModel } from '../components/library';
import { useSectionTracker, useZippyPending } from '../components/assistant/zippySection';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { claimInvoice, fmtDate, payoutMonths, TODAY, type Invoice, type PayoutLine } from '../services/business';
import { useApp } from '../state/AppState';
import {
  inRange, markInvoiceClaimed, presetRange, recordPayoutQuery, useAdvance, useDateRange, useInvoices, usePayoutQueries, type DateRange,
} from '../state/stores';
import { monthRange, rangeContaining } from '../services/period';
import {
  filterCounts, filterInvoices, findLine, invoiceFigures, lineFigures, lineKey, lineStatus, preselectPayoutReason, queryIsPrimary,
  STATEMENT_FILTERS, statementInvoicesFor, statementSummary, type StatementFilter,
} from '../services/payoutStatement';
import { PAYOUT_QUERY_REASONS, QUERY_QUEUES, queryTicketId } from '../services/queries';
import { AdvancePayoutCard } from '../components/AdvancePayout';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { setPayoutOpenLine } from '../voice/payoutVoice';
import { useVoiceStep } from '../voice/useAutoAdvance';
import { delay } from '../services/mock';
import { colors, radius, space, touch } from '../theme/tokens';
import { inr } from '../utils/finance';
import { haptic } from '../utils/haptics';

const ROUTE = 'Payouts';
const fmtDm = (d: Date) => fmtDate(d).slice(0, 6);
const lineAmount = (l: PayoutLine, inv: Invoice) => { const f = lineFigures(l, inv.status); return f.posted ? f.paid : f.expected; };

/**
 * v1.4.8 Feature 3 — Payouts = the dealer's COMMISSION statement (spec 03-payout-statement.md). Period (This month by
 * default, Last month, Last 3 months, Custom), status chips (All · Short paid · Ready to claim · 30+ days · Paid),
 * StatementSummaryCard (ready to claim / difference / all caught up; Expected · Paid · Difference), invoices with
 * PayoutLineRows (expected vs paid per file), the line sheet (deductions itemised, reason, UTR) and Raise a query
 * (payout-ops queue, PAY-…, Confirm before submit). Claim, the monthly chart and Advance payout stay. Download PDF is
 * visibly disabled. Loan credits never appear here (Money in flight).
 */
export default function PayoutsScreen() {
  const { profile, session } = useApp();
  const nav = useNavigation();
  const [range, setRange] = useDateRange();
  const dealerId = session?.dealerId ?? 'anon';
  const seed = useMemo(() => statementInvoicesFor(session?.mobile, profile), [session?.mobile, profile]);
  // Shared with the Home Payouts card: claims live in invoiceStore (persisted), not local state.
  const base = useInvoices(dealerId, seed);
  const queries = usePayoutQueries(dealerId);
  const [filter, setFilter] = useState<StatementFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ invoice: string; lan: string } | null>(null);
  const [mode, setMode] = useState<'detail' | 'query'>('detail');
  const toast = useToast(4500);
  const focused = useIsFocused();

  // Deep links: alerts (invoice / invoice + LAN) and voice (period / month / filter / line / query).
  const { params } = useRoute<RouteProp<RootStackParamList, 'Payouts'>>();
  useEffect(() => {
    if (!params) return;
    const inv = params.invoice ? base.find((i) => i.id === params.invoice) : undefined;
    let r: DateRange | null = null;
    if (params.period) r = presetRange(params.period);
    else if (params.month !== undefined) { const y = params.month > TODAY.getMonth() ? TODAY.getFullYear() - 1 : TODAY.getFullYear(); r = monthRange(y, params.month); }
    if (inv && (!r || !inRange(inv.date, r)) && !inRange(inv.date, range)) r = rangeContaining(inv.date);
    if (r) setRange(r);
    setFilter(params.filter ?? 'all');
    if (inv) {
      setOpen(inv.id);
      if (params.lan && inv.lines.some((l) => l.lan === params.lan)) { setSheet({ invoice: inv.id, lan: params.lan }); setMode(params.query ? 'query' : 'detail'); }
    }
  }, [params?.at, params?.invoice, params?.lan, params?.period, params?.month, params?.filter, params?.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const inPeriod = useMemo(() => base.filter((i) => inRange(i.date, range)), [base, range]);
  const summary = useMemo(() => statementSummary(base, range), [base, range]);
  const counts = useMemo(() => filterCounts(inPeriod), [inPeriod]);
  const shown = useMemo(() => filterInvoices(inPeriod, filter), [inPeriod, filter]);
  // Last three months; a bar is highlighted when its month overlaps the selected period.
  // Same month buckets as the Advance payout limit (payoutMonths), so the card and the bars always agree.
  const months = payoutMonths(base).map((m) => ({ ...m, on: m.start <= range.to && m.end >= range.from }));
  const advance = useAdvance(dealerId, base);
  const maxM = Math.max(1, ...months.map((m) => m.amt));

  // Line sheet (and the voice context: "is pe query daalo" / "is file ka payout kitna aaya").
  const hit = sheet ? findLine(base, sheet.invoice, sheet.lan) : null;
  const ticket = sheet ? queries[lineKey(sheet.invoice, sheet.lan)] : undefined;
  useEffect(() => { setPayoutOpenLine(focused && sheet ? sheet : null); }, [sheet, focused]);
  useEffect(() => () => setPayoutOpenLine(null), []);
  const openLine = (inv: Invoice, l: PayoutLine) => { haptic.select(); setMode('detail'); setSheet({ invoice: inv.id, lan: l.lan }); };
  const closeSheet = () => { setSheet(null); setMode('detail'); };

  const sec = useSectionTracker<'summary' | 'invoices'>('summary');
  useZippyPending([
    ...(summary.readyCount ? [{ id: 'claim', label: `${summary.readyCount} invoice${summary.readyCount === 1 ? '' : 's'} not claimed`, detail: `${inr(summary.readyToClaim)} waiting — claim to get paid.`, actionLabel: 'Show ready to claim', onAction: () => setFilter('ready') as void }] : []),
    ...(summary.shortCount ? [{ id: 'short', label: `${inr(summary.difference)} difference found`, detail: `${summary.shorts[0]!.customer} · ${summary.shorts[0]!.lan}`, actionLabel: 'Show short paid', onAction: () => setFilter('short') as void }] : []),
  ]);

  const claim = async (id: string) => {
    setBusy(id); const r = await claimInvoice(id); setBusy(null);
    if (r.ok) { haptic.success(); markInvoiceClaimed(dealerId, id, r.ref); }
  };

  const submitQuery = async (reason: { id: string; label: string }, note: string) => {
    if (!hit) throw new Error('no line');
    await delay(900);
    const ticketId = queryTicketId('payoutOps', hit.line.lan);
    recordPayoutQuery(dealerId, lineKey(hit.inv.id, hit.line.lan), { ticketId, reasonId: reason.id, reasonLabel: reason.label, ...(note ? { note } : {}), raisedAt: new Date().toISOString() });
    toast.show(`Query ${ticketId} sent to ${QUERY_QUEUES.payoutOps.to}.`);
    setMode('detail');
    return { ticketId };
  };

  // Voice "proceed" / "aage chaliye": on the line sheet = Raise a query when it is the primary action.
  const primaryQuery = hit ? queryIsPrimary(hit.inv, hit.line) && !ticket : false;
  const raiseRef = useRef(() => setMode('query'));
  useVoiceStep(!focused ? null : hit && mode === 'detail'
    ? (primaryQuery ? { route: ROUTE, sheet: 'payout-line', cta: { id: 'payout-raise-query', label: 'Raise a query', press: () => raiseRef.current() } } : { route: ROUTE, sheet: 'payout-line' })
    : { route: ROUTE, extra: { filter } });

  const heroTone = summary.hero.tone === 'neutral' ? 'neutral' : summary.hero.tone;
  const notes = [
    summary.deductionTotal ? `${inr(summary.deductionTotal)} itemised deductions (already taken off Expected; not a short payment).` : '',
    summary.rounding ? `${inr(summary.rounding)} rounding under ₹100 (not a short payment).` : '',
    summary.thirtyPlusCount ? `${summary.thirtyPlusCount} invoice${summary.thirtyPlusCount === 1 ? '' : 's'} unpaid for 30+ days (${inr(summary.thirtyPlusAmount)}).` : '',
  ].filter(Boolean);

  return (
    <JourneyScreen title="Payouts" titleInBody assistant="payouts" showTerms={false} onScroll={sec.onScroll} toast={toast.toast?.text} toastTone={toast.toast?.tone}>
      <View style={{ gap: space.xxs }} onLayout={sec.at('summary')}>
        <Text variant="h1">Payouts</Text>
        <Text variant="body" color={colors.textSecondary}>Commission statement · not the customer's loan</Text>
        <ExampleTag />
      </View>
      <DateFilterBar />
      <ZippyAvoid style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        {STATEMENT_FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} count={f.id === 'all' || counts[f.id] ? String(counts[f.id]) : undefined} on={filter === f.id} onPress={() => { haptic.select(); setFilter(f.id); }} />
        ))}
      </ZippyAvoid>

      <StatementSummaryCard period={summary.title} hero={summary.hero.text} heroTone={heroTone} caption={summary.caption} notes={notes}
        figures={[
          { label: 'Expected', value: inr(summary.expected) },
          { label: 'Paid', value: inr(summary.paid) },
          { label: 'Difference', value: inr(summary.difference), tone: summary.difference ? 'danger' : 'success' },
        ]} />
      {/* Approved: PDF / download stays visibly disabled (no expo-print / expo-sharing in this version). */}
      <View style={{ gap: 4 }}>
        <Button label="Download PDF statement" icon="file-pdf-box" variant="secondary" disabled accessibilityHint="PDF statement coming soon" />
        <Text variant="caption" color={colors.textSecondary}>PDF statement coming soon.</Text>
      </View>

      <View style={{ gap: space.sm }} onLayout={sec.at('invoices')}>
        {shown.length === 0 && (
          <Card>
            {inPeriod.length === 0 ? (
              <EmptyState icon="receipt-text-clock-outline" title="No payouts in this period."
                body="Invoices are raised weekly from your disbursed loans. Try last month, or say “pichhle mahine ka payout”."
                action={range.preset === 'thisMonth' ? { label: 'Show last month', icon: 'calendar-arrow-left', onPress: () => setRange(presetRange('lastMonth')) } : { label: 'Start a new loan', icon: 'qrcode-scan', onPress: () => nav.navigate('ScanQr') }} />
            ) : (
              <EmptyState icon="filter-variant-remove" title={`Nothing ${STATEMENT_FILTERS.find((f) => f.id === filter)!.label.toLowerCase()} in this period`}
                body={filter === 'short' ? 'No short payments: every posted payment matches its expected amount.' : 'Switch the filter to see the rest of the statement.'}
                action={{ label: 'Show all invoices', icon: 'filter-off-outline', onPress: () => setFilter('all') }} />
            )}
          </Card>
        )}
        {shown.map((inv, idx) => {
          const f = invoiceFigures(inv);
          const expanded = open === inv.id || filter === 'short';
          const headerAmount = inv.status === 'Paid' ? f.paid : f.expected;
          return (
            <Animated.View key={inv.id} entering={FadeInDown.delay(Math.min(idx, 6) * 50)} layout={LinearTransition.springify().damping(18)}>
              <Card style={{ gap: space.xs, padding: space.md }}>
                <PressableScale onPress={() => setOpen(open === inv.id ? null : inv.id)} accessibilityRole="button"
                  accessibilityLabel={`Invoice ${inv.id}, ${inr(headerAmount)}, ${inv.status}${f.shortCount ? ', short paid' : ''}${f.thirtyPlus ? ', 30+ days' : ''}. ${expanded ? 'Hide' : 'Show'} files`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>{inv.id}</Text>
                    <Text variant="caption" color={colors.textSecondary}>{fmtDm(inv.date)} · {inv.lines.length} file{inv.lines.length > 1 ? 's' : ''}{f.thirtyPlus ? ` · ${f.days} days` : ''}</Text>
                    {inv.utr ? (
                      // Nested press target: copying the UTR must not toggle the invoice (stop the parent press).
                      <PressableScale haptics={false} onPress={(e) => { e?.stopPropagation?.(); void copyUtr(inv.utr, toast.show); }}
                        accessibilityRole="button" accessibilityLabel={`UTR ${inv.utr}. Tap to copy`} hitSlop={{ top: 8, bottom: 8 }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%' }}>
                        <Text variant="caption" color={colors.textSecondary} numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 1 }}>UTR {inv.utr}</Text>
                        <Icon name="content-copy" size={14} color={colors.primary} />
                      </PressableScale>
                    ) : null}
                  </View>
                  <ZippyAvoid style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 }}>
                    <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <Text variant="h2" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>{inr(headerAmount)}</Text>
                      <Pill label={f.shortCount ? 'Short paid' : inv.status} tone={f.shortCount ? 'danger' : inv.status === 'Paid' ? 'success' : inv.status === 'Claimed' ? 'info' : 'warning'} />
                      {f.thirtyPlus ? <Pill label="30+ days" tone="warning" /> : null}
                    </View>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textSecondary} />
                  </ZippyAvoid>
                </PressableScale>
                {expanded && inv.lines.map((l, i) => (
                  <PayoutLineRow key={l.lan} row={rowModel(inv, l, queries[lineKey(inv.id, l.lan)]?.ticketId)} last={i === inv.lines.length - 1} onPress={() => openLine(inv, l)} />
                ))}
                {inv.status === 'Not claimed' && (
                  <ZippyAvoid>
                  {/* Busy = disabled: cool grey fill + dark-grey label (≥ 4.5:1), not a 50%-faded gold pill. */}
                  <PressableScale onPress={() => claim(inv.id)} disabled={busy === inv.id} dimDisabled={false} accessibilityRole="button" accessibilityLabel={`Claim ${inv.id}`}
                    style={{ minHeight: touch.min, borderRadius: radius.pill, backgroundColor: busy === inv.id ? colors.disabledBg : colors.cta, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
                    <Icon name={busy === inv.id ? 'loading' : 'hand-coin-outline'} size={18} color={busy === inv.id ? colors.onDisabled : colors.onCta} />
                    <Text variant="label" color={busy === inv.id ? colors.onDisabled : colors.onCta}>{busy === inv.id ? 'Claiming…' : 'Claim now'}</Text>
                  </PressableScale>
                  </ZippyAvoid>
                )}
              </Card>
            </Animated.View>
          );
        })}
      </View>

      {/* The whole chart (bars + their values) is an avoid-rect: Zippy never sits on the Nov bar or its amount. */}
      <ZippyAvoid>
      <Card style={{ gap: space.sm }}>
        <Text variant="label" color={colors.textSecondary}>MONTHLY PAYOUT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md, height: 110 }}>
          {months.map((m) => (
            <View key={m.label} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 4 }} accessibilityLabel={`${m.label}: ${inrShort(m.amt)}${m.on ? ', in the selected period' : ''}`}>
              <Text variant="caption" color={m.on ? colors.text : colors.textSecondary} numberOfLines={1}>{inrShort(m.amt)}</Text>
              <View style={{ width: '70%', height: Math.max(6, (m.amt / maxM) * 64), borderRadius: 8, backgroundColor: m.on ? colors.primary : colors.primarySoft }} />
              <Text variant="label" color={m.on ? colors.primary : colors.textSecondary}>{m.label}</Text>
            </View>
          ))}
        </View>
      </Card>
      </ZippyAvoid>

      <AdvancePayoutCard dealerId={dealerId} a={advance} account={`${session?.name ?? 'Dealer'} · IDFC FIRST ••4321`} />

      <Sheet visible={!!hit && mode === 'detail'} onClose={closeSheet} title={hit?.line.customer ?? ''} subtitle={hit ? `${hit.line.lan}${hit.line.vehicle ? ` · ${hit.line.vehicle}` : ''}` : undefined}
        footer={hit ? (
          ticket ? <Button label="Close" variant="secondary" onPress={closeSheet} />
            : <Button label="Raise a query" variant={primaryQuery ? 'primary' : 'secondary'} onPress={() => { haptic.select(); setMode('query'); }} />
        ) : undefined}>
        {hit && <LineDetail inv={hit.inv} line={hit.line} ticket={ticket} onCopyUtr={() => { void copyUtr(hit.inv.utr, toast.show); }} />}
      </Sheet>

      <QuerySheet visible={!!hit && mode === 'query'} onClose={() => setMode('detail')} voiceRoute={ROUTE} queue="payoutOps"
        subject={hit ? `${hit.line.customer} · ${hit.line.lan} · ${hit.inv.id}` : ''} reasons={PAYOUT_QUERY_REASONS}
        preselect={hit ? preselectPayoutReason(hit.inv, hit.line) : undefined} openTicket={ticket?.ticketId} onSubmit={submitQuery} />
    </JourneyScreen>
  );
}

/** One statement line as a PayoutLineRow model (figures and tones only from the statement fields). */
function rowModel(inv: Invoice, l: PayoutLine, ticketId?: string): PayoutLineRowModel {
  const f = lineFigures(l, inv.status);
  const st = lineStatus(f, inv.status);
  const notes = [
    f.deductionTotal ? `${inr(f.deductionTotal)} ${f.deductions.map((d) => d.label.toLowerCase()).join(', ')} deducted` : '',
    f.rounding ? `${inr(f.rounding)} rounding` : '',
    f.shortPaid ? `${inr(f.difference)} difference found · ${f.reason ?? 'Reason not given'}` : '',
    ticketId ? `Query ${ticketId} open` : '',
  ].filter(Boolean);
  return {
    key: l.lan, customer: l.customer, vehicle: l.vehicle, lan: l.lan, product: l.product,
    amount: inr(lineAmount(l, inv)), amountTone: f.shortPaid ? 'danger' : 'neutral',
    figures: f.posted ? `Exp ${inr(f.expected)} · Paid ${inr(f.paid)}` : `Exp ${inr(f.expected)} · ${inv.status === 'Claimed' ? 'Claimed, not paid yet' : 'Not claimed'}`,
    figuresTone: f.shortPaid ? 'danger' : f.posted ? 'success' : 'caption',
    status: st, ...(notes.length ? { note: notes.join(' · '), noteTone: f.shortPaid ? 'danger' : 'caption' } : {}),
  };
}

/** Line sheet body (spec §d.2): fields as received; deductions itemised; reason; invoice, UTR; open query. */
function LineDetail({ inv, line, ticket, onCopyUtr }: { inv: Invoice; line: PayoutLine; ticket?: { ticketId: string; raisedAt: string }; onCopyUtr: () => void }) {
  const f = lineFigures(line, inv.status);
  const fig = invoiceFigures(inv);
  return (
    <>
      <View>
        <ReadOnlyRow label="Loan amount" value={inr(line.loan)} />
        <ReadOnlyRow label="Payout rate" value={`${line.ratePct}%`} />
        {f.deductionTotal ? <ReadOnlyRow label="Commission before deductions" value={inr(f.gross)} /> : null}
        {f.deductions.map((d) => <ReadOnlyRow key={d.label} label={d.label} value={`− ${inr(d.amount)}`} />)}
        <ReadOnlyRow label="Expected" value={inr(f.expected)} strong />
        <ReadOnlyRow label="Paid" value={f.posted ? inr(f.paid) : '₹0 · not paid yet'} />
        {f.posted ? <ReadOnlyRow label="Difference" value={f.shortPaid ? inr(f.difference) : f.rounding ? `${inr(f.rounding)} rounding` : '₹0 · matched'} /> : null}
        {f.shortPaid ? <ReadOnlyRow label="Reason" value={f.reason ?? 'Reason not given'} /> : null}
        <ReadOnlyRow label="Invoice" value={`${inv.id} · ${fmtDm(inv.date)}`} />
        <ReadOnlyRow label="Status" value={`${inv.status}${fig.thirtyPlus ? ` · ${fig.days} days` : ''}`} />
        {inv.paidOn ? <ReadOnlyRow label="Paid on" value={fmtDate(inv.paidOn)} /> : null}
      </View>
      {inv.utr ? (
        <PressableScale onPress={onCopyUtr} haptics={false} accessibilityRole="button" accessibilityLabel={`UTR ${inv.utr}. Tap to copy`} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text variant="label" color={colors.primary}>UTR {inv.utr} · tap to copy</Text>
        </PressableScale>
      ) : null}
      {f.shortPaid ? (
        <>
          <Banner tone="danger" icon="alert-circle-outline" title={`${inr(f.difference)} difference found`} body={`${f.reason ?? 'Reason not given'} on this line`} />
          <Text variant="body">Raise a query if this was not expected. It goes to payout operations.</Text>
        </>
      ) : f.deductionTotal && f.posted ? (
        <Banner tone="info" title="Matched after itemised deductions" body={`${f.deductions.map((d) => `${d.label} ${inr(d.amount)}`).join(', ')} was taken off by the payout system. Not a short payment.`} />
      ) : f.rounding ? (
        <Text variant="caption" color={colors.textSecondary}>{inr(f.rounding)} rounding (under ₹100) is not flagged as a short payment.</Text>
      ) : fig.thirtyPlus ? (
        <Banner tone="warning" title={`Unpaid for ${fig.days} days`} body="Not a short payment: nothing has been paid on this invoice yet. Raise a query if it is late." />
      ) : null}
      {ticket && <Banner tone="info" icon="ticket-outline" title={`Query ${ticket.ticketId} open`} body="Payout operations will reply in the app." />}
      <Text variant="caption" color={colors.textSecondary}>Statement of payouts, not a tax invoice · Example data</Text>
    </>
  );
}
