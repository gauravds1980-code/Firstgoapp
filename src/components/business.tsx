import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { colors, elevation, fontScaleCap, radius, space, touch } from '../theme/tokens';
import { DateRange, Preset, presetRange, rangeLabel, useDateRange } from '../state/stores';
import { TODAY } from '../services/business';
import { inr } from '../utils/finance';
import { Sheet } from './Sheet';
import { ZippyAvoid } from './assistant/zippyAvoid';
import { SHOW_DEV_UI } from '../config/devFlags';
import { Button, Icon, IconName, PressableScale, Text } from './ui';

/** "Example data" chip — tester-only, hidden in release builds (SHOW_DEV_UI). */
export function ExampleTag() {
  if (!SHOW_DEV_UI) return null;
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.ctaTint }}>
      <Icon name="flask-outline" size={14} color={colors.ctaDark} />
      <Text variant="label" color={colors.ctaDark} maxFontSizeMultiplier={fontScaleCap.compact}>Example data</Text>
    </View>
  );
}

/** Filter chip. `compact` tightens the side padding so a row of three fits one line at 360dp. */
export function Chip({ label, on, onPress, icon, count, compact }: { label: string; on: boolean; onPress: () => void; icon?: IconName; count?: string; compact?: boolean }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label}
      style={{ minHeight: 40, paddingHorizontal: compact ? space.sm : space.md, paddingVertical: space.xxs, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
      {icon ? <Icon name={icon} size={16} color={on ? colors.onPrimary : colors.textSecondary} /> : null}
      <Text variant="label" color={on ? colors.onPrimary : colors.text} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1, textAlign: 'center' }}>{label}</Text>
      {count ? <Text variant="label" color={on ? 'rgba(255,255,255,0.8)' : colors.textSecondary} maxFontSizeMultiplier={fontScaleCap.compact}>{count}</Text> : null}
    </PressableScale>
  );
}

/**
 * Shared date filter (This month / Last month / Custom) used by Payouts, Portfolio and Cases.
 * v1.3.0: the three chips stay on ONE row (compact padding; scrolls sideways at large font sizes
 * instead of wrapping "Custom" onto its own line).
 */
export function DateFilterBar() {
  const [range, setRange] = useDateRange();
  const [open, setOpen] = useState(false);
  const pick = (p: Preset) => (p === 'custom' ? setOpen(true) : setRange(presetRange(p)));
  return (
    <View style={{ gap: space.xs }}>
      {/* The chip row is an avoid-rect: floating Zippy never covers a chip ("Custom" stays readable). */}
      <ZippyAvoid>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: space.xs }}>
          <Chip compact label="This month" on={range.preset === 'thisMonth'} onPress={() => pick('thisMonth')} />
          <Chip compact label="Last month" on={range.preset === 'lastMonth'} onPress={() => pick('lastMonth')} />
          <Chip compact label="Custom" icon="calendar-range" on={range.preset === 'custom'} onPress={() => pick('custom')} />
        </ScrollView>
      </ZippyAvoid>
      <Text variant="caption" color={colors.textSecondary}>{rangeLabel(range)}</Text>
      <DateRangeSheet visible={open} initial={range} onClose={() => setOpen(false)} onApply={(r) => { setRange(r); setOpen(false); }} />
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clampDay = (y: number, m: number, d: number) => Math.min(d, new Date(y, m + 1, 0).getDate());

/** From/To month + day steppers — pure JS, no native date picker. */
export function DateRangeSheet({ visible, initial, onClose, onApply }: { visible: boolean; initial: DateRange; onClose: () => void; onApply: (r: DateRange) => void }) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const invalid = from > to;
  const quick = (days: number) => { const f = new Date(TODAY); f.setDate(f.getDate() - days + 1); setFrom(f); setTo(new Date(TODAY)); };
  return (
    <Sheet visible={visible} onClose={onClose} title="Custom date range" subtitle="Applies to Payouts, Portfolio and Cases"
      footer={<Button label="Apply date range" icon="check" disabled={invalid} onPress={() => onApply({ preset: 'custom', from, to })} />}>
      <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
        {[7, 30, 90].map((n) => <Chip key={n} label={`Last ${n} days`} on={false} onPress={() => quick(n)} />)}
      </View>
      <DateStepper label="From" value={from} onChange={setFrom} />
      <DateStepper label="To" value={to} onChange={setTo} max={TODAY} />
      {invalid && <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">From date is after To date — move one of them to apply.</Text>}
    </Sheet>
  );
}

function DateStepper({ label, value, onChange, max }: { label: string; value: Date; onChange: (d: Date) => void; max?: Date }) {
  const y = value.getFullYear(); const m = value.getMonth(); const d = value.getDate();
  const set = (yy: number, mm: number, dd: number) => {
    const n = new Date(yy, mm, clampDay(yy, mm, dd));
    onChange(max && n > max ? new Date(max) : n);
  };
  return (
    <View style={{ alignSelf: 'stretch', minWidth: 0, gap: space.xs, padding: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
      <Text variant="label" color={colors.textSecondary}>{label}</Text>
      {/* Month and day stacked, each full width, so neither stepper can run off a 360dp screen. */}
      <Stepper a11y={`${label} month`} value={`${MONTHS[m]} ${y}`} onPrev={() => set(m === 0 ? y - 1 : y, (m + 11) % 12, d)} onNext={() => set(m === 11 ? y + 1 : y, (m + 1) % 12, d)} />
      <Stepper a11y={`${label} day`} value={`Day ${String(d).padStart(2, '0')}`} onPrev={() => set(y, m, d <= 1 ? new Date(y, m + 1, 0).getDate() : d - 1)} onNext={() => set(y, m, d >= new Date(y, m + 1, 0).getDate() ? 1 : d + 1)} />
    </View>
  );
}

function Stepper({ value, onPrev, onNext, a11y }: { value: string; onPrev: () => void; onNext: () => void; a11y: string }) {
  return (
    <View style={{ alignSelf: 'stretch', minWidth: 0, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.pill }} accessibilityLabel={`${a11y}: ${value}`}>
      <PressableScale onPress={onPrev} accessibilityRole="button" accessibilityLabel={`Previous ${a11y}`} style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevron-left" size={24} color={colors.primary} />
      </PressableScale>
      <Text variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>{value}</Text>
      <PressableScale onPress={onNext} accessibilityRole="button" accessibilityLabel={`Next ${a11y}`} style={{ width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevron-right" size={24} color={colors.primary} />
      </PressableScale>
    </View>
  );
}

/** design-a: white card on the cream canvas — hairline border + the brand soft card shadow (same language as Home's Action tiles). */
export function StatCard({ label, value, sub, tone = colors.text, compact }: { label: string; value: string; sub?: string; tone?: string; compact?: boolean }) {
  return (
    <View style={[{ flex: 1, minWidth: compact ? 96 : 140, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: compact ? space.sm : space.md, gap: 2 }, elevation.card as object]}>
      <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{label}</Text>
      <Text variant={compact ? 'h3' : 'h2'} color={tone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={fontScaleCap.compact}>{value}</Text>
      {sub ? <Text variant="caption" color={colors.textSecondary}>{sub}</Text> : null}
    </View>
  );
}

/**
 * ₹ in compact lakh/crore form for dashboards: ₹12.6L, ₹1.25Cr, ₹48,200. No space before the unit,
 * so the figure can never wrap between the number and "L".
 */
export function inrShort(n: number): string {
  const trim = (v: string) => v.replace(/\.?0+$/, '');
  if (n >= 1e7) return `₹${trim((n / 1e7).toFixed(2))}Cr`;
  if (n >= 1e5) return `₹${trim((n / 1e5).toFixed(1))}L`;
  return inr(n);
}
