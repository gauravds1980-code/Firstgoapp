import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

export type MicPermission = 'granted' | 'denied';

/** Already granted? (No system prompt.) */
export async function hasMicPermission(): Promise<boolean> {
  try { return (await getRecordingPermissionsAsync()).granted; } catch { return false; }
}

/** Ask once (shows the system prompt if undecided). Never throws; "denied" on any error. */
export async function requestMicPermission(): Promise<MicPermission> {
  try {
    const r = await requestRecordingPermissionsAsync();
    return r.granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
