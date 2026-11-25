import React, { useState } from 'react';
import { StyleProp, TextStyle, View } from 'react-native';
import { colors, fontScaleCap, type } from '../theme/tokens';
import { Text } from './ui';

/** Smallest the wordmark may shrink to (of bodyStrong) before it would ellipsize. */
const MIN_SCALE = 0.7;

/**
 * Text lockup "IDFC FIRST Bank" — always ONE line, never truncated. All three words share one weight
 * (bodyStrong, Inter SemiBold) in brand maroon; "FIRST" is never heavier than "IDFC" / "Bank".
 * v1.3.0: it measures its natural width (a hidden copy) against the room it is given and scales the font
 * down to fit (to MIN_SCALE), on every platform — web ignores adjustsFontSizeToFit, which is how 360dp
 * headers ended up with "IDFC FIR…". OS font scaling is capped at fontScaleCap.control. The parent
 * must give it a width that does not depend on the text (e.g. a flex: 1 column), so the fit cannot loop.
 */
export function BrandWordmark({ color = colors.primary, style }: { color?: string; style?: StyleProp<TextStyle> }) {
  const [natural, setNatural] = useState(0);
  const [room, setRoom] = useState(0);
  const scale = natural > 0 && room > 0 ? Math.max(MIN_SCALE, Math.min(1, room / natural)) : 1;
  const fit = scale < 1 ? { fontSize: type.bodyStrong.fontSize * scale, lineHeight: type.bodyStrong.lineHeight } : null;
  return (
    <View style={{ alignSelf: 'stretch', minWidth: 0, overflow: 'hidden' }} onLayout={(e) => setRoom(Math.floor(e.nativeEvent.layout.width))}>
      <Text variant="bodyStrong" color={color} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.control}
        accessibilityLabel="IDFC FIRST Bank" style={[style, fit]}>
        IDFC FIRST Bank
      </Text>
      {/* Hidden measuring copy at full size: its laid-out width is the wordmark's natural width. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', left: 0, top: 0, width: 600, flexDirection: 'row', opacity: 0 }}>
        <Text variant="bodyStrong" maxFontSizeMultiplier={fontScaleCap.control} style={style}
          onLayout={(e) => setNatural(Math.ceil(e.nativeEvent.layout.width) + 1)}>IDFC FIRST Bank</Text>
      </View>
    </View>
  );
}
