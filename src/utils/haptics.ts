import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Haptic feedback; no-op on web. */
export const haptic = {
  tap() { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  select() { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); },
  success() { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  error() { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
};
