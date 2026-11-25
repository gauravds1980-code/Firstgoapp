import React, { useEffect } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { TutorialPoster } from '../components/tutorial/TutorialPoster';
import { PreloadTutorial } from '../tutorial/useTutorialVideo';
import { feedOrder } from '../tutorial/feed';
import { JourneyScreen } from '../components/Screen';
import { Icon, PressableScale, Text } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { colors, elevation, fontScaleCap, gutter, radius, space, touch } from '../theme/tokens';
import { isComingSoon, useTutorialCatalog, type TutorialEntry } from '../tutorial/manifest';
import { formatClock } from '../tutorial/stuckDetector';
import { tutorials, useTutorialState } from '../tutorial/tutorialStore';

/** Below this window width the shorts are a one-column list instead of a 2-column grid. */
const GRID_MIN_W = 340;

/**
 * Help & tutorials (v1.3.0): the full walkthrough as a hero card, then every short (thumbnail, title,
 * duration badge, "Watched" tick, or "Coming soon"). Thumbnails stream (branded skeleton until they
 * load). Tapping one opens the Reels-style shorts feed at that short. `focus` (deep link
 * /help?focus=mandate) opens the feed straight away. While focused, the first unwatched short that can
 * stream is preloaded (one paused player) so the first tap starts fast.
 */
export default function HelpScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Help'>>();
  const { width } = useWindowDimensions();
  const { watched } = useTutorialState();
  const { entries, byId, failed } = useTutorialCatalog();
  const focused = useIsFocused();
  const nav = useNavigation();
  const focus = params?.focus;
  useEffect(() => { if (focus && byId[focus]) tutorials.openShorts(focus); }, [focus, byId]);

  const hero = byId.full!;
  const shorts = feedOrder(entries.map((e) => e.id)).filter((id) => id !== 'full').map((id) => byId[id]!).filter(Boolean);
  const soon = (t: TutorialEntry) => isComingSoon(t, failed);
  const preload = shorts.find((t) => !soon(t) && !watched.has(t.id)) ?? shorts.find((t) => !soon(t));
  const grid = width >= GRID_MIN_W;
  // Exact half-width cards, so an odd last card stays half width instead of stretching.
  const cardW = Math.floor((width - gutter.screen * 2 - space.sm) / 2);
  return (
    <JourneyScreen title="Help & tutorials" assistant="help" showTerms={false}>
      {focused && preload && <PreloadTutorial key={preload.id} entry={preload} />}
      {/* Hero: the full tutorial */}
      <PressableScale onPress={() => tutorials.openShorts(hero.id)} accessibilityRole="button"
        accessibilityLabel={`Play ${hero.title}, ${formatClock(hero.durationSec)}${watched.has(hero.id) ? ', watched' : ''}`}
        style={[{ borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }, elevation.card as object]}>
        <Thumb entry={hero} height={188} play={52} watched={watched.has(hero.id)} soon={soon(hero)} />
        <ZippyAvoid style={{ padding: space.md, gap: space.xxs, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="label" color={colors.primary}>START HERE</Text>
            <Text variant="h3" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{hero.title}</Text>
            <Text variant="caption" color={colors.textSecondary} numberOfLines={2}>{hero.subtitle}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xxs, minHeight: touch.min, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: soon(hero) ? colors.surfaceMuted : colors.cta }}>
            <Icon name={soon(hero) ? 'clock-outline' : 'play'} size={20} color={soon(hero) ? colors.textSecondary : colors.onCta} />
            <Text variant="label" color={soon(hero) ? colors.textSecondary : colors.onCta} maxFontSizeMultiplier={fontScaleCap.control}>{soon(hero) ? 'Soon' : 'Play'}</Text>
          </View>
        </ZippyAvoid>
      </PressableScale>

      <ZippyAvoid style={{ gap: space.xs, alignSelf: 'flex-start', maxWidth: '100%' }}>
        <Text variant="h2" accessibilityRole="header">Short how-tos</Text>
        <Text variant="caption" color={colors.textSecondary}>One for every step. Swipe through them like reels.</Text>
      </ZippyAvoid>

      {grid ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {shorts.map((t) => <GridCard key={t.id} entry={t} watched={watched.has(t.id)} soon={soon(t)} width={cardW} />)}
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {shorts.map((t) => <ListRow key={t.id} entry={t} watched={watched.has(t.id)} soon={soon(t)} />)}
        </View>
      )}

      {/* Written answers live on Help & support (also in Profile). */}
      <PressableScale onPress={() => nav.navigate('HelpSupport')} accessibilityRole="button" accessibilityLabel="FAQs and support. Quick answers and how to reach a person"
        style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        <Icon name="lifebuoy" size={22} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>FAQs & support</Text>
          <Text variant="caption" color={colors.textSecondary} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>Quick answers and how to reach a person</Text>
        </View>
        <ZippyAvoid><Icon name="chevron-right" size={22} color={colors.textSecondary} /></ZippyAvoid>
      </PressableScale>
    </JourneyScreen>
  );
}

const a11y = (t: TutorialEntry, watched: boolean, soon = false) => `${soon ? 'Coming soon' : 'Play'}: ${t.title}, ${formatClock(t.durationSec)}${watched ? ', watched' : ''}`;

/** Streamed thumbnail (cover-cropped, skeleton until loaded), play glyph, duration badge, "Watched" / "Coming soon". */
function Thumb({ entry, height, play, watched, soon = false, width = '100%' }: { entry: TutorialEntry; height: number; play: number; watched: boolean; soon?: boolean; width?: number | '100%' }) {
  return (
    // The picture is soft for floating Zippy (it may rest there if nothing else is free); the duration badge is hard.
    <ZippyAvoid weight="soft" style={{ width, height, backgroundColor: colors.primaryDark }}>
      <TutorialPoster entry={entry} variant="thumb" mark={play} style={{ width: '100%', height: '100%' }} />
      {/* Play glyph in the bottom-left corner, so it never covers the title in the middle of the thumbnail. */}
      {!soon && <View pointerEvents="none" style={{ position: 'absolute', left: 6, bottom: 6, width: play, height: play, borderRadius: play / 2, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="play" size={play * 0.55} color={colors.onPrimary} style={{ marginLeft: play * 0.06 }} />
      </View>}
      <ZippyAvoid style={{ position: 'absolute', right: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.7)' }}>
        <Text variant="label" color={colors.onPrimary} maxFontSizeMultiplier={fontScaleCap.control} style={{ fontVariant: ['tabular-nums'] }}>{formatClock(entry.durationSec)}</Text>
      </ZippyAvoid>
      {soon ? <SoonTag style={{ position: 'absolute', left: 6, top: 6 }} /> : watched && <WatchedTag style={{ position: 'absolute', left: 6, top: 6 }} />}
    </ZippyAvoid>
  );
}

function SoonTag({ style }: { style?: object }) {
  return (
    <View style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.cta }, style]}>
      <Text variant="label" color={colors.onCta} maxFontSizeMultiplier={fontScaleCap.control}>Coming soon</Text>
    </View>
  );
}

function WatchedTag({ style }: { style?: object }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.successSoft }, style]}>
      <Icon name="check-circle" size={14} color={colors.success} />
      <Text variant="label" color={colors.success} maxFontSizeMultiplier={fontScaleCap.control}>Watched</Text>
    </View>
  );
}

function GridCard({ entry, watched, soon, width }: { entry: TutorialEntry; watched: boolean; soon: boolean; width: number }) {
  return (
    <PressableScale onPress={() => tutorials.openShorts(entry.id)} accessibilityRole="button" accessibilityLabel={a11y(entry, watched, soon)}
      style={[{ width, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }, elevation.card as object]}>
      <Thumb entry={entry} height={112} play={34} watched={watched} soon={soon} />
      {/* Title + subtitle: floating Zippy keeps off them. */}
      <ZippyAvoid style={{ padding: space.sm, gap: 2, minHeight: 64 }}>
        <Text variant="bodyStrong" numberOfLines={2} maxFontSizeMultiplier={fontScaleCap.compact}>{entry.title}</Text>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{entry.subtitle}</Text>
      </ZippyAvoid>
    </PressableScale>
  );
}

function ListRow({ entry, watched, soon }: { entry: TutorialEntry; watched: boolean; soon: boolean }) {
  return (
    <PressableScale onPress={() => tutorials.openShorts(entry.id)} accessibilityRole="button" accessibilityLabel={a11y(entry, watched, soon)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.xs, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ borderRadius: radius.md, overflow: 'hidden' }}><Thumb entry={entry} width={96} height={72} play={28} watched={false} soon={soon} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2, paddingRight: gutter.card / 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>{entry.title}</Text>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>{entry.subtitle}</Text>
        {watched && <WatchedTag style={{ alignSelf: 'flex-start' }} />}
      </View>
    </PressableScale>
  );
}
