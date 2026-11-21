import draftSchema from '../../data/trip-request-draft-v2.schema.json';
import promptConfig from '../config/prompt.v2.10.json';

export const PROMPT_VERSION = promptConfig.version;
export const EXTRACTION_PROMPT = promptConfig.text;

export function structuredDraftSchema(): Record<string, unknown> {
  return strictifySchema(draftSchema as Record<string, unknown>);
}

export function schemaPrompt(prompt = EXTRACTION_PROMPT): string {
  return `${prompt}\n只返回一个 JSON 对象，不要使用 Markdown 代码块。JSON 必须符合以下 Schema：\n${JSON.stringify(structuredDraftSchema())}`;
}

const ARRAY_EVIDENCE_PATHS = new Set([
  '/party/childAges',
  '/mustIncludeNames',
  '/excludeNames',
  '/unhandledRequirements',
  '/unresolvedPhrases',
]);

export function normalizeProviderDraft(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const draft = value as Record<string, unknown>;
  if (Array.isArray(draft.evidence))
    draft.evidence = draft.evidence.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const normalized = { ...(item as Record<string, unknown>) };
      // itemIndex 只对数组字段有意义；strict Schema 让它变成必填，模型常在标量字段填 0。
      if (
        normalized.itemIndex === null ||
        !ARRAY_EVIDENCE_PATHS.has(String(normalized.path))
      )
        delete normalized.itemIndex;
      return normalized;
    });
  return draft;
}

function strictifySchema(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '$schema' || key === '$id' || key === 'uniqueItems') continue;
    if (key === 'itemIndex') {
      result[key] = { type: ['integer', 'null'], minimum: 0, maximum: 19 };
      continue;
    }
    if (child && typeof child === 'object' && !Array.isArray(child))
      result[key] = strictifySchema(child as Record<string, unknown>);
    else if (Array.isArray(child))
      result[key] = child.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? strictifySchema(item as Record<string, unknown>)
          : item,
      );
    else result[key] = child;
  }
  if (
    result.type === 'object' &&
    result.properties &&
    typeof result.properties === 'object'
  ) {
    result.additionalProperties = false;
    result.required = Object.keys(result.properties as Record<string, unknown>);
  }
  return result;
}
