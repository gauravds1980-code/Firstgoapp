/**
 * Lookup of the assets packed into the app for a short (v1.3.2). A bundled file is used only while the
 * catalogue still points at its default server path: if manifest.json re-points a short at a new
 * render (e.g. posters/mandate-v2.jpg), the remote file wins so a re-render ships without a release.
 */
import type { ImageSourcePropType } from 'react-native';
import { assetIdFor, tutorialPaths, type TutorialPaths } from './catalog';
import { BUNDLED_POSTERS, BUNDLED_THUMBS } from './bundledPosters';
import { BUNDLED_VIDEOS } from './bundledVideos';
import type { ShortId } from './shortMap';

type Item = { id: string; paths: TutorialPaths };

const key = (id: string) => assetIdFor(id) as ShortId;
const isDefault = (it: Item, k: keyof TutorialPaths) => it.paths[k] === tutorialPaths(it.id)[k];

/** Packed MP4 asset id (native only; undefined on web or for remote-only shorts). */
export const bundledVideoFor = (it: Item): number | undefined => (isDefault(it, 'mp4') ? BUNDLED_VIDEOS[key(it.id)] : undefined);

/** Packed poster / thumbnail module, or undefined (then the remote URI is used). */
export function bundledPosterFor(it: Item, variant: 'poster' | 'thumb'): ImageSourcePropType | undefined {
  return isDefault(it, variant) ? (variant === 'poster' ? BUNDLED_POSTERS : BUNDLED_THUMBS)[key(it.id)] : undefined;
}

/** Short ids whose video is packed (native): available even if a manifest does not list them. */
export const BUNDLED_VIDEO_IDS: ReadonlySet<string> = new Set(Object.keys(BUNDLED_VIDEOS));
