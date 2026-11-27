import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TIPS, ROUTE_CONTEXT } from '../components/assistant/tips';
import { useRouteHelp } from '../components/assistant/zippySection';
import { zippyDock } from '../components/assistant/zippyStore';
import { useKeyboardLift } from '../components/keyboard';
import { Icon, Text } from '../components/ui';
import { colors, elevation, gutter, radius, space, touch } from '../theme/tokens';
import { planCommand, ROUTE_LABEL, VOICE_EXAMPLES } from './applyCommand';
import { chooseCandidate } from './intentMatcher';
import { aboveMic, MIC_EDGE, MIC_GAP, micDock, micPlacement } from './micDock';
import type { AssistantActionName, CommandResponse, IntentCandidate } from './types';
import { autoToastText, candidateLabel, planTarget } from './voiceLogic';
import { VoiceMic } from './VoiceMic';
import { oneTapActs } from './voiceMode';
import { VoiceTranscriptSheet } from './VoiceTranscriptSheet';
import { maskSpoken, voiceTranscript } from './voiceTranscript';
import { asrDiagLine, getAsrDiag, subscribeAsrDiag } from './asrDiag';
import { useVoiceCommand } from './useVoiceCommand';
import { installVoiceDemo } from './voiceDemo';
import { preloadCueSounds } from './playVoiceCue';
import { VoicePreviewSheet } from './VoicePreviewSheet';
import { useVoiceSession, voiceSession } from './voiceSession';
import { loadVoiceSettings, useVoiceSettings } from './voiceSettings';
import { setNudgeSuppressed } from '../tutorial/tutorialStore';

/** Banners / the auto-act toast sit just under the header row. */
const HEADER_H = 60;
/** v1.4.2: the live pill is a right-aligned card above the mic, never a full-width banner. */
const PILL_MAX_W = 320;
const ERROR_MS = 4000;
const INFO_MS = 6500;

type Banner = { kind: 'error' | 'info'; text: string; id: number };

/** Action-row text for a command that ran (same wording as the auto-act toast). */
const actedText = (cmd: CommandResponse): string | null => {
  const plan = planCommand(cmd);
  if (plan.kind !== 'navigated' && plan.kind !== 'selected' && plan.kind !== 'filled') return null;
  return autoToastText(cmd, planTarget(cmd), plan.kind === 'navigated' ? ROUTE_LABEL[plan.route] : undefined);
};

/**
 * Owns the app's one voice session (one recorder), mounted once in RootNavigator. v1.4.2: it also draws the
 * app's one mic (VoiceMic), bottom-right (micDock.ts), and the live transcript sheet (double-tap the mic).
 * This host ALWAYS draws the voice results itself: listening pill (just above the mic),
 * error / read-out banners, the auto-act toast + Undo and the staged preview (Confirm / clarify / say again),
 * whether or not Zippy's help sheet is open. Nothing is forwarded into the sheet's thread. When the sheet
 * (a Modal) is visible, the same overlay is lifted into a transparent Modal so it stays on top.
 */
export function VoiceHost({ route }: { route?: string }) {
  const insets = useSafeAreaInsets();
  const { sheetOpen, transcriptOpen } = useVoiceSession();
  const { width: winW } = useWindowDimensions();
  const { footer } = useRouteHelp(route);
  const kbLift = useKeyboardLift();
  useSyncExternalStore(micDock.subscribe, micDock.version, micDock.version);
  const [banner, setBanner] = useState<Banner | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const lastSpoken = useRef<string | null>(null);
  const show = useCallback((kind: Banner['kind'], text: string) => setBanner({ kind, text, id: Date.now() }), []);

  const readOut = useCallback((action: AssistantActionName): string | null => {
    // The spoken "open Zippy" / "open assistant" command opens the help sheet (a voice command, not the
    // mic itself). Everything else is spoken by Piper and shown as a banner here.
    if (action === 'open') { zippyDock.requestSheet(); return null; }
    const tip = TIPS[ROUTE_CONTEXT[routeRef.current ?? ''] ?? 'home'];
    const text = action === 'list_commands' ? `You can say things like: ${VOICE_EXAMPLES.join(', ')}.`
      : action === 'repeat' ? lastSpoken.current ?? tip
      : tip;
    lastSpoken.current = text;
    show('info', text);
    return text;
  }, [show]);

  const voice = useVoiceCommand({ readOut });
  const { mode, debugAsr } = useVoiceSettings();
  // v1.4.2: optional debug line (Settings → Voice speed stats → Show voice debug line). Never a transcript.
  const diag = useSyncExternalStore(subscribeAsrDiag, getAsrDiag, getAsrDiag);
  const debugLine = debugAsr ? asrDiagLine(diag) : null;
  const [bannerH, setBannerH] = useState(0);
  useEffect(() => { void loadVoiceSettings(); preloadCueSounds(); }, []);
  // The auto-act toast replaces any read-out banner (one message at a time under the header).
  useEffect(() => { if (voice.toast) setBanner(null); }, [voice.toast]);

  // Live transcript rows for the dealer's own decisions on a staged preview (in memory only, OTP masked).
  const confirm = useCallback(() => {
    const p = voice.preview;
    const text = p ? actedText(p.command) : null;
    if (text) voiceTranscript.zippy('action', text);
    voice.confirm();
  }, [voice.preview, voice.confirm]);
  const choose = useCallback((c: IntentCandidate) => {
    const p = voice.preview;
    if (p) {
      const staged = chooseCandidate(p.command, c);
      const text = oneTapActs(staged) ? actedText(staged) : null;
      voiceTranscript.zippy(text ? 'action' : 'reply', text ?? `You picked “${candidateLabel(c)}”. Waiting for your confirm.`);
    }
    voice.choose(c);
  }, [voice.preview, voice.choose]);
  const cancel = useCallback(() => {
    if (voice.preview) voiceTranscript.zippy('reply', 'Okay, cancelled.');
    voice.cancel();
  }, [voice.preview, voice.cancel]);
  const discard = useCallback(() => { voiceTranscript.dropTurn(voice.discard()); }, [voice.discard]);

  useEffect(() => {
    voiceSession.bind({
      pressIn: voice.pressIn, pressOut: (at) => { void voice.pressOut(at); }, tap: voice.tap, confirm, cancel, abort: () => voice.abort(),
      choose, editField: voice.editField, sayAgain: voice.sayAgain, editTranscript: voice.editTranscript, discard,
    });
  });
  // v1.4.2 live transcript: fed from the same live state as the pill (phone partials, final text, Whisper /
  // server corrections, future streaming partials), plus the auto-act toast and Zippy's read-outs / errors.
  useEffect(() => { voiceTranscript.live(voice.live); }, [voice.live]);
  useEffect(() => { if (voice.toast) voiceTranscript.zippy('action', voice.toast.text); }, [voice.toast]);
  useEffect(() => { if (banner) voiceTranscript.zippy(banner.kind === 'error' ? 'error' : 'reply', banner.text); }, [banner]);
  // Signed out (back on the login screen): this session's transcript is gone.
  useEffect(() => { if (route === 'DealerLogin') voiceTranscript.clear(); }, [route]);
  // Zippy's help sheet (a Modal) wins: the transcript closes so the two never stack.
  useEffect(() => { if (sheetOpen) voiceSession.setTranscriptOpen(false); }, [sheetOpen]);
  const closeTranscript = useCallback(() => voiceSession.setTranscriptOpen(false), []);
  // __DEV__ + web only: window.__voiceDemo() or ?voiceDemo=1 stages a sample preview (screenshots).
  const stageRef = useRef(voice.stagePreview);
  stageRef.current = voice.stagePreview;
  useEffect(() => (__DEV__ ? installVoiceDemo((p) => stageRef.current(p)) : undefined), []);
  useEffect(() => {
    voiceSession.publish({ phase: voice.phase, error: voice.error, preview: voice.preview, live: voice.live });
  }, [voice.phase, voice.error, voice.preview, voice.live]);

  // Errors → short banner. Hints ("Hold the mic and say it again") → info banner.
  useEffect(() => { if (voice.error) show('error', voice.error); }, [voice.error, show]);
  useEffect(() => { if (voice.info) show('info', voice.info); }, [voice.info, show]);
  // v1.3.0: Zippy's tutorial nudges stay away while the dealer is talking, a preview is staged or the
  // auto-act toast with Undo is up.
  const voiceBusy = voice.phase !== 'idle' || !!voice.preview;
  useEffect(() => { setNudgeSuppressed('voice', voiceBusy); }, [voiceBusy]);
  useEffect(() => { setNudgeSuppressed('undo', !!voice.toast); }, [voice.toast]);
  useEffect(() => { if (voice.phase !== 'idle') setBanner(null); }, [voice.phase]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), banner.kind === 'error' ? ERROR_MS : INFO_MS);
    return () => clearTimeout(t);
  }, [banner]);

  const showPreview = !!voice.preview;
  // Android back closes the live transcript first, then the preview, instead of leaving the screen.
  useEffect(() => {
    if (!showPreview && !transcriptOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (voiceSession.state.transcriptOpen) voiceSession.setTranscriptOpen(false); else cancel();
      return true;
    });
    return () => sub.remove();
  }, [showPreview, transcriptOpen, cancel]);

  // v1.4.2: the mic, bottom-right (hidden on the Scan QR / Face e-KYC camera, and while the standalone preview
  // sheet is up — it would sit on that sheet's buttons; the scrim covered the old header mic the same way).
  const placement = micPlacement({
    route, insetBottom: insets.bottom, footer, anchorBottom: micDock.anchor(route), hidden: micDock.isHidden(route), keyboardLift: kbLift,
  });
  const showMic = !!placement && (!showPreview || transcriptOpen);
  useEffect(() => { if (!placement && transcriptOpen) voiceSession.setTranscriptOpen(false); }, [!!placement, transcriptOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const pillBottom = placement ? aboveMic(placement) : Math.max(footer, insets.bottom) + MIC_GAP + kbLift;

  // v1.4.0: live words while listening; the final / draft text right after release with a small "checking"
  // dot while Whisper double-checks. Never a blocking spinner that hides what was heard.
  const listeningNow = voice.phase === 'listening';
  // OTP digits are dots here too, even when the OTP was said outside the OTP screen (maskSpoken).
  const heard = maskSpoken(voice.live?.text?.trim() ?? '').text;
  const status = listeningNow
    ? (heard || (mode === 'handsfree' ? 'Listening… tap to cancel' : 'Listening… let go to send'))
    : voice.live?.final ? (heard ? `“${heard}”` : 'Got it — checking…')
    : voice.phase === 'thinking' ? 'Got it — checking…' : null;
  const checking = !listeningNow && (voice.phase === 'thinking' || !!voice.live?.checking);
  const top = insets.top + HEADER_H;
  const debugCaption = debugLine ? (
    <View testID="voice-asr-debug" accessibilityLabel={`Voice debug: ${debugLine}`}
      style={[{ marginTop: space.xxs, maxWidth: '100%', paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.surface }, elevation.card]}>
      <Text variant="caption" numberOfLines={2} color={colors.text}>{debugLine}</Text>
    </View>
  ) : null;
  // Interim words: grey + caret; final words: solid ink. Hints ("Listening… let go to send") stay grey.
  const interim = listeningNow && !!heard;
  const solid = !listeningNow && !!voice.live?.final && !!heard;
  const pillW = Math.min(PILL_MAX_W, winW - 2 * gutter.screen);
  const debugUp = !!debugCaption && !showPreview && !!banner;
  const overlay = (
    <>
      {status && !showPreview && !transcriptOpen && (
        <View pointerEvents="none" accessibilityLiveRegion="polite" testID="voice-live-pill"
          style={{ position: 'absolute', bottom: pillBottom, right: placement ? placement.right : MIC_EDGE, maxWidth: pillW, alignItems: 'flex-end', zIndex: 60 }}>
          {debugCaption}
          <View style={[{ maxWidth: '100%', marginTop: debugCaption ? space.xxs : 0, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, elevation.card]}>
            <Icon name={listeningNow ? 'microphone' : 'text-recognition'} size={18} color={colors.primary} />
            <Text variant="label" numberOfLines={2} style={{ flexShrink: 1 }} color={solid ? colors.text : colors.textSecondary}>
              {status}{interim && <Text variant="label" color={colors.primary}>|</Text>}
            </Text>
            {checking && <View accessibilityLabel="Checking" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cta }} />}
          </View>
        </View>
      )}
      {banner && !status && (
        <Pressable onPress={() => setBanner(null)} onLayout={(e) => setBannerH(e.nativeEvent.layout.height)} accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityHint="Tap to dismiss"
          style={[{ position: 'absolute', top, left: gutter.screen, right: gutter.screen, zIndex: 85, flexDirection: 'row', alignItems: 'center', gap: space.xs,
            paddingHorizontal: space.sm, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: banner.kind === 'error' ? colors.dangerSoft : colors.aiThread }, elevation.card]}>
          <Icon name={banner.kind === 'error' ? 'alert-circle-outline' : 'chat-processing-outline'} size={18} color={banner.kind === 'error' ? colors.danger : colors.primary} />
          <Text variant="caption" color={colors.text} style={{ flex: 1 }}>{banner.text}</Text>
        </Pressable>
      )}
      {banner && !status && !showPreview && debugCaption && (
        <View pointerEvents="none" style={{ position: 'absolute', top: top + bannerH, left: gutter.screen, right: gutter.screen, alignItems: 'center', zIndex: 85 }}>{debugCaption}</View>
      )}
      {voice.toast && (
        <View key={voice.toast.id} accessibilityRole="alert" accessibilityLiveRegion="polite"
          style={[{ position: 'absolute', top: top + (banner && !status ? bannerH + space.xs : 0) + (debugUp ? 40 : 0), left: gutter.screen, right: gutter.screen, zIndex: 86, flexDirection: 'row', alignItems: 'center', gap: space.xs,
            paddingLeft: space.md, paddingRight: space.xxs, minHeight: touch.min + space.xs, borderRadius: radius.md, backgroundColor: colors.textStrong }, elevation.card]}>
          <Icon name={voice.toast.icon === 'navigate' ? 'arrow-right-circle-outline' : voice.toast.icon === 'select' ? 'check-circle-outline' : 'form-textbox'} size={20} color={colors.onPrimary} />
          <Text variant="bodyStrong" color={colors.onPrimary} numberOfLines={2} style={{ flex: 1 }}>{voice.toast.alt ? `${voice.toast.text}. Did you mean “${voice.toast.alt}”?` : voice.toast.text}</Text>
          {voice.toast.alt && (
            <Pressable onPress={voice.chooseAlt} accessibilityRole="button" accessibilityLabel={`Did you mean ${voice.toast.alt}`} hitSlop={8}
              style={({ pressed }) => ({ minWidth: touch.min, minHeight: touch.min, paddingHorizontal: space.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 })}>
              <Text variant="label" color={colors.cta}>Yes</Text>
            </Pressable>
          )}
          <Pressable onPress={voice.undo} accessibilityRole="button" accessibilityLabel={`Undo: ${voice.toast.text}`} hitSlop={8}
            style={({ pressed }) => ({ minWidth: touch.min, minHeight: touch.min, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 })}>
            <Text variant="label" color={colors.cta}>Undo</Text>
          </Pressable>
        </View>
      )}
      {showPreview && !transcriptOpen && (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 70 }]}>
          <VoicePreviewSheet command={voice.preview?.command ?? null} plan={voice.preview?.plan ?? null} expect={voice.preview?.expect}
            onConfirm={confirm} onCancel={cancel} onChoose={choose} onEditField={voice.editField}
            onSayAgain={voice.sayAgain} onEditTranscript={voice.editTranscript} />
        </View>
      )}
    </>
  );
  // v1.4.2: the transcript sheet and the mic live in the app tree (under Zippy's help-sheet Modal, which closes
  // the transcript). The sheet stops above the mic, and the mic is drawn last, so the disc is never covered.
  const micClear = placement ? aboveMic(placement) : Math.max(footer, insets.bottom) + MIC_GAP + kbLift;
  const dock = (
    <>
      {transcriptOpen && !sheetOpen && (
        <VoiceTranscriptSheet onClose={closeTranscript} micClear={micClear} live={voice.live} phase={voice.phase}
          preview={showPreview ? (
            <VoicePreviewSheet embedded command={voice.preview?.command ?? null} plan={voice.preview?.plan ?? null} expect={voice.preview?.expect}
              onConfirm={confirm} onCancel={cancel} onChoose={choose} onEditField={voice.editField}
              onSayAgain={voice.sayAgain} onEditTranscript={voice.editTranscript} />
          ) : null} />
      )}
      {showMic && placement && <VoiceMic placement={placement} />}
    </>
  );
  if (!sheetOpen) return <>{overlay}{dock}</>;
  // Zippy's sheet is a Modal: lift the voice overlay above it (only while there is something to show).
  const visible = !!(status || banner || voice.toast || showPreview);
  return (
    <>
      {dock}
      <Modal visible={visible} transparent animationType="none" onRequestClose={showPreview ? cancel : () => setBanner(null)}>
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{overlay}</View>
      </Modal>
    </>
  );
}
