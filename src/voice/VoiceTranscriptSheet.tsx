import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { PanResponder, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ZippyCharacter } from '../components/assistant/ZippyCharacter';
import { Icon, Text } from '../components/ui';
import { colors, radius, space, touch } from '../theme/tokens';
import type { VoiceLive, VoiceUiPhase } from './types';
import { maskSpoken, voiceTranscript, type DealerLine, type TranscriptEntry, type TranscriptSource } from './voiceTranscript';

/** Sheet height as a share of the window (mockups frame2 / frame3). */
export const TRANSCRIPT_SHEET_RATIO = 0.6;

const SOURCE_LABEL: Record<TranscriptSource, string> = { phone: 'On phone', server: 'Server', typed: 'Typed' };

function Chip({ label, tone }: { label: string; tone: 'phone' | 'server' | 'hidden' | 'typed' }) {
  const bg = tone === 'phone' ? colors.successSoft : tone === 'server' ? '#E6F0F7' : colors.surfaceMuted;
  const fg = tone === 'phone' ? colors.success : tone === 'server' ? '#1D5C86' : colors.textSecondary;
  return (
    <View style={{ paddingHorizontal: space.xs, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: bg, borderWidth: 1, borderColor: tone === 'hidden' ? colors.border : 'transparent' }}>
      <Text variant="caption" color={fg} maxFontSizeMultiplier={1.2} style={{ fontSize: 11, lineHeight: 15 }}>{label}</Text>
    </View>
  );
}

/** Interim words: grey with a caret. Final: solid ink. */
function Words({ text, final, hidden }: { text: string; final: boolean; hidden: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xxs, flexShrink: 1 }}>
      {hidden && <Icon name="lock-outline" size={16} color={colors.primary} />}
      <Text variant="body" color={final ? colors.text : colors.textSecondary} style={{ flexShrink: 1 }}
        accessibilityLabel={hidden ? 'One-time password, hidden' : undefined}>
        {text}{!final && <Text variant="body" color={colors.primary}>|</Text>}
      </Text>
    </View>
  );
}

function DealerRow({ e }: { e: DealerLine }) {
  return (
    <View style={{ alignItems: 'flex-end', gap: space.xxs }} testID="voice-transcript-dealer">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xxs }}>
        {e.hidden && <Chip label="Hidden" tone="hidden" />}
        <Chip label={SOURCE_LABEL[e.source]} tone={e.source} />
        <Text variant="caption" color={colors.textSecondary}>You</Text>
      </View>
      <View style={{ maxWidth: '88%', backgroundColor: colors.primaryTint, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomRightRadius: 4 }}>
        <Words text={e.text} final={e.final} hidden={e.hidden} />
      </View>
    </View>
  );
}

function ZippyRowView({ e }: { e: Extract<TranscriptEntry, { role: 'zippy' }> }) {
  if (e.kind === 'action') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: colors.successSoft }} testID="voice-transcript-action">
        <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={20} color={colors.onPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="overline" color={colors.success}>ACTION</Text>
          <Text variant="bodyStrong">{e.text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'flex-start', gap: space.xxs }}>
      <Text variant="caption" color={colors.textSecondary}>Zippy</Text>
      <View style={{ maxWidth: '88%', backgroundColor: e.kind === 'error' ? colors.dangerSoft : colors.aiThread, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomLeftRadius: 4 }}>
        <Text variant="body" color={colors.text}>{e.text}</Text>
      </View>
    </View>
  );
}

/**
 * v1.4.2: the live transcript — double-tap the mic. A bottom sheet (~60% of the screen) over a dimmed scrim,
 * with a handle, Zippy's face + "Live transcript", a close X and THIS SESSION's turns, chat-style: dealer lines
 * with an 'On phone' / 'Server' chip (interim grey + caret, solid when final), Zippy replies and action rows.
 * The staged "Did you mean" / Confirm (VoicePreviewSheet's behaviour) is composed in via `preview`, so the dealer
 * sees one surface. The sheet stops `micClear` dp above the bottom, so the mic disc below it is never covered.
 * Close: swipe down, the handle, the X, the scrim, Android back (VoiceHost) or double-tapping the mic again.
 *
 * Fed by VoiceHost from the same live state as the pill (voiceTranscript store). In memory only; OTP masked.
 */
export function VoiceTranscriptSheet({ onClose, micClear, live, phase, preview }: {
  onClose: () => void;
  /** Space kept free at the bottom for the mic (its bottom offset + disc + gap). */
  micClear: number;
  live: VoiceLive | null;
  phase: VoiceUiPhase;
  preview?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const entries = useSyncExternalStore(voiceTranscript.subscribe, voiceTranscript.entries, voiceTranscript.entries);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 48 || g.vy > 0.6) closeRef.current(); },
  }), []);

  // The current turn while it is still interim shows in the live box at the bottom; history shows the rest.
  const current = live?.turn != null ? entries.find((e): e is DealerLine => e.role === 'dealer' && e.turn === live.turn) : undefined;
  const liveBox = current && !current.final ? current : null;
  const history = liveBox ? entries.filter((e) => e !== liveBox) : entries;
  const listening = phase === 'listening';
  const waitingLabel = listening && !liveBox ? maskSpoken(live?.text?.trim() ?? '').text : '';
  useEffect(() => { const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 30); return () => clearTimeout(t); }, [entries, preview]);

  const subtitle = preview ? 'Waiting for your confirm' : listening ? 'Listening — words appear as you speak' : phase === 'thinking' ? 'Checking what you said' : 'Words appear as you speak';
  // ~60% of the screen in all, the bottom band (micClear) left for the mic disc.
  const sheetH = Math.max(micClear + 280, Math.round(winH * TRANSCRIPT_SHEET_RATIO));
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 80, justifyContent: 'flex-end', paddingTop: insets.top }} testID="voice-transcript-sheet">
      <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim }} onPress={onClose}
        accessibilityRole="button" accessibilityLabel="Close live transcript" />
      <View accessibilityViewIsModal style={{ height: Math.min(sheetH, winH - insets.top - space.md), backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: micClear }}>
        <View {...pan.panHandlers}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close live transcript" hitSlop={8}
            style={{ alignSelf: 'center', paddingVertical: space.xs, paddingHorizontal: space.lg }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.primaryTint }}>
              <ZippyCharacter size={38} bust />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="h3" accessibilityRole="header">Live transcript</Text>
              <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{subtitle}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close live transcript" testID="voice-transcript-close"
              style={({ pressed }) => ({ width: touch.min, height: touch.min, borderRadius: touch.min / 2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
              <Icon name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.md, flexGrow: 1, justifyContent: 'flex-end' }}
          keyboardShouldPersistTaps="handled" accessibilityLiveRegion="polite">
          {!history.length && !liveBox && !preview && (
            <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>Hold the mic and speak. What you say this session shows here — never saved.</Text>
          )}
          {history.map((e) => (e.role === 'dealer' ? <DealerRow key={e.id} e={e} /> : <ZippyRowView key={e.id} e={e} />))}
          {preview}
        </ScrollView>
        {(preview || history.length > 0) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xxs, paddingVertical: space.xxs }}>
            <Icon name="chevron-down" size={14} color={colors.textSecondary} />
            <Text variant="caption" color={colors.textSecondary}>Swipe down or double-tap the mic to close</Text>
          </View>
        )}
        {(liveBox || listening) && (
          <View testID="voice-transcript-live" style={{ marginHorizontal: space.md, marginTop: space.xs, padding: space.sm, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted, gap: space.xxs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xxs }}>
              <Text variant="caption" color={colors.textSecondary}>You</Text>
              {liveBox?.hidden && <Chip label="Hidden" tone="hidden" />}
              <Chip label={SOURCE_LABEL[liveBox?.source ?? (live?.source === 'server' ? 'server' : 'phone')]} tone={liveBox?.source ?? (live?.source === 'server' ? 'server' : 'phone')} />
            </View>
            {liveBox ? <Words text={liveBox.text} final={false} hidden={liveBox.hidden} />
              : <Text variant="body" color={colors.textSecondary}>{waitingLabel || 'Listening…'}</Text>}
          </View>
        )}
      </View>
    </View>
  );
}
