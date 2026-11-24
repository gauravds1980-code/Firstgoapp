import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, Platform, Pressable, PressableProps, StyleProp, StyleSheet, Text as RNText,
  TextInput, TextInputProps, TextProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { button, colors, elevation, fontScaleCap, motion, radius, space, textFix, touch, type } from '../theme/tokens';
import { haptic } from '../utils/haptics';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
export const Icon = MaterialCommunityIcons;

type Variant = keyof typeof type;
/** All app text. `textFix` strips Android's Inter font padding once, so every variant centres the same on Android, iOS and web. */
export function Text({ variant = 'body', color = colors.text, style, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  return <RNText {...rest} style={[type[variant], textFix, { color }, style]} />;
}

/**
 * CTA label shared by <Button> and custom pill CTAs (e.g. Home hero): centred, wraps to at most
 * 2 lines instead of clipping, shrinks beside an icon, and caps OS font scaling so a 1.3× setting
 * can't blow the pill apart.
 */
export function ButtonLabel({ children, color, style }: { children: React.ReactNode; color: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text variant="h3" color={color} numberOfLines={2} maxFontSizeMultiplier={fontScaleCap.control} style={[s.btnLabel, style]}>
      {children}
    </Text>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable with scale-down press feedback + haptic tick. The pressable itself carries layout so absolute FABs stay hittable. */
export function PressableScale({ style, children, onPress, disabled, haptics = true, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; haptics?: boolean; children?: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.timing(scale, { toValue: v, duration: motion.fast, useNativeDriver: true }).start();
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={() => to(motion.pressScale)}
      onPressOut={() => to(1)}
      onPress={(e) => { if (haptics) haptic.tap(); onPress?.(e); }}
      accessibilityState={{ disabled: !!disabled, ...(rest.accessibilityState ?? {}) }}
      style={[style, { transform: [{ scale }] }, disabled ? { opacity: 0.5 } : null]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Button({ label, onPress, variant = 'primary', icon, iconRight, loading, disabled, style, accessibilityHint, fg: fgOverride }: {
  fg?: string; label: string; onPress?: () => void; variant?: 'primary' | 'brand' | 'secondary' | 'ghost'; icon?: IconName; iconRight?: IconName;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; accessibilityHint?: string;
}) {
  // primary = brand gold CTA (ink text for AA contrast); brand = maroon; secondary = outlined
  const bg = variant === 'primary' ? colors.cta : variant === 'brand' ? colors.primary : variant === 'secondary' ? colors.surface : 'transparent';
  const fg = fgOverride ?? (variant === 'primary' ? colors.onCta : variant === 'brand' ? colors.onPrimary : colors.primary);
  return (
    <PressableScale
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
      onPress={onPress} disabled={disabled || loading}
      style={[s.btn, { backgroundColor: bg }, variant === 'secondary' && s.btnSecondary, variant === 'ghost' && s.btnGhost, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Icon name={icon} size={20} color={fg} style={s.btnIcon} />}
          <ButtonLabel color={fg}>{label}</ButtonLabel>
          {iconRight && <Icon name={iconRight} size={20} color={fg} style={s.btnIcon} />}
        </>
      )}
    </PressableScale>
  );
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: string }) {
  return <View style={[s.card, tone ? { backgroundColor: tone, borderColor: 'transparent' } : null, style]}>{children}</View>;
}

export function Badge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  if (!count) return null;
  return (
    <View style={[s.badge, style]} accessibilityLabel={`${count} pending`}>
      <Text variant="caption" color={colors.onPrimary} maxFontSizeMultiplier={fontScaleCap.control} style={s.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'info' }) {
  const map = {
    neutral: [colors.surfaceMuted, colors.textSecondary], success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning], danger: [colors.dangerSoft, colors.danger], brand: [colors.primarySoft, colors.primary], info: ['#E7F3F8', '#1A5E86'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text variant="overline" color={fg} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control} style={s.pillText}>{label}</Text>
    </View>
  );
}

export function Skeleton({ w = '100%', h = 16, r = radius.sm, style }: { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const o = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.5, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View accessibilityLabel="Loading" style={[{ width: w, height: h, borderRadius: r, backgroundColor: colors.skeleton, opacity: o }, style]} />;
}

export function Banner({ tone, icon, title, body, style }: { tone: 'info' | 'warning' | 'danger' | 'success'; icon?: IconName; title: string; body?: string; style?: StyleProp<ViewStyle> }) {
  const map = {
    info: [colors.primaryTint, colors.primary, 'information-outline'],
    warning: [colors.warningSoft, colors.warning, 'alert-outline'],
    danger: [colors.dangerSoft, colors.danger, 'alert-circle-outline'],
    success: [colors.successSoft, colors.success, 'check-circle-outline'],
  } as const;
  const [bg, fg, def] = map[tone];
  return (
    <View style={[s.banner, { backgroundColor: bg }, style]} accessibilityRole="alert">
      <Icon name={icon ?? (def as IconName)} size={20} color={fg} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" color={fg}>{title}</Text>
        {body ? <Text variant="caption" color={colors.text} style={{ marginTop: 2 }}>{body}</Text> : null}
      </View>
    </View>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <View style={{ alignItems: 'center', padding: space.lg, gap: space.sm }}>
      <View style={[s.circle, { backgroundColor: colors.dangerSoft }]}><Icon name="wifi-off" size={28} color={colors.danger} /></View>
      <Text variant="h3" style={{ textAlign: 'center' }}>{title}</Text>
      <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center' }}>{body}</Text>
      {onRetry && <Button label="Try again" variant="secondary" icon="refresh" onPress={onRetry} style={{ alignSelf: 'stretch' }} />}
    </View>
  );
}

export function Field({ label, prefix, error, hint, right, ...input }: TextInputProps & { label: string; prefix?: string; error?: string; hint?: string; right?: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label">{label}</Text>
      <View style={[s.field, error ? { borderColor: colors.danger } : null]}>
        {prefix && <Text variant="bodyStrong" color={colors.textSecondary} maxFontSizeMultiplier={fontScaleCap.compact} style={s.prefix}>{prefix}</Text>}
        <TextInput
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          maxFontSizeMultiplier={fontScaleCap.compact}
          {...input}
          style={[inputText, s.input, { outlineStyle: 'none' } as object]}
        />
        {right}
      </View>
      {error ? <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text>
        : hint ? <Text variant="caption" color={colors.textSecondary}>{hint}</Text> : null}
    </View>
  );
}

export function ReadOnlyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      {/* Label + value tops line up; a strong (h3) value is 2px taller per line, so nudge the label to share its first baseline. */}
      <Text variant="body" color={colors.textSecondary} style={[s.rowLabel, strong && { paddingTop: (type.h3.lineHeight - type.body.lineHeight) / 2 }]}>{label}</Text>
      <Text variant={strong ? 'h3' : 'bodyStrong'} style={s.rowValue}>{value}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, inverse }: {
  options: { value: T; label: string; icon?: IconName }[]; value: T; onChange: (v: T) => void; inverse?: boolean;
}) {
  return (
    <View style={[s.seg, inverse && { backgroundColor: 'rgba(255,255,255,0.16)' }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        const fg = on ? (inverse ? colors.primary : colors.onPrimary) : inverse ? colors.onPrimary : colors.text;
        return (
          <Pressable
            key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            onPress={() => { haptic.select(); onChange(o.value); }}
            style={[s.segItem, on && { backgroundColor: inverse ? colors.surface : colors.primary }]}
          >
            {o.icon && <Icon name={o.icon} size={18} color={fg} />}
            <Text variant="label" color={fg} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.compact} style={s.segLabel}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 6-box OTP: autofocus, SMS autofill (oneTimeCode / sms-otp) and paste — pasted text is stripped to digits, so 'OTP is 123456' works. */
export function OtpInput({ value, onChange, length = 6, error, disabled, label = 'Enter OTP' }: { value: string; onChange: (v: string) => void; length?: number; error?: boolean; disabled?: boolean; label?: string }) {
  const ref = useRef<React.ComponentRef<typeof TextInput>>(null);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="One-time password" style={{ flexDirection: 'row', gap: space.xs, justifyContent: 'space-between' }}>
      {Array.from({ length }).map((_, i) => {
        const active = i === value.length;
        return (
          <View key={i} style={[s.otpBox, active && !disabled && { borderColor: colors.primary, borderWidth: 2 }, error && { borderColor: colors.danger, backgroundColor: colors.dangerSoft }, disabled && { backgroundColor: colors.surfaceMuted }]}>
            <Text variant="h2" maxFontSizeMultiplier={fontScaleCap.control} style={s.otpDigit}>{value[i] ?? ''}</Text>
          </View>
        );
      })}
      <TextInput
        ref={ref} value={value} autoFocus editable={!disabled} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp"
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%' }}
        accessibilityLabel={label}
      />
    </Pressable>
  );
}

/**
 * Input text. iOS/web keep the body style as-is. On Android, a lineHeight on a single-line TextInput
 * shifts the glyphs and caret, and the native default vertical padding pushes digits off-centre
 * against the "+91" prefix — so drop both and centre vertically.
 */
const inputText: TextStyle = Platform.OS === 'android'
  ? { fontSize: type.body.fontSize, fontFamily: type.body.fontFamily, includeFontPadding: false, textAlignVertical: 'center', paddingVertical: 0 }
  : type.body;

export const s = StyleSheet.create({
  // minHeight (not height) so a 2-line label or 1.2× font scale grows the pill instead of clipping it.
  btn: { minHeight: touch.cta, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.xs },
  btnSecondary: { borderWidth: 1.5, borderColor: colors.primary },
  btnGhost: { minHeight: touch.min, paddingVertical: space.xxs },
  btnIcon: { flexShrink: 0 },
  btnLabel: { flexShrink: 1, textAlign: 'center', lineHeight: button.lineHeight },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, ...(elevation.card as object) },
  badge: { minWidth: 20, minHeight: 20, borderRadius: radius.pill, paddingHorizontal: 5, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  badgeText: { fontFamily: type.overline.fontFamily, lineHeight: 14, textAlign: 'center' },
  pill: { minHeight: 24, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  // letterSpacing is also added after the last glyph; trim it so caps labels look centred in the pill.
  pillText: { textAlign: 'center', lineHeight: 16, marginRight: -type.overline.letterSpacing },
  banner: { flexDirection: 'row', gap: space.sm, padding: space.sm, borderRadius: radius.md, alignItems: 'flex-start' },
  otpDigit: { width: '100%', textAlign: 'center' },
  circle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  prefix: { paddingLeft: space.md, paddingRight: space.xs, borderRightWidth: 1, borderRightColor: colors.border },
  input: { flex: 1, color: colors.text, minHeight: touch.cta, paddingHorizontal: space.md },
  // flex-start so a wrapped value (address, UMN, rate) keeps its first line level with the label.
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.xs, gap: space.sm },
  rowLabel: { flex: 1, minWidth: '35%' },
  rowValue: { flexShrink: 1, maxWidth: '62%', textAlign: 'right' },
  seg: { flexDirection: 'row', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.xxs },
  segItem: { flex: 1, minHeight: touch.min - 8, paddingVertical: space.xxs, paddingHorizontal: space.xs, flexDirection: 'row', gap: space.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segLabel: { flexShrink: 1, textAlign: 'center' },
  otpBox: { flex: 1, minWidth: 0, height: touch.cta, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
