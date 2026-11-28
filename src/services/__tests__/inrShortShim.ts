/** Same formula as components/business.tsx inrShort (that file imports React Native, so tests cannot load it). */
export function inrShort(n: number): string {
  const trim = (v: string) => v.replace(/\.?0+$/, '');
  if (n >= 1e7) return `₹${trim((n / 1e7).toFixed(2))}Cr`;
  if (n >= 1e5) return `₹${trim((n / 1e5).toFixed(1))}L`;
  return `₹${n}`;
}
