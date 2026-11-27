import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Sheet } from './Sheet';
import { Button, ReadOnlyRow, Text } from './ui';
import { PRODUCTS } from '../config/products';
import { bucketOf, Case, fmtDate } from '../services/business';
import { colors } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { inr } from '../utils/finance';
import { customerOptions } from '../voice/customerMatch';
import { useVoiceDraft, voiceDraft } from '../voice/voiceDraft';
import { clearVoiceOptions, setVoiceOptions } from '../voice/voiceOptions';
import { useUndoSource } from '../voice/voiceUndo';

/**
 * v1.4.5 S2.7: the loan behind a Cases / Portfolio row (there is no separate case screen: a sheet, like RC pendency).
 * `useCaseRows` makes the rows openable by tap AND by voice: they are registered as `kind: 'customer'` options
 * (CONTRACT.md 2.2 / S2.7), so "open Rahul Sharma" opens that row exactly like a tap (Undo closes it); two rows with
 * one name → "Rahul Sharma, Activa or Rahul Sharma, Jupiter?"; unknown → "Sanjay Pawar is not on this list."
 */
export function useCaseRows(route: 'Cases' | 'Portfolio', rows: Case[]): { open: Case | null; openLan: (lan: string | null) => void } {
  const [lan, setLan] = useState<string | null>(null);
  const focused = useIsFocused();
  useFocusEffect(useCallback(() => {
    const token = setVoiceOptions(customerOptions(rows, (c) => ({ lan: c.lan, name: c.customer, vehicle: c.vehicle })), route);
    return () => clearVoiceOptions(token);
  }, [rows, route]));
  const draft = useVoiceDraft();
  useEffect(() => {
    if (!focused || !draft?.slots.customerLan) return;
    const want = voiceDraft.take('customerLan');
    if (want && rows.some((c) => c.lan === want)) { haptic.select(); setLan(want); }
  }, [draft, focused, rows]);
  useUndoSource<string | null>('customer', () => lan, (v) => setLan(v), focused);
  return { open: rows.find((c) => c.lan === lan) ?? null, openLan: setLan };
}

export function CaseDetailSheet({ c, onClose }: { c: Case | null; onClose: () => void }) {
  return (
    <Sheet visible={!!c} onClose={onClose} title={c?.customer ?? ''} subtitle={c ? `${c.lan} · ${c.vehicle}` : undefined}
      footer={<Button label="Done" onPress={onClose} />}>
      {c && (
        <>
          <ReadOnlyRow label="Product" value={PRODUCTS[c.product].label} />
          <ReadOnlyRow label="Loan amount" value={inr(c.amount)} strong />
          <ReadOnlyRow label="Disbursed on" value={fmtDate(c.disbursedOn)} />
          <ReadOnlyRow label="Outstanding (POS)" value={inr(c.pos)} />
          <ReadOnlyRow label="Repayment" value={c.dpd ? `${c.dpd} days past due · ${bucketOf(c.dpd)} DPD` : 'Current · no dues'} />
          <ReadOnlyRow label="Status" value={c.status} />
          <Text variant="caption" color={colors.textSecondary}>Example data. Collections and statements come from the loan system.</Text>
        </>
      )}
    </Sheet>
  );
}
