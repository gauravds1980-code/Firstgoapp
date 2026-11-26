import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, useWindowDimensions, View } from 'react-native';

type ViewToken = { item: unknown; index?: number | null; isViewable: boolean };
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useEventListener } from 'expo';
import { VideoView } from 'expo-video';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SHOW_DEV_UI } from '../../config/devFlags';
import { navRef } from '../../navigation/navRef';
import type { RootStackParamList } from '../../navigation/types';
import { useApp } from '../../state/AppState';
import { colors, fontScaleCap, radius, space, touch } from '../../theme/tokens';
import { ctaRouteFor, feedOrder, inJourney, playerWindow, progressOf, shouldShowSwipeHint, startIndexFor } from '../../tutorial/feed';
import { isComingSoon, useTutorialCatalog, type TutorialEntry } from '../../tutorial/manifest';
import { formatClock } from '../../tutorial/stuckDetector';
import { markPlayIntent, reportFirstFrame, tutorials, useLastTtff, useTutorialState, webForcedFeedHint } from '../../tutorial/tutorialStore';
import { useStreamingPlayer } from '../../tutorial/useTutorialVideo';
import { haptic } from '../../utils/haptics';
import { Icon, PressableScale, Text } from '../ui';
import { BrandSkeleton, Shimmer, TutorialPoster } from './TutorialPoster';

/** Played this share of a short → watched. */
const WATCHED_AT = 0.9;
/** The swipe hint hides itself after this long (or on the first swipe). */
const HINT_MS = 2500;
const AMBER = colors.cta;

/**
 * Reels / Shorts-style vertical feed of how-to videos (v1.3.0), a full-screen route (/shorts/:startId).
 *  - One page per short, exactly one window tall: swipe up = next, swipe down = previous (paged
 *    FlatList with snapToInterval, fast deceleration, no interval momentum; getItemLayout for an
 *    instant jump to the start page). Web: wheel or ↑ / ↓ keys.
 *  - The page that is ≥ 80% visible autoplays and loops; others pause and rewind.
 *  - Players live only for the active page and the next two (preloaded, paused): at most 3.
 *  - Catalogue shorts play from the file bundled in the app (native) or same-origin /tutorial (web);
 *    the remote stream is only a fallback (useStreamingPlayer).
 *  - Poster shows instantly (bundled; shimmer until the first frame). If the page is not playing
 *    after a moment (web autoplay blocked), the play button shows so one tap starts it with sound.
 *  - A load failure shows "Couldn't load" / "You're offline" with Retry. Only shorts the catalogue
 *    does not ship are "coming soon" (branded skeleton, skippable).
 *  - Top: progress bar, close (left), mute (right; session-wide). Tap the video = pause / play.
 *  - Bottom: title, subtitle and "Try it now" (closes the feed and opens that feature).
 */
export default function ShortsFeed() {
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ShortsFeed'>>();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const catalog = useTutorialCatalog();
  const { session, profile } = useApp();
  const { feedMuted, feedHintSeen, hydrated } = useTutorialState();

  const order = useMemo(() => feedOrder(catalog.entries.map((e) => e.id), { signedIn: !!session }), [catalog.entries, session]);
  const items = useMemo(() => order.map((id) => catalog.byId[id]!).filter(Boolean), [order, catalog.byId]);
  const [startIndex] = useState(() => startIndexFor(order, params?.startId));
  const [active, setActive] = useState(startIndex);
  const activeRef = useRef(active);
  activeRef.current = active;
  const listRef = useRef<FlatList<TutorialEntry>>(null);
  const [progress, setProgress] = useState(0);

  const soon = useCallback((i: number) => isComingSoon(items[i]), [items]);
  const live = useMemo(() => new Set(playerWindow(active, items.length, 2, soon)), [active, items.length, soon]);

  // Swiping onto a page is a play intent (time to first frame starts there).
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const v = viewableItems.find((x) => x.isViewable && x.index != null);
    if (v?.index == null || v.index === activeRef.current) return;
    const e = v.item as TutorialEntry | undefined;
    if (e) markPlayIntent(e.id);
    setProgress(0);
    setActive(v.index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  // Swipe hint: first open ever (persisted) or forced with ?feedhint=1; hides after HINT_MS or a swipe.
  const [hint, setHint] = useState(false);
  const hintDecided = useRef(false);
  useEffect(() => {
    if (hintDecided.current || !hydrated) return;
    hintDecided.current = true;
    if (shouldShowSwipeHint({ seenBefore: feedHintSeen, forced: webForcedFeedHint(), count: items.length, startIndex })) {
      setHint(true); tutorials.markFeedHintSeen();
    }
  }, [hydrated, feedHintSeen, items.length, startIndex]);
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(false), HINT_MS); return () => clearTimeout(t); }, [hint]);
  useEffect(() => { if (active !== startIndex) setHint(false); }, [active, startIndex]);

  const goTo = useCallback((i: number) => {
    if (i < 0 || i >= items.length) return;
    listRef.current?.scrollToIndex({ index: i, animated: true });
  }, [items.length]);
  // Web: ↑ / ↓ / PageUp / PageDown / j / k / Escape.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const w = globalThis as unknown as { addEventListener?: (t: string, f: (e: { key: string; preventDefault: () => void }) => void) => void; removeEventListener?: (t: string, f: unknown) => void };
    const onKey = (e: { key: string; preventDefault: () => void }) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); goTo(activeRef.current + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); goTo(activeRef.current - 1); }
      else if (e.key === 'Escape') close();
    };
    w.addEventListener?.('keydown', onKey);
    return () => w.removeEventListener?.('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo]);

  const close = () => { if (nav.canGoBack()) nav.goBack(); else navRef.isReady() && navRef.navigate('Home'); };
  const tryIt = (e: TutorialEntry) => {
    const stack = (navRef.isReady() ? navRef.getRootState()?.routes.map((r) => r.name) : []) ?? [];
    const route = ctaRouteFor(e.id, { signedIn: !!session, inJourney: inJourney(stack), hasTaInf: profile?.hasTaInf });
    if (!route) return;
    haptic.tap();
    close();
    setTimeout(() => { if (navRef.isReady()) navRef.navigate(route as never); }, 220);
  };
  const ctaFor = (e: TutorialEntry) => ctaRouteFor(e.id, { signedIn: !!session, inJourney: true, hasTaInf: profile?.hasTaInf });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} accessibilityViewIsModal>
      <StatusBar style="light" />
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(e) => e.id}
        renderItem={({ item, index }) => (
          <FeedPage entry={item} index={index} count={items.length} W={W} H={H} insets={insets}
            active={index === active} hasPlayer={live.has(index)} comingSoon={soon(index)} muted={feedMuted}
            onProgress={index === active ? setProgress : undefined} cta={!!ctaFor(item)} onTry={() => tryIt(item)} />
        )}
        getItemLayout={(_, i) => ({ length: H, offset: H * i, index: i })}
        initialScrollIndex={startIndex}
        pagingEnabled
        snapToInterval={H}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewabilityConfig}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        removeClippedSubviews={false}
        extraData={`${active}|${feedMuted}|${[...live].join(',')}`}
        onScrollToIndexFailed={({ index }) => setTimeout(() => listRef.current?.scrollToIndex({ index, animated: false }), 50)}
        style={{ flex: 1 }}
      />

      {/* Top chrome: progress bar, close, mute. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top + space.xs, paddingHorizontal: space.sm }}>
        <View accessibilityRole="progressbar" accessibilityLabel="Video progress" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          style={{ height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
          <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: AMBER }} />
        </View>
        <View pointerEvents="box-none" style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }}>
          <ChromeButton icon="close" label="Close shorts" onPress={close} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Text variant="label" color="rgba(255,255,255,0.85)" maxFontSizeMultiplier={fontScaleCap.control}>{Math.min(active + 1, items.length)} / {items.length}</Text>
            <ChromeButton icon={feedMuted ? 'volume-off' : 'volume-high'} label={feedMuted ? 'Unmute' : 'Mute'} onPress={() => { haptic.select(); tutorials.setFeedMuted(!feedMuted); }} />
          </View>
        </View>
        {SHOW_DEV_UI && <TtffBadge />}
      </View>

      {hint && <SwipeHint bottom={insets.bottom + 150} />}
    </View>
  );
}

function ChromeButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={{ width: touch.min, height: touch.min, borderRadius: touch.min / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <Icon name={icon} size={24} color="#fff" />
    </PressableScale>
  );
}

/** Dev-only: last time-to-first-frame measurement. */
function TtffBadge() {
  const t = useLastTtff();
  if (!t) return null;
  return (
    <View pointerEvents="none" style={{ alignSelf: 'center', marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Text variant="caption" color="#9EF0B8">TTFF {t.ms} ms · {t.kind} · {t.id}</Text>
    </View>
  );
}

/** "Swipe up for the next how-to" with a bobbing chevron (static with reduced motion). */
function SwipeHint({ bottom }: { bottom: number }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withRepeat(withSequence(withTiming(-14, { duration: 520 }), withTiming(0, { duration: 520 })), -1);
  }, [reduce, y]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(220)} pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center' }} accessibilityLiveRegion="polite">
      <Animated.View style={[{ alignItems: 'center', gap: 2, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.5)' }, st]}>
        <Icon name="chevron-double-up" size={28} color="#fff" />
        <Text variant="bodyStrong" color="#fff">Swipe up for the next how-to</Text>
      </Animated.View>
    </Animated.View>
  );
}

type Insets = { top: number; bottom: number; left: number; right: number };

function FeedPage({ entry, index, count, W, H, insets, active, hasPlayer, comingSoon, muted, onProgress, cta, onTry }: {
  entry: TutorialEntry; index: number; count: number; W: number; H: number; insets: Insets; active: boolean; hasPlayer: boolean; comingSoon: boolean;
  muted: boolean; onProgress?: (p: number) => void; cta: boolean; onTry: () => void;
}) {
  const [firstFrame, setFirstFrame] = useState(false);
  useEffect(() => { if (!hasPlayer) setFirstFrame(false); }, [hasPlayer]);
  return (
    <View style={{ width: W, height: H, backgroundColor: '#000' }}>
      {/* Poster first (instant), shimmer until the first frame. */}
      {comingSoon
        ? <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}><BrandSkeleton mark={0} shimmer={false} /></View>
        : !firstFrame && <TutorialPoster entry={entry} variant="poster" fit="contain" mark={72} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />}
      {!comingSoon && !firstFrame && <Shimmer on />}
      {!comingSoon && hasPlayer && (
        <PageVideo entry={entry} active={active} muted={muted} onProgress={onProgress} onFirstFrame={() => setFirstFrame(true)} firstFrame={firstFrame} />
      )}
      {comingSoon && (
        <View pointerEvents="none" style={{ position: 'absolute', left: space.lg, right: space.lg, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
          <Icon name="play-box-multiple-outline" size={64} color="rgba(255,255,255,0.35)" style={{ marginBottom: space.xs }} />
          <View style={{ paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: AMBER }}>
            <Text variant="label" color={colors.onCta}>COMING SOON</Text>
          </View>
          <Text variant="h2" color="#fff" style={{ textAlign: 'center' }}>This how-to is coming soon</Text>
          {index < count - 1 && <Text variant="body" color="rgba(255,255,255,0.85)" style={{ textAlign: 'center' }}>Swipe up for the next one.</Text>}
        </View>
      )}

      {/* Bottom overlay: title, subtitle, Try it now. */}
      <LinearGradient pointerEvents="box-none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.xxl, paddingHorizontal: space.md, paddingBottom: insets.bottom + space.md, gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Text variant="h3" color="#fff" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={{ flexShrink: 1 }} accessibilityRole="header">{entry.title}</Text>
          <Text variant="label" color="rgba(255,255,255,0.75)" maxFontSizeMultiplier={fontScaleCap.control}>{formatClock(entry.durationSec)}</Text>
        </View>
        {entry.subtitle ? <Text variant="body" color="rgba(255,255,255,0.88)" numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact}>{entry.subtitle}</Text> : null}
        {cta && (
          <PressableScale onPress={onTry} accessibilityRole="button" accessibilityLabel={`Try it now: ${entry.title}`}
            style={{ alignSelf: 'flex-start', marginTop: space.xxs, minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: AMBER }}>
            <Text variant="bodyStrong" color={colors.onCta} maxFontSizeMultiplier={fontScaleCap.control}>Try it now</Text>
            <Icon name="arrow-right" size={20} color={colors.onCta} />
          </PressableScale>
        )}
      </LinearGradient>
    </View>
  );
}

/**
 * Not playing this long after becoming active (and not paused by the dealer): show the play button.
 * Browsers block autoplay with sound, so on web this is how a stuck poster becomes tappable.
 */
const NEEDS_TAP_MS = 1500;

/** The live player of one page: plays while active, pauses + rewinds otherwise, loops. */
function PageVideo({ entry, active, muted, onProgress, onFirstFrame, firstFrame }: {
  entry: TutorialEntry; active: boolean; muted: boolean; onProgress?: (p: number) => void; onFirstFrame: () => void; firstFrame: boolean;
}) {
  const { player, kind, state, failure, retry } = useStreamingPlayer(entry, { muted, loop: true });
  const [playing, setPlaying] = useState(false);
  /** Paused by a tap: a persistent play button (Reels-style) until resumed. */
  const [userPaused, setUserPaused] = useState(false);
  /** Active but not playing although nobody paused it (autoplay blocked): show the play button too. */
  const [needsTap, setNeedsTap] = useState(false);
  const [glyph, setGlyph] = useState<{ n: number } | null>(null);
  const watched = useRef(false);

  useEffect(() => { player.muted = muted; }, [player, muted]);
  useEffect(() => {
    setUserPaused(false);
    setNeedsTap(false);
    if (active) { try { player.play(); } catch { /* released */ } return; }
    try { player.pause(); player.currentTime = 0; } catch { /* released */ }
  }, [active, player]);
  // A source became ready after a fallback swap or a Retry: keep the active page playing.
  useEffect(() => {
    if (!active || state !== 'ready' || userPaused) return;
    try { if (!player.playing) player.play(); } catch { /* released */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  // Became active with the first frame already rendered (preloaded): time to first frame ≈ 0.
  useEffect(() => { if (active && firstFrame) reportFirstFrame(entry.id, kind); }, [active, firstFrame, entry.id, kind]);
  // Web: play() before the <video> mounts is a no-op, so start again right after mount.
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const t = setTimeout(() => { try { player.play(); } catch { /* released */ } }, 0);
    return () => clearTimeout(t);
  }, [player, active]);

  useEventListener(player, 'playingChange', ({ isPlaying }) => { setPlaying(isPlaying); if (isPlaying) setNeedsTap(false); });
  // Ready (or still loading on web, where a blocked autoplay can stall before readyToPlay) but not
  // playing, and the dealer did not pause it: offer the play button instead of a poster forever.
  const stuck = active && !playing && !userPaused && state !== 'failed' && (state === 'ready' || Platform.OS === 'web');
  useEffect(() => {
    if (!stuck) return;
    const t = setTimeout(() => setNeedsTap(true), NEEDS_TAP_MS);
    return () => clearTimeout(t);
  }, [stuck]);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const d = player.duration;
    onProgress?.(progressOf(currentTime, d));
    if (!watched.current && d > 0 && currentTime / d >= WATCHED_AT) { watched.current = true; tutorials.markWatched(entry.id); }
  });

  const toggle = () => {
    if (state === 'failed') return;
    const pause = !userPaused && playing;
    // Called straight from the tap, so a browser that blocked autoplay allows play() (sound stays on).
    try { if (pause) player.pause(); else player.play(); } catch { /* released */ }
    haptic.select();
    setUserPaused(pause);
    setNeedsTap(false);
    if (!pause) setGlyph({ n: Date.now() }); // brief "playing again" flash
  };
  useEffect(() => { if (!glyph) return; const t = setTimeout(() => setGlyph(null), 700); return () => clearTimeout(t); }, [glyph]);

  return (
    <>
      {/* Sized wrapper: on web the <video> is a replaced element, so insets alone would leave it at its
          intrinsic 720x1280; an explicit 100% box makes contentFit="contain" fit the page. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: firstFrame ? 1 : 0 }}>
        <VideoView player={player} nativeControls={false} contentFit="contain" allowsPictureInPicture={false} fullscreenOptions={{ enable: false }}
          onFirstFrameRender={() => { onFirstFrame(); if (active) reportFirstFrame(entry.id, kind); }}
          accessibilityLabel={`${entry.title} video`} style={{ width: '100%', height: '100%' }} />
      </View>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={userPaused || needsTap ? 'Play video' : 'Pause video'}
        style={{ position: 'absolute', left: 0, top: 110, right: 0, bottom: 190 }} />
      {firstFrame && state === 'loading' && active && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: '46%', alignItems: 'center' }}><ActivityIndicator color="#fff" size="large" /></View>
      )}
      {(userPaused || needsTap || glyph) && state !== 'failed' && (
        <Animated.View key={userPaused || needsTap ? 'paused' : glyph?.n} entering={FadeIn.duration(120)} exiting={FadeOut.duration(250)} pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, top: '44%', alignItems: 'center' }} accessibilityLiveRegion="polite" accessibilityLabel={userPaused ? 'Paused' : needsTap ? 'Tap to play' : undefined}>
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="play" size={44} color="#fff" style={{ marginLeft: 4 }} />
          </View>
        </Animated.View>
      )}
      {state === 'failed' && (
        <View style={{ position: 'absolute', left: space.lg, right: space.lg, top: '34%', alignItems: 'center', gap: space.sm }}>
          <Icon name={failure === 'offline' ? 'wifi-off' : 'alert-circle-outline'} size={40} color="#fff" />
          <Text variant="h3" color="#fff" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
            {failure === 'offline' ? 'You’re offline — connect to watch this how-to' : 'Couldn’t load this how-to'}
          </Text>
          <PressableScale onPress={() => { haptic.tap(); setNeedsTap(false); retry(); }}
            accessibilityRole="button" accessibilityLabel="Retry"
            style={{ minHeight: touch.min, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: AMBER, justifyContent: 'center' }}>
            <Text variant="bodyStrong" color={colors.onCta}>Retry</Text>
          </PressableScale>
        </View>
      )}
    </>
  );
}
