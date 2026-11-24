import { useSyncExternalStore } from 'react';
import type { VoiceSlots } from './types';

/**
 * In-memory draft written when the dealer CONFIRMS a voice command that carried slots or a filter
 * (e.g. "New loan for Ramesh, Activa 125, down payment 15,000, 24 months").
 *
 * Nothing reads it yet: SearchMobile / Offer / Asset / Cases have no form-state hook today. A screen
 * that wants it calls `useVoiceDraft()` (or `voiceDraft.peek()`), applies what it understands, then
 * `voiceDraft.consume()` so it is applied once. Never persisted; cleared on consume or after
 * DRAFT_TTL_MS. Do not put real customer data here beyond what the dealer just spoke.
 *
 * Shape:
 * {
 *   intent: 'NEW_TWO_WHEELER_LOAN',          // proxy intent id
 *   transcript: 'new loan for Ramesh …',      // raw transcript (may be Devanagari)
 *   route: 'ScanQr',                          // where we navigated, if anywhere
 *   filter: 'two_wheeler',                    // proxy hint for that screen (Cases filter, Offer field…)
 *   slots: { customerName, vehicle, vehicleCategory, downPayment, tenureMonths, mobileNumber },
 *   createdAt: 1732400000000,
 * }
 */
export interface VoiceDraft {
  intent: string;
  transcript: string;
  route?: string;
  filter?: string;
  slots: VoiceSlots;
  createdAt: number;
}

const DRAFT_TTL_MS = 10 * 60 * 1000;
let current: VoiceDraft | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const fresh = () => (current && Date.now() - current.createdAt > DRAFT_TTL_MS ? (current = null) : current);

export const voiceDraft = {
  set(d: Omit<VoiceDraft, 'createdAt'>) { current = { ...d, createdAt: Date.now() }; emit(); },
  peek(): VoiceDraft | null { return fresh(); },
  /** Read and clear (apply once). */
  consume(): VoiceDraft | null { const d = fresh(); if (current) { current = null; emit(); } return d; },
  clear() { if (current) { current = null; emit(); } },
};

export function useVoiceDraft(): VoiceDraft | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
    () => current,
  );
}
