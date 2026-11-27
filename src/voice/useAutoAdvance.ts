import { useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AutoAdvancer, AUTO_ADVANCE_MS } from './autoAdvance';
import { clearVoiceStep, setVoiceStep, type StepControl, type VoiceStepSpec } from './voiceStep';

/** One AutoAdvancer for the component's life; `advance` is always the latest closure. Cancelled on unmount. */
export function useAutoAdvance(advance: () => void, delayMs: number = AUTO_ADVANCE_MS): AutoAdvancer {
  const ref = useRef<AutoAdvancer | null>(null);
  if (!ref.current) ref.current = new AutoAdvancer(advance, delayMs);
  ref.current.setAdvance(advance);
  useEffect(() => () => ref.current?.cancel(), []);
  return ref.current;
}

/**
 * Register what voice ADVANCE does here while `spec` is non-null and the screen is focused (sheets: pass null when
 * closed). The press functions are read through a ref, so they always run the latest render's code.
 */
export function useVoiceStep(spec: VoiceStepSpec | null): void {
  const focused = useIsFocused();
  const latest = useRef(spec);
  latest.current = spec;
  const wrap = (c: StepControl | undefined, i: number): StepControl | undefined => c && {
    ...c,
    press: () => { const s = latest.current; const cur = i < 0 ? s?.cta : s?.alts?.[i]; (cur ?? c).press(); },
  };
  const key = spec ? JSON.stringify({ ...spec, cta: spec.cta && { ...spec.cta, press: undefined }, alts: spec.alts?.map((a) => ({ ...a, press: undefined })) }) : '';
  useEffect(() => {
    if (!spec || !focused) return undefined;
    const token = setVoiceStep({ ...spec, cta: wrap(spec.cta, -1), alts: spec.alts?.map((a, i) => wrap(a, i)!) });
    return () => clearVoiceStep(token);
  }, [key, focused]); // eslint-disable-line react-hooks/exhaustive-deps
}
