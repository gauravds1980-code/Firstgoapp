import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useIsFocused, useRoute } from '@react-navigation/native';
import { Icon, Text } from '../components/ui';
import { colors, elevation } from '../theme/tokens';
import { haptic } from '../utils/haptics';
import { clock, type MicView } from './micFlow';
import { micDock, type MicPlacement } from './micDock';
import { createMicGesture, type MicGesture } from './micGesture';
import { voiceMetrics } from './voiceMetrics';
import { getVoiceSettings, useVoiceSettings } from './voiceSettings';
import { useVoiceSession, voiceSession } from './voiceSession';

const LABEL = {
  ptt: { idle: 'Hold to talk', listening: 'Listening, let go to send', thinking: 'Checking what you said' },
  handsfree: { idle: 'Tap to talk', listening: 'Listening, tap to cancel', thinking: 'Checking what you said' },
} as const;

const now = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
/** Gold ring around the maroon disc (mockups: /workspace/firstgo-transcript-mockup, after-portfolio-mock.png). */
const RING = 3;

/**
 * v1.4.2: the app's one voice mic, a 56 dp disc in the bottom-right thumb zone (it left the header; Zippy stays
 * docked there). Rendered once by VoiceHost at `placement` (micDock.ts: 16 dp from the right, 16 dp above the
 * safe area and above the focused screen's sticky footer; Home lines it up with the Scan QR disc; hidden on the
 * Scan QR camera and the Face e-KYC capture view). Drives the app's one voice session.
 *
 * Idle: maroon fill, gold ring, white outline mic. Listening: solid, white filled mic + timer. Checking (the
 * server double-checks): the mic glyph with a small gold "checking" dot, still pressable.
 * v1.4.0 instant feedback is kept: haptic + solid disc in the press handler itself, before the session answers;
 * the first painted frame is recorded as `pressToFeedback`.
 * Push-to-talk: press-and-hold, release ends the turn. Hands-free: tap to start, tap again to cancel.
 * Double-tap (micGesture.ts): opens / closes the live transcript sheet; the first press is never delayed.
 */
export function VoiceMic({ placement, view, elapsed }: {
  placement: MicPlacement;
  /** v1.4.5: the SAME view + timer VoiceHost gives the "Listening…" bubble (micFlow.micView) — one source of truth. */
  view: MicView;
  elapsed: number;
}) {
  const { transcriptOpen } = useVoiceSession();
  const { mode } = useVoiceSettings();
  const handsFree = mode === 'handsfree';
  const pendingPaint = useRef(false);
  // v1.4.5: no local "pressed" flag any more (it painted a recording disc while the session was not listening).
  // The press handler starts the turn synchronously, so the session's listening state arrives in this same frame.
  const live = view.live;
  const checking = view.checking && !live;
  useEffect(() => { if (!live) pendingPaint.current = false; }, [live]);

  // First frame that shows the pressed state → metrics (press-in → visible feedback).
  useLayoutEffect(() => {
    if (!live || !pendingPaint.current) return;
    pendingPaint.current = false;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
    const mark = () => { const t = voiceMetrics.turns().at(-1); if (t) voiceMetrics.mark(t.id, 'feedback'); };
    if (raf) raf(mark); else mark();
  }, [live]);

  const gesture = useRef<MicGesture | null>(null);
  if (!gesture.current) {
    gesture.current = createMicGesture({
      mode: () => getVoiceSettings().mode,
      actions: {
        pressIn: (at) => voiceSession.pressIn(at),
        pressOut: (at) => voiceSession.pressOut(at),
        tap: (at) => voiceSession.tap(at),
        discard: () => voiceSession.discard(),
        toggleSheet: () => voiceSession.toggleTranscript(),
      },
    });
  }
  useEffect(() => () => gesture.current?.reset(), []);

  const onPressIn = () => {
    const at = now();
    haptic.tap();
    const ptt = getVoiceSettings().mode !== 'handsfree';
    if (ptt) pendingPaint.current = true;
    if (gesture.current!.down(at) === 'double') pendingPaint.current = false;
  };
  const onPressOut = () => {
    const at = now();
    if (getVoiceSettings().mode === 'handsfree') pendingPaint.current = voiceSession.state.phase !== 'listening';
    gesture.current!.up(at);
  };

  const label = LABEL[mode][live ? 'listening' : checking ? 'thinking' : 'idle'];
  const size = placement.size;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: placement.right, bottom: placement.bottom, width: size, height: size, zIndex: 90 }}>
      {live && <View pointerEvents="none" style={{ position: 'absolute', left: -6, top: -6, width: size + 12, height: size + 12, borderRadius: (size + 12) / 2, backgroundColor: 'rgba(239,168,52,0.28)' }} />}
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        // Push-to-talk: no long-press delay, the hold starts on touch-down.
        delayLongPress={60_000}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={(handsFree ? 'Tap, say a command such as “Show pending disbursals”, and Zippy acts when you stop. Tap again to cancel.'
          : 'Press and hold, say a command such as “Show pending disbursals”, then let go.') + ' Double-tap quickly to open the live transcript.'}
        accessibilityState={{ busy: checking, selected: live, expanded: transcriptOpen }}
        accessibilityActions={[{ name: 'activate' }, { name: 'transcript', label: transcriptOpen ? 'Close live transcript' : 'Open live transcript' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'transcript') voiceSession.toggleTranscript();
          else if (e.nativeEvent.actionName === 'activate' && getVoiceSettings().mode === 'handsfree') voiceSession.tap(now());
        }}
        testID="header-voice-mic"
        style={[{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: live ? colors.primaryDark : colors.primary,
          borderWidth: RING, borderColor: colors.cta }, elevation.raised as object, { cursor: 'pointer' } as object]}
      >
        {live ? (
          <>
            <Icon name="microphone" size={22} color={colors.onPrimary} />
            <Text variant="caption" color={colors.onPrimary} maxFontSizeMultiplier={1} style={{ fontSize: 10, lineHeight: 12 }} accessibilityLabel={`${Math.floor(elapsed / 1000)} seconds`}>{clock(elapsed)}</Text>
          </>
        ) : <Icon name="microphone-outline" size={28} color={colors.onPrimary} />}
        {checking && (
          <View pointerEvents="none" accessibilityLabel="Checking" style={{ position: 'absolute', top: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.cta, borderWidth: 2, borderColor: colors.surface }} />
        )}
      </Pressable>
    </View>
  );
}

/** Hide the bottom-right mic on the calling route while `on` (e.g. a full-screen camera). Restored on clear / unmount. */
export function useVoiceMicHidden(on: boolean) {
  const route = useRoute().name;
  useEffect(() => (on ? micDock.hide(route) : undefined), [on, route]);
}

/** Pin the disc's bottom edge on the calling route (Home: level with the Scan QR disc). Cleared on unmount / blur. */
export function useVoiceMicAnchor(bottom: number | null) {
  const route = useRoute().name;
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused || bottom == null) return;
    micDock.setAnchor(route, bottom);
    return () => micDock.setAnchor(route, null);
  }, [route, bottom, focused]);
}
