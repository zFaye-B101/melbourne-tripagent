import {
  LOCAL_AI_TRIAL_ORIGIN,
  LOCAL_AI_TRIAL_ENDPOINT,
  aiParseEndpointForExplicitClick,
  isLocalAiTrialOrigin,
} from './ai-parse-opt-in';

export { LOCAL_AI_TRIAL_ORIGIN, LOCAL_AI_TRIAL_ENDPOINT, isLocalAiTrialOrigin };

export function shouldUseLocalAiTrial(options: {
  origin: string;
  explicitUserClick: boolean;
}): boolean {
  return (
    aiParseEndpointForExplicitClick(options) === LOCAL_AI_TRIAL_ENDPOINT &&
    isLocalAiTrialOrigin(options.origin)
  );
}
