/** Mock helpers — simulate network latency and ids. */
export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const rid = (prefix: string, len = 12) =>
  prefix + Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
export const nowTime = () =>
  new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
