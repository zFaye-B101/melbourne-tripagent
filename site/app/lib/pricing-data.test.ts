import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  ADMISSION_PRICE_SNAPSHOT,
  POI_DATASET,
  PTV_FARE_SNAPSHOT,
} from './planner';

describe('v0.4 offline price data', () => {
  it('passes the versioned JSON Schema', () => {
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(
          process.cwd(),
          '../data/poi-admission-price-v0.4.schema.json',
        ),
        'utf8',
      ),
    );
    const data = JSON.parse(
      fs.readFileSync(
        path.resolve(
          process.cwd(),
          '../data/verified/poi-admission-price-v0.4.json',
        ),
        'utf8',
      ),
    );
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      schema,
    );
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });

  it('maps exactly once to every curated POI', () => {
    const ids = ADMISSION_PRICE_SNAPSHOT.records.map((record) => record.poiId);
    expect(new Set(ids).size).toBe(40);
    expect([...ids].sort()).toEqual(
      POI_DATASET.pois.map((poi) => poi.id).sort(),
    );
  });

  it('keeps the pricing invariants explicit', () => {
    for (const record of ADMISSION_PRICE_SNAPSHOT.records) {
      expect(record.evidence[0]?.sourceUrl).toMatch(/^https:\/\//);
      expect(record.evidence[0]?.retrievedAt).toBe('2026-09-15');
      expect(record.evidence[0]?.reviewAfter).toMatch(/^2026-/);
      if (
        ['event_dependent', 'unknown'].includes(record.basis) ||
        ['stale', 'conflicted', 'unknown'].includes(record.verificationStatus)
      ) {
        expect(record.tiers).toHaveLength(0);
      }
      if (
        ['free_general_entry', 'not_ticketed_public_space'].includes(
          record.basis,
        )
      ) {
        expect(record.tiers).toHaveLength(0);
      }
    }
  });

  it('expires the temporary PTV policy at the declared boundary', () => {
    expect(PTV_FARE_SNAPSHOT.effectiveFrom).toBe('2026-06-01');
    expect(PTV_FARE_SNAPSHOT.effectiveUntil).toBe('2027-01-01');
    expect(PTV_FARE_SNAPSHOT.physicalCard.fullFareCents).toBe(600);
  });
});
