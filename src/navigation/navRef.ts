import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * App-wide navigation ref (lives outside RootNavigator so modules rendered by the navigator, like the
 * assistant's voice commands, can import it without a require cycle). Re-exported by RootNavigator.
 */
export const navRef = createNavigationContainerRef<RootStackParamList>();
