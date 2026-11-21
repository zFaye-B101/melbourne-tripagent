import { describe, expect, it } from 'vitest';

import { normalizeProviderDraft } from './provider-shared';

describe('normalizeProviderDraft', () => {
  // Found with local qwen3:8b (docs/44 §9): the strict schema makes itemIndex a
  // required integer|null on every evidence item, and models fill 0 on scalar
  // paths. itemIndex has no meaning outside array paths, so it is dropped there.
  it('drops itemIndex on scalar evidence paths, whatever its value', () => {
    const draft = normalizeProviderDraft({
      evidence: [
        { path: '/destination/text', quote: '墨尔本', occurrence: 1, itemIndex: 0 },
        { path: '/days', quote: '2 天', occurrence: 1, itemIndex: null },
        { path: '/costAssumptions/accommodation/nights', quote: '住 1 晚', occurrence: 1, itemIndex: 3 },
      ],
    }) as { evidence: Array<Record<string, unknown>> };
    for (const item of draft.evidence) expect('itemIndex' in item).toBe(false);
  });

  it('keeps itemIndex on array paths', () => {
    const draft = normalizeProviderDraft({
      evidence: [
        { path: '/mustIncludeNames', quote: '必去 NGV', occurrence: 1, itemIndex: 0 },
        { path: '/party/childAges', quote: '8 岁', occurrence: 1, itemIndex: 1 },
        { path: '/unhandledRequirements', quote: 'x', occurrence: 1, itemIndex: 2 },
      ],
    }) as { evidence: Array<Record<string, unknown>> };
    expect(draft.evidence.map((item) => item.itemIndex)).toEqual([0, 1, 2]);
  });
});
