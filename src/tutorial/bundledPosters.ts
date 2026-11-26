/**
 * Posters (720x1280) and thumbnails (360x640) of the 12 catalogue shorts, packed on every platform
 * (~0.5 MB) so Help tiles, Zippy's bubble and the feed's first paint never wait on the network.
 * Files: assets/tutorial/posters/<id>.jpg and <id>-thumb.jpg. ShortId → Image module.
 */
import type { ImageSourcePropType } from 'react-native';
import type { ShortId } from './shortMap';

export const BUNDLED_POSTERS: Readonly<Partial<Record<ShortId, ImageSourcePropType>>> = {
  full: require('../../assets/tutorial/posters/full.jpg'),
  login: require('../../assets/tutorial/posters/login.jpg'),
  'scan-offer': require('../../assets/tutorial/posters/scan-offer.jpg'),
  'vehicle-emi': require('../../assets/tutorial/posters/vehicle-emi.jpg'),
  ekyc: require('../../assets/tutorial/posters/ekyc.jpg'),
  mandate: require('../../assets/tutorial/posters/mandate.jpg'),
  esign: require('../../assets/tutorial/posters/esign.jpg'),
  'docs-disbursal': require('../../assets/tutorial/posters/docs-disbursal.jpg'),
  'payouts-utr': require('../../assets/tutorial/posters/payouts-utr.jpg'),
  'portfolio-cases-rc': require('../../assets/tutorial/posters/portfolio-cases-rc.jpg'),
  tainf: require('../../assets/tutorial/posters/tainf.jpg'),
  'zippy-voice': require('../../assets/tutorial/posters/zippy-voice.jpg'),
};

export const BUNDLED_THUMBS: Readonly<Partial<Record<ShortId, ImageSourcePropType>>> = {
  full: require('../../assets/tutorial/posters/full-thumb.jpg'),
  login: require('../../assets/tutorial/posters/login-thumb.jpg'),
  'scan-offer': require('../../assets/tutorial/posters/scan-offer-thumb.jpg'),
  'vehicle-emi': require('../../assets/tutorial/posters/vehicle-emi-thumb.jpg'),
  ekyc: require('../../assets/tutorial/posters/ekyc-thumb.jpg'),
  mandate: require('../../assets/tutorial/posters/mandate-thumb.jpg'),
  esign: require('../../assets/tutorial/posters/esign-thumb.jpg'),
  'docs-disbursal': require('../../assets/tutorial/posters/docs-disbursal-thumb.jpg'),
  'payouts-utr': require('../../assets/tutorial/posters/payouts-utr-thumb.jpg'),
  'portfolio-cases-rc': require('../../assets/tutorial/posters/portfolio-cases-rc-thumb.jpg'),
  tainf: require('../../assets/tutorial/posters/tainf-thumb.jpg'),
  'zippy-voice': require('../../assets/tutorial/posters/zippy-voice-thumb.jpg'),
};
