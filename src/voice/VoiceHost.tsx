import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TIPS, ROUTE_CONTEXT } from '../components/assistant/tips';
import { zippyDock } from '../components/assistant/zippyStore';
import { Icon, Text } from '../components/ui';
import { colors, elevation, gutter, radius, space, touch } from '../theme/tokens';
import { VOICE_EXAMPLES } from './applyCommand';
import type { AssistantActionName } from './types';
import { asrDiagLine, getAsrDiag, subscribeAsrDiag } from './asrDiag';
import { useVoiceCommand } from './useVoiceCommand';
import { installVoiceDemo } from './voiceDemo';
import { preloadCueSounds } from './playVoiceCue';
import { VoicePreviewSheet } from './VoicePreviewSheet';
import { useVoiceSession, voiceSession } from './voiceSession';
import { loadVoiceSettings, useVoiceSettings } from './voiceSettings';
import { setNudgeSuppressed } from '../tutorial/tutorialStore';

/** Banner sits just under the header row (where the header mic lives). */
const HEADER_H = 60;
const ERROR_MS = 4000;
const INFO_MS = 6500;

type Banner = { kind: 'error' | 'info'; text: string; id: number };

/**
 * Owns the app's one voice session (one recorder), mounted once in RootNavigator. The standalone header
 * mic (HeaderVoiceMic) drives it. This host ALWAYS draws the voice results itself: listening pill,
 * error / read-out banners, the auto-act toast + Undo and the staged preview (Confirm / clarify / say again),
 * whether or not Zippy's help sheet is open. Nothing is forwarded into the sheet's thread. When the sheet
 * (a Modal) is visible, the same overlay is lifted into a transparent Modal so it stays on top.
 */
export function VoiceHost({ route }: { route?: string }) {
  const insets = useSafeAreaInsets();
  const { sheetOpen } = useVoiceSession();
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

  useEffect(() => {
    voiceSession.bind({
      pressIn: voice.pressIn, pressOut: (at) => { void voice.pressOut(at); }, tap: voice.tap, confirm: voice.confirm, cancel: voice.cancel, abort: voice.abort,
      choose: voice.choose, editField: voice.editField, sayAgain: voice.sayAgain, editTranscript: voice.editTranscript,
    });
  });
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
  // Android back closes the preview instead of leaving the screen.
  useEffect(() => {
    if (!showPreview) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { voice.cancel(); return true; });
    return () => sub.remove();
  }, [showPreview, voice.cancel]);

  // v1.4.0: live words while listening; the final / draft text right after release with a small "checking"
  // dot while Whisper double-checks. Never a blocking spinner that hides what was heard.
  const listeningNow = voice.phase === 'listening';
  const heard = voice.live?.text?.trim() ?? '';
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
  const debugUp = !!debugCaption && !showPreview && (!!status || !!banner);
  const overlay = (
    <>
      {status && !showPreview && (
        <View pointerEvents="none" accessibilityLiveRegion="polite" testID="voice-live-pill" style={{ position: 'absolute', top, left: gutter.screen, right: gutter.screen, alignItems: 'center', zIndex: 60 }}>
          <View style={[{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: listeningNow ? colors.primary : colors.surface }, elevation.card]}>
            <Icon name={listeningNow ? 'microphone' : 'text-recognition'} size={18} color={listeningNow ? colors.onPrimary : colors.primary} />
            <Text variant="label" numberOfLines={2} style={{ flexShrink: 1 }} color={listeningNow ? colors.onPrimary : colors.text}>{status}</Text>
            {checking && <View accessibilityLabel="Checking" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cta }} />}
          </View>
          {debugCaption}
        </View>
      )}
      {banner && !status && (
        <Pressable onPress={() => setBanner(null)} onLayout={(e) => setBannerH(e.nativeEvent.layout.height)} accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityHint="Tap to dismiss"
          style={[{ position: 'absolute', top, left: gutter.screen, right: gutter.screen, zIndex: 60, flexDirection: 'row', alignItems: 'center', gap: space.xs,
            paddingHorizontal: space.sm, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: banner.kind === 'error' ? colors.dangerSoft : colors.aiThread }, elevation.card]}>
          <Icon name={banner.kind === 'error' ? 'alert-circle-outline' : 'chat-processing-outline'} size={18} color={banner.kind === 'error' ? colors.danger : colors.primary} />
          <Text variant="caption" color={colors.text} style={{ flex: 1 }}>{banner.text}</Text>
        </Pressable>
      )}
      {banner && !status && !showPreview && debugCaption && (
        <View pointerEvents="none" style={{ position: 'absolute', top: top + bannerH, left: gutter.screen, right: gutter.screen, alignItems: 'center', zIndex: 60 }}>{debugCaption}</View>
      )}
      {voice.toast && (
        <View key={voice.toast.id} accessibilityRole="alert" accessibilityLiveRegion="polite"
          style={[{ position: 'absolute', top: top + (status ? 48 : 0) + (debugUp && status ? 40 : 0), left: gutter.screen, right: gutter.screen, zIndex: 65, flexDirection: 'row', alignItems: 'center', gap: space.xs,
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
      {showPreview && (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 70 }]}>
          <VoicePreviewSheet command={voice.preview?.command ?? null} plan={voice.preview?.plan ?? null} expect={voice.preview?.expect}
            onConfirm={voice.confirm} onCancel={voice.cancel} onChoose={voice.choose} onEditField={voice.editField}
            onSayAgain={voice.sayAgain} onEditTranscript={voice.editTranscript} />
        </View>
      )}
    </>
  );
  if (!sheetOpen) return overlay;
  // Zippy's sheet is a Modal: lift the voice overlay above it (only while there is something to show).
  const visible = !!(status || banner || voice.toast || showPreview);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={showPreview ? voice.cancel : () => setBanner(null)}>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{overlay}</View>
    </Modal>
  );
}
