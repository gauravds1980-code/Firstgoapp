import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TIPS, ROUTE_CONTEXT } from '../components/assistant/tips';
import { zippyDock } from '../components/assistant/zippyStore';
import { Icon, Text } from '../components/ui';
import { colors, elevation, gutter, radius, space } from '../theme/tokens';
import { VOICE_EXAMPLES } from './applyCommand';
import type { AssistantActionName } from './types';
import { useVoiceCommand } from './useVoiceCommand';
import { installVoiceDemo } from './voiceDemo';
import { VoicePreviewSheet } from './VoicePreviewSheet';
import { useVoiceSession, voiceSession } from './voiceSession';

/** Banner sits just under the header row (where the docked mic lives). */
const HEADER_H = 60;
const ERROR_MS = 4000;
const INFO_MS = 6500;

type Banner = { kind: 'error' | 'info'; text: string; id: number };

/**
 * Owns the app's one voice session (one recorder), mounted once next to ZippyBubble in RootNavigator.
 * While the assistant sheet is open, the sheet draws errors and the preview inside its own Modal and
 * receives transcripts / read-outs. While it is closed (the usual case: dealers press the docked header
 * badge), this host shows a listening pill, short error / read-out banners and the staged preview.
 */
export function VoiceHost({ route }: { route?: string }) {
  const insets = useSafeAreaInsets();
  const { sheetOpen } = useVoiceSession();
  const [banner, setBanner] = useState<Banner | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const lastSpoken = useRef<string | null>(null);
  const show = useCallback((kind: Banner['kind'], text: string) => setBanner({ kind, text, id: Date.now() }), []);

  const onTranscript = useCallback((text: string) => { voiceSession.sheet()?.onTranscript(text); }, []);
  const onNavigate = useCallback(() => { voiceSession.sheet()?.onNavigate(); }, []);
  const readOut = useCallback((action: AssistantActionName): string | null => {
    const sheet = voiceSession.sheet();
    if (sheet) { const t = sheet.readOut(action); if (t) lastSpoken.current = t; return t; }
    // Sheet closed: "open Zippy" opens it; everything else is spoken + shown as a banner.
    if (action === 'open') { zippyDock.requestSheet(); return null; }
    const tip = TIPS[ROUTE_CONTEXT[routeRef.current ?? ''] ?? 'home'];
    const text = action === 'list_commands' ? `You can say things like: ${VOICE_EXAMPLES.join(', ')}.`
      : action === 'repeat' ? lastSpoken.current ?? tip
      : tip;
    lastSpoken.current = text;
    show('info', text);
    return text;
  }, [show]);

  const voice = useVoiceCommand({ onTranscript, onNavigate, readOut });

  useEffect(() => {
    voiceSession.bind({ pressIn: voice.pressIn, pressOut: () => { void voice.pressOut(); }, confirm: voice.confirm, cancel: voice.cancel, abort: voice.abort });
  });
  // __DEV__ + web only: window.__voiceDemo() or ?voiceDemo=1 stages a sample preview (screenshots).
  const stageRef = useRef(voice.stagePreview);
  stageRef.current = voice.stagePreview;
  useEffect(() => (__DEV__ ? installVoiceDemo((p) => stageRef.current(p)) : undefined), []);
  useEffect(() => {
    voiceSession.publish({ phase: voice.phase, error: voice.error, preview: voice.preview, mood: voice.mood, speaking: voice.speaking });
  }, [voice.phase, voice.error, voice.preview, voice.mood, voice.speaking]);

  // Errors raised while the sheet is closed → short banner (the sheet shows its own inline).
  useEffect(() => { if (voice.error && !sheetOpen) show('error', voice.error); }, [voice.error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sheetOpen) setBanner(null); }, [sheetOpen]);
  useEffect(() => { if (voice.phase !== 'idle') setBanner(null); }, [voice.phase]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), banner.kind === 'error' ? ERROR_MS : INFO_MS);
    return () => clearTimeout(t);
  }, [banner]);

  const showPreview = !sheetOpen && !!voice.preview;
  // Android back closes the preview instead of leaving the screen.
  useEffect(() => {
    if (!showPreview) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { voice.cancel(); return true; });
    return () => sub.remove();
  }, [showPreview, voice.cancel]);

  const status = !sheetOpen && voice.phase !== 'idle' ? (voice.phase === 'listening' ? 'Listening… let go to send' : 'Working it out…') : null;
  const top = insets.top + HEADER_H;
  return (
    <>
      {status && (
        <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', top, alignSelf: 'center', zIndex: 60 }}>
          <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: voice.phase === 'listening' ? colors.primary : colors.surface }, elevation.card]}>
            <Icon name={voice.phase === 'listening' ? 'microphone' : 'dots-horizontal'} size={18} color={voice.phase === 'listening' ? colors.onPrimary : colors.primary} />
            <Text variant="label" color={voice.phase === 'listening' ? colors.onPrimary : colors.text}>{status}</Text>
          </View>
        </View>
      )}
      {!sheetOpen && banner && !status && (
        <Pressable onPress={() => setBanner(null)} accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityHint="Tap to dismiss"
          style={[{ position: 'absolute', top, left: gutter.screen, right: gutter.screen, zIndex: 60, flexDirection: 'row', alignItems: 'center', gap: space.xs,
            paddingHorizontal: space.sm, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: banner.kind === 'error' ? colors.dangerSoft : colors.aiThread }, elevation.card]}>
          <Icon name={banner.kind === 'error' ? 'alert-circle-outline' : 'chat-processing-outline'} size={18} color={banner.kind === 'error' ? colors.danger : colors.primary} />
          <Text variant="caption" color={colors.text} style={{ flex: 1 }}>{banner.text}</Text>
        </Pressable>
      )}
      {showPreview && (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 70 }]}>
          <VoicePreviewSheet command={voice.preview?.command ?? null} plan={voice.preview?.plan ?? null} onConfirm={voice.confirm} onCancel={voice.cancel} />
        </View>
      )}
    </>
  );
}
