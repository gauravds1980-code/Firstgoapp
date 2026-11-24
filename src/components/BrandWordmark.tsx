import React from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { colors, fontFamily, fontScaleCap } from '../theme/tokens';
import { Text } from './ui';

/**
 * Text lockup "IDFC FIRST Bank" — always ONE line. "FIRST" is ExtraBold, "IDFC" / "Bank" SemiBold,
 * all brand maroon. In a tight row (360dp, large OS font) it shrinks to at most 85% instead of
 * wrapping, and OS font scaling is capped at fontScaleCap.control. The parent must give it a
 * bounded width (e.g. a flex: 1 column) so the shrink can measure.
 */
export function BrandWordmark({ color = colors.primary, style }: { color?: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text variant="bodyStrong" color={color} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
      maxFontSizeMultiplier={fontScaleCap.control} accessibilityLabel="IDFC FIRST Bank" style={style}>
      IDFC <Text variant="bodyStrong" color={color} maxFontSizeMultiplier={fontScaleCap.control} style={{ fontFamily: fontFamily.extrabold }}>FIRST</Text> Bank
    </Text>
  );
}
