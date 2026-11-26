/**
 * The 12 catalogue shorts packed into the native app (v1.3.2), so Help & the shorts feed play offline
 * and never depend on the dev tunnel. ShortId → Metro asset id (expo-video `{ assetId }`).
 *
 * Native only: Metro picks bundledVideos.web.ts on web, so these ~34 MB of MP4 stay out of the web
 * bundle (web plays the same files from same-origin /tutorial instead). Files: assets/tutorial/<id>.mp4.
 */
import type { ShortId } from './shortMap';

export const BUNDLED_VIDEOS: Readonly<Partial<Record<ShortId, number>>> = {
  full: require('../../assets/tutorial/full.mp4'),
  login: require('../../assets/tutorial/login.mp4'),
  'scan-offer': require('../../assets/tutorial/scan-offer.mp4'),
  'vehicle-emi': require('../../assets/tutorial/vehicle-emi.mp4'),
  ekyc: require('../../assets/tutorial/ekyc.mp4'),
  mandate: require('../../assets/tutorial/mandate.mp4'),
  esign: require('../../assets/tutorial/esign.mp4'),
  'docs-disbursal': require('../../assets/tutorial/docs-disbursal.mp4'),
  'payouts-utr': require('../../assets/tutorial/payouts-utr.mp4'),
  'portfolio-cases-rc': require('../../assets/tutorial/portfolio-cases-rc.mp4'),
  tainf: require('../../assets/tutorial/tainf.mp4'),
  'zippy-voice': require('../../assets/tutorial/zippy-voice.mp4'),
};
