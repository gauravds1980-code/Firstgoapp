import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { APP_NAME } from '../config/brand';
import { colors, fontFamily, fontScaleCap, space } from '../theme/tokens';
import { BrandWordmark } from './BrandWordmark';
import { Text } from './ui';

/**
 * The ONE logo-mark treatment used on login, Home and every screen header: the official IDFC FIRST
 * "F" mark (paths from assets/idfc-logo.svg) in white on a maroon rounded tile. On a maroon background
 * (login hero) the same tile gets a thin white keyline so it stays visible.
 */
export function IdfcMark({ size = 40, onDark = false }: { size?: number; onDark?: boolean }) {
  const glyph = Math.round(size * 0.62);
  return (
    <View accessible={false} style={{ width: size, height: size, flexShrink: 0, borderRadius: Math.round(size * 0.22), backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: onDark ? 1 : 0, borderColor: 'rgba(255,255,255,0.55)' }}>
      <Svg width={glyph} height={glyph} viewBox="14 14 55 55">
        <Path fill="#FFFFFF" fillRule="evenodd" d="M17.966 17.963h47.07V65.04H17.964l.002-47.076ZM69 14.003 14 14v55h55V14.002Z" />
        <Path fill="#FFFFFF" d="M23 32h37v-9H23zM23 60h9v-9h-9zM23 46h23v-9H23z" />
      </Svg>
    </View>
  );
}

/** FIRSTgo » mark (assets/brand/mark.svg). The first chevron is white on dark, maroon on light. */
export function FirstGoChevron({ size = 18, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="28 24 64 60" accessible={false}>
      <Path d="M36 34 L56 54 L36 74" stroke={onDark ? '#FFFFFF' : colors.primary} strokeOpacity={onDark ? 0.92 : 1} strokeWidth={11} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M54 34 L74 54 L54 74" stroke={colors.cta} strokeWidth={11} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={80} cy={30} r={4.5} fill={colors.cta} />
      <Circle cx={86.5} cy={39} r={2.4} fill={onDark ? '#FFFFFF' : colors.primary} />
    </Svg>
  );
}

/**
 * "» FIRSTgo" in mixed case: FIRST ExtraBold + "go" Regular, never upper-cased. `suffix` adds e.g.
 * " · Dealer app" in the same line. One line; ellipsizes only as a last resort.
 */
export function FirstGoTag({ onDark = false, suffix, size = 'caption' }: { onDark?: boolean; suffix?: string; size?: 'caption' | 'label' }) {
  const fg = onDark ? colors.onPrimary : colors.primary;
  const sub = onDark ? 'rgba(255,255,255,0.88)' : colors.textSecondary;
  const first = APP_NAME.startsWith('FIRST') ? 'FIRST' : '';
  const rest = APP_NAME.slice(first.length);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xxs, minWidth: 0 }} accessible accessibilityLabel={`${APP_NAME}${suffix ?? ''}`}>
      <FirstGoChevron size={size === 'label' ? 18 : 16} onDark={onDark} />
      <Text variant={size} color={fg} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control} style={{ flexShrink: 1 }}>
        <Text variant={size} color={fg} maxFontSizeMultiplier={fontScaleCap.control} style={{ fontFamily: fontFamily.extrabold }}>{first}</Text>
        <Text variant={size} color={fg} maxFontSizeMultiplier={fontScaleCap.control} style={{ fontFamily: fontFamily.regular }}>{rest}</Text>
        {suffix ? <Text variant={size} color={sub} maxFontSizeMultiplier={fontScaleCap.control} style={{ fontFamily: fontFamily.medium }}>{suffix}</Text> : null}
      </Text>
    </View>
  );
}

/**
 * Bank lockup: IdfcMark + one-line "IDFC FIRST Bank" wordmark, with "» FIRSTgo" (plus an optional
 * suffix such as " · Dealer app") directly under the wordmark. Used by the login hero and the Home header,
 * so both read the same. The text column is the only part that shrinks.
 */
export function BrandLockup({ onDark = false, markSize = 40, appSuffix, style }: { onDark?: boolean; markSize?: number; appSuffix?: string; style?: React.ComponentProps<typeof View>['style'] }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minWidth: 0 }, style]} accessibilityRole="header" accessibilityLabel={`IDFC FIRST Bank, ${APP_NAME}${appSuffix ?? ''}`}>
      <IdfcMark size={markSize} onDark={onDark} />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <BrandWordmark color={onDark ? colors.onPrimary : colors.primary} />
        <FirstGoTag onDark={onDark} suffix={appSuffix} />
      </View>
    </View>
  );
}
