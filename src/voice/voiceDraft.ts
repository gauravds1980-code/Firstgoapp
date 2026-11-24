import { useSyncExternalStore } from 'react';
import type { VoiceSlots } from './types';

/**
 * In-memory draft written when the dealer CONFIRMS a voice command that carried slots or a filter
 * (e.g. "New loan for Ramesh, Activa 125, down payment 15,000, 24 months").
 *
 * Also the FILL CHANNEL for confirmed spoken numbers (`voiceDraft.merge`): PHONE → slots.mobileNumber,
 * AMOUNT → slots.downPayment, OTP → slots.otp. SearchMobile reads mobileNumber; SearchMobile (OTP stage)
 * and DealerOtp read otp. A screen calls `useVoiceDraft()`, applies what it understands, and removes
 * just that slot with `voiceDraft.take(key)` so other slots survive for later screens. Never persisted;
 * cleared after DRAFT_TTL_MS. `slots.otp` is a secret: never log it, never render it unmasked.
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
  /** Add confirmed slots to the current draft (or start one), keeping slots already there. */
  merge(d: Partial<Omit<VoiceDraft, 'createdAt' | 'slots'>> & { slots: VoiceSlots }) {
    const prev = fresh();
    current = {
      intent: d.intent ?? prev?.intent ?? 'UNKNOWN',
      transcript: d.transcript ?? prev?.transcript ?? '',
      route: d.route ?? prev?.route,
      filter: d.filter ?? prev?.filter,
      slots: { ...prev?.slots, ...d.slots },
      createdAt: Date.now(),
    };
    emit();
  },
  /** Read one slot and remove it, leaving the rest of the draft. */
  take<K extends keyof VoiceSlots>(key: K): VoiceSlots[K] | undefined {
    const d = fresh();
    if (!d || d.slots[key] === undefined) return undefined;
    const v = d.slots[key];
    const rest = { ...d.slots };
    delete rest[key];
    current = { ...d, slots: rest };
    emit();
    return v;
  },
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
