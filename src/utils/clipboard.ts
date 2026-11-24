import * as Clipboard from 'expo-clipboard';

/**
 * Copy text to the system clipboard. Resolves true on success, false on any failure; never throws.
 * Never logs the value: callers copy financial references (UTRs).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    const ok = await Clipboard.setStringAsync(text);
    return ok !== false;
  } catch {
    return false;
  }
}
