/**
 * Phosphor icons (design-a). Per-icon deep imports only, so Metro bundles these few glyphs and not all
 * ~1500 from the package index. The rest of the app keeps Material Community Icons via `Icon` in ui.tsx.
 *
 * Treatment (one, everywhere): a Phosphor `fill` glyph inside a coloured 40dp icon well. The glyph colour
 * comes from wellGlyph(), so mustard wells get ink (7.4:1) and teal / navy / maroon / primaryDark wells
 * get white (≥ 7.4:1). Never white on mustard.
 */
import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import type { IconProps, IconWeight } from 'phosphor-react-native';
import { HandCoinsIcon } from 'phosphor-react-native/src/icons/HandCoins';
import { ChartPieIcon } from 'phosphor-react-native/src/icons/ChartPie';
import { SealCheckIcon } from 'phosphor-react-native/src/icons/SealCheck';
import { IdentificationCardIcon } from 'phosphor-react-native/src/icons/IdentificationCard';
import { VaultIcon } from 'phosphor-react-native/src/icons/Vault';
import { WarehouseIcon } from 'phosphor-react-native/src/icons/Warehouse';
import { HandshakeIcon } from 'phosphor-react-native/src/icons/Handshake';
import { PlayCircleIcon } from 'phosphor-react-native/src/icons/PlayCircle';
import { MotorcycleIcon } from 'phosphor-react-native/src/icons/Motorcycle';
import { CarProfileIcon } from 'phosphor-react-native/src/icons/CarProfile';
import { TruckIcon } from 'phosphor-react-native/src/icons/Truck';
import { radius } from '../theme/tokens';
import { wellGlyph } from '../theme/contrast';

const GLYPHS = {
  payouts: HandCoinsIcon,
  portfolio: ChartPieIcon,
  cases: SealCheckIcon,
  rc: IdentificationCardIcon,
  tradeAdvance: VaultIcon,
  inventoryFunding: WarehouseIcon,
  workingCapital: HandshakeIcon,
  help: PlayCircleIcon,
  twoWheeler: MotorcycleIcon,
  car: CarProfileIcon,
  cv: TruckIcon,
} as const satisfies Record<string, React.FC<IconProps>>;

export type PhosphorName = keyof typeof GLYPHS;

export function PhIcon({ name, size = 22, color, weight = 'fill' }: { name: PhosphorName; size?: number; color: string; weight?: IconWeight }) {
  const G = GLYPHS[name];
  return <G size={size} color={color} weight={weight} />;
}

/** 40dp coloured icon well with a fill glyph in the contrast-safe colour for that well. */
export function IconWell({ name, bg, size = 40, glyph = 22, style }: { name: PhosphorName; bg: string; size?: number; glyph?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, style]}>
      <PhIcon name={name} size={glyph} color={wellGlyph(bg)} />
    </View>
  );
}
