import type { ParsedTripRequest } from './planner';
import type {
  FieldEvidenceV2,
  ParserDiagnostics,
  ParserFallbackReasonCode,
} from './nlu-contract';

export interface ParseRequestV1 {
  text: string;
  locale: 'zh-CN';
  datasetVersion: string;
}

export interface ClarificationOptionV1 {
  value: string;
  label: string;
}

export interface ClarificationSpecV1 {
  id: string;
  field: string;
  prompt: string;
  options: ClarificationOptionV1[];
}

export interface NoticeV1 {
  code: string;
  message: string;
}

export interface ParseResponseV1 {
  apiVersion: 'trip-parse-api-v1';
  requestId: string;
  decision: 'ready' | 'clarification' | 'scope_error' | 'service_error';
  parser: ParserDiagnostics;
  datasetVersion: string;
  request: Omit<ParsedTripRequest, 'rawText'> | null;
  fieldEvidence: FieldEvidenceV2[];
  question: ClarificationSpecV1 | null;
  warnings: NoticeV1[];
}

export interface ParseErrorBody {
  error:
    | 'invalid_request'
    | 'dataset_version_mismatch'
    | 'method_not_allowed'
    | 'not_found';
  message: string;
  fallbackReasonCode?: ParserFallbackReasonCode;
}
