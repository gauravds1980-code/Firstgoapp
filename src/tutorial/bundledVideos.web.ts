/**
 * Web: no MP4 is packed into the JS bundle (it would add ~34 MB). The browser streams the same files
 * from same-origin /tutorial (public/tutorial). Native counterpart: bundledVideos.native.ts.
 */
import type { ShortId } from './shortMap';

export const BUNDLED_VIDEOS: Readonly<Partial<Record<ShortId, number>>> = {};
