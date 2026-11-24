import { useLayoutEffect } from 'react';
import { useNavigation } from '@react-navigation/native';

/**
 * Toggles the native-stack swipe-back gesture for the current screen.
 * Used on iOS (edge swipe) for the auto-advancing waiver beats, so the dealer can't swipe away
 * mid-animation while the step is being recorded. It has no effect on the Android hardware back
 * button (predictiveBackGestureEnabled is false), so Android behaviour is unchanged.
 */
export function useSwipeBack(enabled: boolean) {
  const nav = useNavigation();
  useLayoutEffect(() => {
    nav.setOptions({ gestureEnabled: enabled });
  }, [nav, enabled]);
}
