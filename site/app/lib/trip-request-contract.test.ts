import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { beforeEach, describe, expect, it } from 'vitest';

const schema = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), '../data/trip-request-draft.schema.json'),
    'utf8',
  ),
);

const example = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), '../data/examples/trip-request.example.json'),
    'utf8',
  ),
);

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

describe('TripRequestDraft v1 schema', () => {
  beforeEach(() => {
    validate.errors = null;
  });

  it('accepts the checked-in example', () => {
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects fields outside the frozen contract', () => {
    expect(validate({ ...example, provider: 'example-model' })).toBe(false);
    expect(
      validate.errors?.some(
        (error) => error.keyword === 'additionalProperties',
      ),
    ).toBe(true);
  });

  it('does not silently truncate an out-of-scope four-day request', () => {
    const draft = structuredClone(example);
    draft.days = null;
    draft.unhandledRequirements = [
      { kind: 'duration_scope', text: '四天', hardness: 'hard' },
    ];
    draft.evidence.push({ path: '/unhandledRequirements', quote: '四天' });
    expect(validate(draft), JSON.stringify(validate.errors)).toBe(true);

    draft.days = 4;
    expect(validate(draft)).toBe(false);
  });

  it('keeps unspecified preferences nullable instead of inventing false', () => {
    const draft = structuredClone(example);
    draft.preferences = {
      preferIndoor: null,
      lowWalking: null,
      family: null,
      avoidCrowds: null,
    };
    expect(validate(draft), JSON.stringify(validate.errors)).toBe(true);
  });
});
