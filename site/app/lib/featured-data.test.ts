import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import featuredSnapshot from '@/data/featured-pois-v0.4.json';
import mediaSnapshot from '@/data/poi-media-v0.4.4.json';
import { POI_DATASET } from './planner';
import { FEATURED_POI_PHOTOS, getPoiPhoto, POI_PHOTOS } from './poi-media';

describe('v0.4 featured POI media', () => {
  it('contains 10 unique curated POIs with complete provenance', () => {
    expect(featuredSnapshot.items).toHaveLength(10);
    expect(new Set(featuredSnapshot.items.map((item) => item.poiId)).size).toBe(
      10,
    );

    const poiIds = new Set(POI_DATASET.pois.map((poi) => poi.id));
    for (const item of featuredSnapshot.items) {
      expect(poiIds.has(item.poiId)).toBe(true);
      expect(item.sourcePageUrl).toMatch(
        /^https:\/\/commons\.wikimedia\.org\//,
      );
      expect(item.sourceFileUrl).toMatch(
        /^https:\/\/commons\.wikimedia\.org\//,
      );
      expect(item.author.trim().length).toBeGreaterThan(0);
      expect(item.license.trim().length).toBeGreaterThan(0);
      expect(item.licenseUrl).toMatch(/^https:\/\//);
      expect(item.attribution.trim().length).toBeGreaterThan(0);
      expect(item.verifiedAt).toBe('2026-09-15');
    }
  });

  it('contains one provenance-complete photo for every planner POI', () => {
    expect(mediaSnapshot.items).toHaveLength(40);
    expect(mediaSnapshot.visualReview).toMatchObject({ status: 'passed' });
    expect(new Set(mediaSnapshot.items.map((item) => item.poiId)).size).toBe(
      40,
    );
    expect(new Set(mediaSnapshot.items.map((item) => item.imageSrc)).size).toBe(
      40,
    );

    const plannerPoiIds = new Set(POI_DATASET.pois.map((poi) => poi.id));
    expect(new Set(mediaSnapshot.items.map((item) => item.poiId))).toEqual(
      plannerPoiIds,
    );
    for (const item of mediaSnapshot.items) {
      expect(item.sourcePageUrl).toMatch(
        /^https:\/\/commons\.wikimedia\.org\//,
      );
      expect(item.author.trim().length).toBeGreaterThan(0);
      expect(item.license).toMatch(/^(CC0|CC BY|CC BY-SA|Public domain)/);
      expect(item.licenseUrl).toMatch(/^https?:\/\//);
      expect(item.attribution.trim().length).toBeGreaterThan(0);
      expect(item.verifiedAt).toBe('2026-09-15');
      expect(item.visualReviewStatus).toBe('passed_contact_sheet_review');
    }
  });

  it('keeps every POI image in the local public bundle', () => {
    for (const item of mediaSnapshot.items) {
      const localPath = path.resolve(
        process.cwd(),
        'public',
        item.imageSrc.replace(/^\//, ''),
      );
      expect(fs.existsSync(localPath), localPath).toBe(true);
      expect(fs.statSync(localPath).size, localPath).toBeGreaterThan(10_000);
    }
  });

  it('exposes all 40 photos while keeping the editorial carousel at 10', () => {
    const photographed = POI_DATASET.pois.filter((poi) =>
      Boolean(getPoiPhoto(poi.id)),
    );

    expect(POI_PHOTOS).toHaveLength(40);
    expect(photographed).toHaveLength(40);
    expect(
      POI_DATASET.pois.filter((poi) => getPoiPhoto(poi.id) === null),
    ).toHaveLength(0);
    expect(FEATURED_POI_PHOTOS).toHaveLength(10);
    expect(FEATURED_POI_PHOTOS.map((item) => item.poiId)).toEqual(
      featuredSnapshot.items.map((item) => item.poiId),
    );
  });
});
