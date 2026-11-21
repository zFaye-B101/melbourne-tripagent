import type { ParsedTripRequest } from './planner';

export type ParserFallbackReasonCode =
  | 'deadline_exceeded'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'auth_or_config'
  | 'invalid_json'
  | 'schema_rejected'
  | 'evidence_rejected'
  | 'semantic_rejected'
  | 'version_mismatch'
  | 'circuit_open'
  /** 模型草稿校验通过，但规范化后比规则结果多出阻断，且只因无关紧要的短语（如“先生成”）。 */
  | 'worse_than_rules';

export interface ParserDiagnostics {
  attemptedMode: 'llm' | 'rules';
  acceptedMode: 'llm' | 'rules' | 'none';
  fallbackReasonCode: ParserFallbackReasonCode | null;
  draftSchemaVersion: 'trip-request-draft-v2' | null;
  normalizedRequestVersion: 'parsed-trip-request-v2';
  semanticPolicyVersion: 'trip-semantic-v1';
  promptVersion: string | null;
}

export interface FieldEvidenceV2 {
  path: string;
  quote: string;
  occurrence: number;
  itemIndex: number | null;
}

export const DEFAULT_RULES_DIAGNOSTICS: ParserDiagnostics = {
  attemptedMode: 'rules',
  acceptedMode: 'rules',
  fallbackReasonCode: null,
  draftSchemaVersion: null,
  normalizedRequestVersion: 'parsed-trip-request-v2',
  semanticPolicyVersion: 'trip-semantic-v1',
  promptVersion: null,
};

export type AdapterFailureCode = Exclude<
  ParserFallbackReasonCode,
  'schema_rejected' | 'evidence_rejected' | 'semantic_rejected' | 'worse_than_rules'
>;

export interface NluDraftAdapter {
  extractDraft(
    input: {
      text: string;
      locale: 'zh-CN';
      datasetVersion: string;
    },
    options: { signal: AbortSignal; deadlineMs: number },
  ): Promise<
    | {
        ok: true;
        draft: unknown;
        promptVersion: string | null;
        datasetVersion: string;
      }
    | { ok: false; code: AdapterFailureCode }
  >;
}

export type InterpretationOutcome =
  | {
      status: 'complete';
      sourceFingerprint: string;
      request: ParsedTripRequest;
      diagnostics: ParserDiagnostics;
      fieldEvidence: FieldEvidenceV2[];
    }
  | { status: 'aborted'; sourceFingerprint: string }
  | {
      status: 'failed';
      sourceFingerprint: string;
      diagnostics: ParserDiagnostics;
      message: string;
    };
