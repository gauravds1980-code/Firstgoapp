import React from 'react';
import { View } from 'react-native';
import { Icon, PressableScale, Text } from '../ui';
import { answerTone, type AnswerToneName } from '../../theme/library';
import { radius, space, touch } from '../../theme/tokens';
import { maskSpoken } from '../../voice/voiceTranscript';
import { maskMobilesIn } from '../../services/loanStatus';

/**
 * Design library (feature 5, v1.4.9): the on-screen companion to a Piper status answer, so the dealer can read it in a
 * noisy showroom. Same bones as AlertCard: leading Zippy well, the recognised question as a caption, the answer as
 * bodyStrong, optional close. Tones reuse Banner's washes (info / warning = Money in flight unavailable / success =
 * credited). Question and answer are masked: OTP digits never show, a mobile number shows its last four only.
 */
export function VoiceAnswerCard({ question, answer, tone = 'info', onPress, onClose }: {
  question?: string; answer: string; tone?: AnswerToneName; onPress?: () => void; onClose?: () => void;
}) {
  const t = answerTone[tone];
  const q = question ? maskMobilesIn(maskSpoken(question).text) : '';
  const a = maskMobilesIn(maskSpoken(answer).text);
  const body = (
    <>
      <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: answerTone.well, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="bodyStrong" color={t.fg}>Z</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {q ? <Text variant="caption" color={answerTone.question} numberOfLines={2}>{`“${q}”`}</Text> : null}
        <Text variant="bodyStrong" color={answerTone.answer}>{a}</Text>
      </View>
      {onClose ? (
        <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss answer" hitSlop={8}
          style={{ width: touch.min, height: touch.min, marginTop: -space.xs, marginRight: -space.xs, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color={answerTone.question} />
        </PressableScale>
      ) : null}
    </>
  );
  const style = { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: t.bg };
  const label = [q ? `You asked: ${q}` : undefined, `Zippy: ${a}`].filter(Boolean).join('. ');
  return onPress
    ? <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={style}>{body}</PressableScale>
    : <View accessible={!onClose} accessibilityLabel={label} accessibilityLiveRegion="polite" style={style}>{body}</View>;
}
