/**
 * Query queues (v1.4.8, Gaurav #4). Pure: unit-tested in Node.
 *
 * Money-in-flight questions go to the dealer's RM desk (ticket QRY-<LAN digits>-<n>, unchanged from v1.4.6).
 * Payout / short-pay / deduction questions go to a SEPARATE payout-operations queue with its own prefix: PAY-xxxx.
 * Both reuse the library QuerySheet (queue name + reasons are parameters) with the same Confirm step.
 */
export type QueryQueueId = 'rm' | 'payoutOps';
export interface QueryQueue {
  id: QueryQueueId; prefix: 'QRY' | 'PAY';
  /** Who receives it, in UI copy ("Send this query to …?"). */
  to: string;
  /** One line under the form. */
  promise: string;
}
export const QUERY_QUEUES: Record<QueryQueueId, QueryQueue> = {
  rm: { id: 'rm', prefix: 'QRY', to: 'your RM', promise: "We'll send this to your relationship manager. You'll get a ticket number here." },
  payoutOps: { id: 'payoutOps', prefix: 'PAY', to: 'Payout operations', promise: "We'll send this to the payout operations team. You'll get a PAY ticket number here." },
};

/** Mock ticket id for a subject (a LAN). QRY-<LAN digits>-<n> (RM desk) or PAY-<last 4 LAN digits>[-n] (payout ops). */
export function queryTicketId(queue: QueryQueueId, lan: string, n = 1): string {
  const digits = lan.replace(/\D/g, '');
  if (queue === 'rm') return `QRY-${digits}-${n}`;
  return `PAY-${digits.slice(-4).padStart(4, '0')}${n > 1 ? `-${n}` : ''}`;
}
export const queueOfTicket = (id: string): QueryQueueId | null => (id.startsWith('PAY-') ? 'payoutOps' : id.startsWith('QRY-') ? 'rm' : null);

/** Payout statement reasons (spec §c). */
export const PAYOUT_QUERY_REASONS = [
  { id: 'shortPaid', label: 'Short paid' },
  { id: 'notReceived', label: 'Not received' },
  { id: 'wrongRate', label: 'Wrong rate' },
  { id: 'deduction', label: 'Deduction query' },
  { id: 'other', label: 'Other' },
] as const;
export type PayoutQueryReasonId = (typeof PAYOUT_QUERY_REASONS)[number]['id'];
