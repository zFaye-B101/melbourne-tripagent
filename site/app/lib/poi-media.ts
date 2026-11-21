import featuredSnapshot from '@/data/featured-pois-v0.4.json';
import mediaSnapshot from '@/data/poi-media-v0.4.4.json';

import { assetUrl } from './base-url';

export interface PoiPhoto {
  poiId: string;
  imageSrc: string;
  alt: string;
  sourcePageUrl: string;
  sourceFileUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  modification: string;
  verifiedAt: string;
  editorialOrder: number;
  articleUrl?: string;
  commonsTitle?: string;
  sourceMime?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceSha1?: string;
  displayWidth?: number;
  displayHeight?: number;
  displaySha256?: string;
  matchEvidence?: string;
  visualReviewStatus?: string;
}

export const POI_PHOTOS = (mediaSnapshot.items as PoiPhoto[]).map((photo) => ({
  ...photo,
  imageSrc: assetUrl(photo.imageSrc),
}));

const PHOTO_BY_POI_ID = new Map(
  POI_PHOTOS.map((photo) => [photo.poiId, photo] as const),
);

export const FEATURED_POI_PHOTOS = featuredSnapshot.items
  .map((featured) => PHOTO_BY_POI_ID.get(featured.poiId))
  .filter((photo): photo is PoiPhoto => Boolean(photo))
  .sort((a, b) => a.editorialOrder - b.editorialOrder);

export function getPoiPhoto(poiId: string): PoiPhoto | null {
  return PHOTO_BY_POI_ID.get(poiId) ?? null;
}
