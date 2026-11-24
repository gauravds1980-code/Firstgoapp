import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Haptic feedback; no-op on web. */
export const haptic = {
  tap() { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  select() { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); },
  success() { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  error() { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
};

/**
 * Named journey moments (v1.2.2) so the "feel" stays consistent across screens. Light by design:
 * one success pulse per moment, never on every tap. All no-op on web.
 */
export const hapticMoment = {
  /** Customer QR resolved to an offer. */
  qrSuccess: haptic.success,
  /** RC photo read (OCR) — the registration number is filled in. */
  rcCaptured: haptic.success,
  /** Consent OTP / KFS + e-sign link sent to the customer. */
  offerSent: haptic.success,
  /** Money credited to the dealer — final screen. */
  disbursalComplete: haptic.success,
  /**
   * Pre-approved offer revealed (v1.2.8): a success notification, then two short upbeat beats
   * (Medium, Light) ~90 ms apart. Returns a cancel function so an unmounting screen stops the beats.
   */
  offerCelebrate(): () => void {
    if (Platform.OS === 'web') return () => {};
    haptic.success();
    const beats = [
      setTimeout(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }, 180),
      setTimeout(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }, 270),
    ];
    return () => beats.forEach(clearTimeout);
  },
};
