import React, { useReducer, useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { ZippyAvoid } from '../components/assistant/zippyAvoid';
import { Icon, PressableScale, Text } from '../components/ui';
import { SHOW_DEV_UI } from '../config/devFlags';
import { colors, radius, space, touch } from '../theme/tokens';
import { deviceAsrSupport } from './deviceAsr';
import { METRIC_NAMES, voiceMetrics, type MetricName } from './voiceMetrics';
import { recognizerLang, type TalkMode, type VoiceLocale } from './voiceMode';
import { setVoiceSetting, useVoiceSettings } from './voiceSettings';

const MODES: { key: TalkMode; label: string }[] = [{ key: 'ptt', label: 'Hold to talk' }, { key: 'handsfree', label: 'Tap to talk' }];
const LOCALES: { key: VoiceLocale; label: string }[] = [{ key: 'en-IN', label: 'English (India)' }, { key: 'hi-IN', label: 'Hindi' }, { key: 'auto', label: 'Auto' }];
const METRIC_LABEL: Record<MetricName, string> = {
  pressToFeedback: 'Press → mic lights up',
  releaseToText: 'Let go → words shown',
  releaseToAction: 'Let go → screen acts',
  releaseToAudio: 'Let go → Zippy speaks',
  releaseToCheck: 'Let go → server double-check',
  releaseToGate: 'Let go → unsure words checked',
};

const card = { gap: space.sm, padding: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border } as const;

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <ZippyAvoid>
      <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <PressableScale key={o.key} onPress={() => onChange(o.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
              style={{ flex: 1, minHeight: touch.min, paddingHorizontal: space.xs, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.primary : colors.surfaceMuted }}>
              <Text variant="label" color={on ? colors.onPrimary : colors.text} numberOfLines={1}>{o.label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </ZippyAvoid>
  );
}

/**
 * Voice settings (v1.4.0) in Profile: talk mode (default hold-to-talk), recognizer language, the phone's own
 * speech recognizer (feature flag `voice.onDeviceAsr`), spoken replies vs cue sounds (`voice.spokenReplies`), and "Voice speed stats" (p50 / p95 of the last 50 turns).
 */
export function VoiceSettingsPanel() {
  const s = useVoiceSettings();
  const [showStats, setShowStats] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const sup = deviceAsrSupport(recognizerLang(s.locale));
  const asrNote = Platform.OS === 'web' ? 'Not available on web — the voice server is used.'
    : !sup.moduleLoaded ? 'Not in this build — the voice server is used.'
    : !sup.available ? 'No speech service on this phone — the voice server is used.'
    : sup.onDevice ? 'Works offline on this phone. The server double-checks in the background.'
    : sup.service && sup.service !== 'default' ? 'Uses the Google speech service on this phone. The server double-checks in the background.'
    : 'Uses the phone’s recognizer. The server double-checks in the background.';
  const summary = showStats ? voiceMetrics.summary() : null;
  const turns = voiceMetrics.turns();
  const onDeviceShare = turns.length ? Math.round((turns.filter((t) => t.path === 'device').length / turns.length) * 100) : 0;
  return (
    <View style={card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="microphone-settings" size={22} color={colors.primary} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>Talking to Zippy</Text>
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="caption" color={colors.textSecondary}>Talk mode</Text>
        <Segmented label="Talk mode" value={s.mode} options={MODES} onChange={(v) => setVoiceSetting('mode', v)} />
        <Text variant="caption" color={colors.textMuted}>
          {s.mode === 'ptt' ? 'Hold the mic while you speak; letting go sends it.' : 'Tap the mic once and speak; Zippy acts when you stop. Tap again to cancel.'}
        </Text>
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="caption" color={colors.textSecondary}>Language</Text>
        <Segmented label="Voice language" value={s.locale} options={LOCALES} onChange={(v) => setVoiceSetting('locale', v)} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Use the phone’s speech recognizer</Text>
          <Text variant="caption" color={colors.textSecondary}>Shows your words as you speak and acts faster. {asrNote}</Text>
        </View>
        <ZippyAvoid>
          <Switch value={s.onDeviceAsr} onValueChange={(on) => setVoiceSetting('onDeviceAsr', on)} accessibilityLabel="Use the phone’s speech recognizer"
            trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
        </ZippyAvoid>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Zippy speaks replies</Text>
          <Text variant="caption" color={colors.textSecondary}>When off, Zippy plays a short sound instead of spoken words: a chime when done, a low blip to say it again, a soft pulse to confirm. Turn on to hear Zippy speak.</Text>
        </View>
        <ZippyAvoid>
          <Switch value={s.spokenReplies} onValueChange={(on) => setVoiceSetting('spokenReplies', on)} accessibilityLabel="Zippy speaks replies"
            trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
        </ZippyAvoid>
      </View>
      {Platform.OS !== 'web' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Live words from the voice server</Text>
            <Text variant="caption" color={colors.textSecondary}>When the voice server listens, show your words while you speak. Uses about 2 MB of data per minute of talking.</Text>
          </View>
          <ZippyAvoid>
            <Switch value={s.serverStream} onValueChange={(on) => setVoiceSetting('serverStream', on)} accessibilityLabel="Live words from the voice server"
              trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
          </ZippyAvoid>
        </View>
      )}
      <PressableScale onPress={() => { setShowStats((v) => !v); refresh(); }} accessibilityRole="button" accessibilityState={{ expanded: showStats }} accessibilityLabel="Voice speed stats"
        style={{ minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="speedometer" size={20} color={colors.primary} />
        <Text variant="label" style={{ flex: 1 }}>Voice speed stats</Text>
        <ZippyAvoid><Icon name={showStats ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textSecondary} /></ZippyAvoid>
      </PressableScale>
      {summary && (
        <View style={{ gap: space.xxs }} accessibilityLabel="Voice speed stats, last 50 turns">
          <Text variant="caption" color={colors.textSecondary}>Last {turns.length} turns · {onDeviceShare}% on the phone’s recognizer · p50 / p95 in ms</Text>
          {METRIC_NAMES.map((n) => {
            const m = summary[n];
            const slow = m.target !== undefined && m.p95 !== null && m.p95 > m.target;
            return (
              <View key={n} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <Text variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>{METRIC_LABEL[n]}{m.target ? ` (< ${m.target})` : ''}</Text>
                <Text variant="caption" color={slow ? colors.danger : colors.text}>{m.n ? `${m.p50} / ${m.p95}` : '—'}</Text>
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <PressableScale onPress={refresh} accessibilityRole="button" accessibilityLabel="Refresh stats" style={{ minHeight: touch.min, justifyContent: 'center' }}>
              <Text variant="label" color={colors.primary}>Refresh</Text>
            </PressableScale>
            <PressableScale onPress={() => { voiceMetrics.reset(); refresh(); }} accessibilityRole="button" accessibilityLabel="Reset stats" style={{ minHeight: touch.min, justifyContent: 'center' }}>
              <Text variant="label" color={colors.primary}>Reset</Text>
            </PressableScale>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" color={colors.text}>Show voice debug line</Text>
              <Text variant="caption" color={colors.textMuted}>One line under the live words: which recognizer was used and why.</Text>
            </View>
            <ZippyAvoid>
              <Switch value={s.debugAsr} onValueChange={(on) => setVoiceSetting('debugAsr', on)} accessibilityLabel="Show voice debug line"
                trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
            </ZippyAvoid>
          </View>
          {Platform.OS !== 'web' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="caption" color={colors.text}>Check with the voice server while you speak (test)</Text>
                <Text variant="caption" color={colors.textMuted}>Phone recognizer only. Sends your voice to the server as you talk so unclear words are checked faster. Some phones can’t share the mic; it turns itself off if so.</Text>
              </View>
              <ZippyAvoid>
                <Switch value={s.parallelStream} onValueChange={(on) => setVoiceSetting('parallelStream', on)} accessibilityLabel="Check with the voice server while you speak"
                  trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
              </ZippyAvoid>
            </View>
          )}
          {SHOW_DEV_UI && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>Log each turn to the console (dev)</Text>
              <Switch value={s.metricsLog} onValueChange={(on) => setVoiceSetting('metricsLog', on)} accessibilityLabel="Log voice metrics" />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
